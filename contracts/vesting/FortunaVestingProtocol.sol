// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  FortunaVestingProtocol
 * @notice Single-contract ERC20 vesting platform supporting cliff, linear,
 *         TGE, release cycles, revocation, platform fees, and fee exemptions.
 *
 * @dev    v1.1 — Audit fixes:
 *         - Revocation snapshots vestedAtRevocation + revokedAt; vested tokens
 *           remain claimable by beneficiary after revocation.
 *         - Schedule IDs start at 1 (0 is the null sentinel).
 *         - title + category metadata stored on every schedule.
 */
contract FortunaVestingProtocol is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // STRUCTS
    // ─────────────────────────────────────────────────────────────────────────

    struct VestingSchedule {
        uint256 scheduleId;
        address token;
        address creator;
        address beneficiary;
        uint256 totalAllocation;    // net after token fee
        uint256 claimedAmount;
        uint64  startTime;
        uint64  cliffDuration;      // seconds
        uint64  vestingDuration;    // seconds, starts after cliff
        uint64  releaseInterval;    // 0 = continuous, >0 = periodic
        uint16  tgePercent;         // basis points (0–10000)
        bool    revocable;
        bool    revoked;
        uint64  revokedAt;          // 0 if not revoked
        uint256 vestedAtRevocation; // claim ceiling after revocation
        string  title;              // e.g. "Team Allocation"
        bytes32 category;           // short tag, e.g. "TEAM"
    }

    struct CreateScheduleParams {
        address token;
        address beneficiary;
        uint256 amount;
        uint64 startTime;
        uint64 cliffDuration;
        uint64 vestingDuration;
        uint64 releaseInterval;
        uint16 tgePercent;
        bool revocable;
        string title;
        string category;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────────────────

    uint256 private _nextScheduleId;

    mapping(uint256 => VestingSchedule) private schedules;
    mapping(address => uint256[]) private _beneficiarySchedules;
    mapping(address => uint256[]) private _creatorSchedules;

    uint256 public flatFeeNative;
    uint256 public tokenFeeBps;
    address public treasuryWallet;
    mapping(address => bool) public feeExempt;
    address public fortunaFeeToken;
    uint256 public flatFeeFortuna;
    uint16 public fortunaFeeDiscountBps;

    uint256 public totalSchedules;
    uint256 public totalTokensLocked;
    uint256 public totalTokensClaimed;
    uint256 public totalFeesCollectedNative;
    uint256 public totalFeesCollectedFortuna;
    mapping(address => uint256) public totalFeesCollectedTokens;
    mapping(address => uint256) public tokenOutstandingAllocation;
    uint256 public totalTokensDeposited;
    uint256 public totalTokensRevoked;

    // ─────────────────────────────────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Split into two events to stay within the 16-slot EVM stack limit
    ///      under the legacy codegen pipeline (no viaIR required).
    event ScheduleCreated(
        uint256 indexed scheduleId,
        address indexed creator,
        address indexed beneficiary,
        address token,
        uint256 totalAllocation,
        uint64  startTime,
        uint64  cliffDuration,
        uint64  vestingDuration,
        uint64  releaseInterval,
        uint16  tgePercent,
        bool    revocable
    );
    /// @dev Emitted alongside ScheduleCreated with the same scheduleId.
    event ScheduleMetadata(
        uint256 indexed scheduleId,
        string  title,
        string  category
    );

    event TokensClaimed(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        address token,
        uint256 amount
    );
    event ScheduleRevoked(
        uint256 indexed scheduleId,
        address indexed creator,
        uint256 vestedAtRevocation,
        uint256 unvestedReturned
    );
    event FeeExemptionUpdated(address indexed wallet, bool exempt);
    event TreasuryUpdated(address indexed newTreasury);
    event FeeUpdated(uint256 flatFeeNative, uint256 tokenFeeBps);
    event FortunaFeeConfigUpdated(
        address indexed feeToken,
        uint256 flatFeeFortuna,
        uint16 fortunaFeeDiscountBps
    );
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    event NativeRescued(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _treasury, uint256 _flatFeeNative, uint256 _tokenFeeBps)
        Ownable(msg.sender)
    {
        require(_treasury    != address(0), "Fortuna: zero treasury");
        require(_tokenFeeBps <= 1000,       "Fortuna: fee too high");
        treasuryWallet  = _treasury;
        flatFeeNative   = _flatFeeNative;
        tokenFeeBps     = _tokenFeeBps;
        _nextScheduleId = 1; // 0 is null sentinel
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCHEDULE CREATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Create a vesting schedule.
     * @param token           ERC20 token address
     * @param beneficiary     Recipient of vested tokens
     * @param amount          Gross deposit amount (before token fee)
     * @param startTime       Unix start timestamp (0 = now)
     * @param cliffDuration   Cliff in seconds
     * @param vestingDuration Linear vesting duration in seconds (after cliff)
     * @param releaseInterval Seconds between releases (0 = continuous)
     * @param tgePercent      TGE unlock in basis points (0–10000)
     * @param revocable       Whether creator can revoke future unvested tokens
     * @param title           Human-readable label e.g. "Seed Round"
     * @param category        Filter tag e.g. "TEAM", "ADVISOR", "SEED", "ESOP"
     */
    function createSchedule(
        address token,
        address beneficiary,
        uint256 amount,
        uint64  startTime,
        uint64  cliffDuration,
        uint64  vestingDuration,
        uint64  releaseInterval,
        uint16  tgePercent,
        bool    revocable,
        string  calldata title,
        string  calldata category
    ) external payable whenNotPaused nonReentrant returns (uint256 scheduleId) {
        CreateScheduleParams memory params = CreateScheduleParams({
            token: token,
            beneficiary: beneficiary,
            amount: amount,
            startTime: startTime,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            releaseInterval: releaseInterval,
            tgePercent: tgePercent,
            revocable: revocable,
            title: title,
            category: category
        });
        return _createSchedule(
            params,
            false
        );
    }

    function createScheduleWithFortunaFee(
        address token,
        address beneficiary,
        uint256 amount,
        uint64  startTime,
        uint64  cliffDuration,
        uint64  vestingDuration,
        uint64  releaseInterval,
        uint16  tgePercent,
        bool    revocable,
        string  calldata title,
        string  calldata category
    ) external payable whenNotPaused nonReentrant returns (uint256 scheduleId) {
        CreateScheduleParams memory params = CreateScheduleParams({
            token: token,
            beneficiary: beneficiary,
            amount: amount,
            startTime: startTime,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            releaseInterval: releaseInterval,
            tgePercent: tgePercent,
            revocable: revocable,
            title: title,
            category: category
        });
        return _createSchedule(
            params,
            true
        );
    }

    function _createSchedule(
        CreateScheduleParams memory params,
        bool    payFeeInFortuna
    ) private returns (uint256 scheduleId) {
        // ── Validation ───────────────────────────────────────────────────────
        require(params.token       != address(0), "Fortuna: zero token");
        require(params.beneficiary != address(0), "Fortuna: zero beneficiary");
        require(params.amount      >  0,          "Fortuna: zero amount");
        require(params.tgePercent  <= 10000,      "Fortuna: invalid tgePercent");
        require(
            params.cliffDuration > 0 || params.vestingDuration > 0,
            "Fortuna: no cliff or vesting"
        );
        if (params.releaseInterval > 0)
            require(params.vestingDuration >= params.releaseInterval, "Fortuna: interval > duration");

        uint64 startTime = params.startTime;
        if (startTime == 0)
            startTime = uint64(block.timestamp);
        else
            require(startTime >= block.timestamp, "Fortuna: start in past");

        // ── Fees ─────────────────────────────────────────────────────────────
        _handlePlatformFee(payFeeInFortuna);
        uint256 netAllocation = _handleTokenFee(params.token, params.amount);

        // ── Store ─────────────────────────────────────────────────────────────
        scheduleId = _nextScheduleId++;

        VestingSchedule storage s = schedules[scheduleId];
        s.scheduleId         = scheduleId;
        s.token              = params.token;
        s.creator            = msg.sender;
        s.beneficiary        = params.beneficiary;
        s.totalAllocation    = netAllocation;
        s.startTime          = startTime;
        s.cliffDuration      = params.cliffDuration;
        s.vestingDuration    = params.vestingDuration;
        s.releaseInterval    = params.releaseInterval;
        s.tgePercent         = params.tgePercent;
        s.revocable          = params.revocable;
        s.title              = params.title;
        s.category           = _categoryToBytes32(params.category);
        // claimedAmount, revoked, revokedAt, vestedAtRevocation default to 0/false

        _beneficiarySchedules[params.beneficiary].push(scheduleId);
        _creatorSchedules[msg.sender].push(scheduleId);

        totalSchedules++;
        totalTokensLocked += netAllocation;
        totalTokensDeposited += netAllocation;
        tokenOutstandingAllocation[params.token] += netAllocation;

        // ── Events ────────────────────────────────────────────────────────────
        _emitScheduleCreated(
            scheduleId,
            params.beneficiary,
            params.token,
            netAllocation,
            startTime,
            params.cliffDuration,
            params.vestingDuration,
            params.releaseInterval,
            params.tgePercent,
            params.revocable
        );
        emit ScheduleMetadata(scheduleId, params.title, params.category);
    }

    /// @dev Isolated emit helper — keeps createSchedule stack depth safe.
    function _emitScheduleCreated(
        uint256 scheduleId,
        address beneficiary,
        address token,
        uint256 totalAllocation,
        uint64  startTime,
        uint64  cliffDuration,
        uint64  vestingDuration,
        uint64  releaseInterval,
        uint16  tgePercent,
        bool    revocable
    ) private {
        emit ScheduleCreated(
            scheduleId, msg.sender, beneficiary, token,
            totalAllocation, startTime, cliffDuration,
            vestingDuration, releaseInterval, tgePercent, revocable
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FEE HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    function _handlePlatformFee(bool payFeeInFortuna) internal {
        if (feeExempt[msg.sender]) {
            if (msg.value > 0) {
                (bool ok,) = msg.sender.call{value: msg.value}("");
                require(ok, "Fortuna: refund failed");
            }
            return;
        }

        if (payFeeInFortuna) {
            require(msg.value == 0, "Fortuna: native not accepted");
            _handleFortunaFee();
            return;
        }

        _handleNativeFee();
    }

    function _handleNativeFee() internal {
        require(msg.value >= flatFeeNative, "Fortuna: insufficient native fee");
        if (flatFeeNative > 0) {
            totalFeesCollectedNative += flatFeeNative;
            (bool ok,) = treasuryWallet.call{value: flatFeeNative}("");
            require(ok, "Fortuna: fee transfer failed");
        }
        uint256 excess = msg.value - flatFeeNative;
        if (excess > 0) {
            (bool ok,) = msg.sender.call{value: excess}("");
            require(ok, "Fortuna: refund failed");
        }
    }

    function _handleFortunaFee() internal {
        uint256 fortunaFeeAmount = discountedFortunaFee();
        if (fortunaFeeAmount == 0) return;

        require(fortunaFeeToken != address(0), "Fortuna: fee token not set");
        IERC20(fortunaFeeToken).safeTransferFrom(msg.sender, treasuryWallet, fortunaFeeAmount);
        totalFeesCollectedFortuna += fortunaFeeAmount;
    }

    function _handleTokenFee(address token, uint256 amount)
        internal returns (uint256 netAllocation)
    {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        require(received > 0, "Fortuna: zero received");

        uint256 tokenFee;
        if (!feeExempt[msg.sender] && tokenFeeBps > 0)
            tokenFee = (received * tokenFeeBps) / 10000;

        netAllocation = received - tokenFee;
        require(netAllocation > 0, "Fortuna: net allocation zero");
        if (tokenFee > 0) {
            IERC20(token).safeTransfer(treasuryWallet, tokenFee);
            totalFeesCollectedTokens[token] += tokenFee;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLAIM
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Claim unlocked tokens for a single schedule.
     * @dev    Revoked schedules remain claimable up to vestedAtRevocation.
     */
    function claim(uint256 scheduleId) external nonReentrant {
        VestingSchedule storage s = _getExistingSchedule(scheduleId);
        require(s.beneficiary == msg.sender, "Fortuna: not beneficiary");
        uint256 claimable = _claimableAmount(s);
        require(claimable > 0, "Fortuna: nothing to claim");
        _executeClaim(s, claimable);
    }

    /**
     * @notice Claim all unlocked tokens across every schedule owned by caller.
     * @dev    Includes revoked schedules with remaining vested balance.
     */
    function claimAll() external nonReentrant {
        uint256[] storage ids = _beneficiarySchedules[msg.sender];
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; i++) {
            VestingSchedule storage s = schedules[ids[i]];
            uint256 claimable = _claimableAmount(s);
            if (claimable == 0) continue;
            _executeClaim(s, claimable);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REVOCATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Revoke a revocable schedule.
     *
     *         Vested tokens remain claimable by the beneficiary.
     *         Unvested tokens are returned immediately to the creator.
     *
     *         Example:
     *           totalAllocation = 100,000
     *           vested          =  40,000  → beneficiary retains claim access
     *           claimedAmount   =  10,000  → already received
     *           still claimable =  30,000
     *           returned to creator = 60,000
     */
    function revokeSchedule(uint256 scheduleId) external nonReentrant {
        VestingSchedule storage s = _getExistingSchedule(scheduleId);
        require(s.creator  == msg.sender, "Fortuna: not creator");
        require(s.revocable,              "Fortuna: not revocable");
        require(!s.revoked,               "Fortuna: already revoked");

        uint256 vested   = _vestedAmount(s);
        uint256 unvested = s.totalAllocation - vested;

        s.revoked            = true;
        s.revokedAt          = uint64(block.timestamp);
        s.vestedAtRevocation = vested;

        if (unvested > 0) {
            totalTokensLocked = totalTokensLocked > unvested
                ? totalTokensLocked - unvested : 0;
            totalTokensRevoked += unvested;
            tokenOutstandingAllocation[s.token] -= unvested;
            IERC20(s.token).safeTransfer(s.creator, unvested);
        }

        emit ScheduleRevoked(scheduleId, msg.sender, vested, unvested);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VIEW FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    function claimableAmount(uint256 scheduleId) external view returns (uint256) {
        return _claimableAmount(_getExistingSchedule(scheduleId));
    }

    function lockedAmount(uint256 scheduleId) external view returns (uint256) {
        VestingSchedule storage s = _getExistingSchedule(scheduleId);
        if (s.revoked) return 0;
        uint256 vested = _vestedAmount(s);
        return s.totalAllocation > vested ? s.totalAllocation - vested : 0;
    }

    function claimedAmount(uint256 scheduleId) external view returns (uint256) {
        return _getExistingSchedule(scheduleId).claimedAmount;
    }

    function getSchedule(uint256 scheduleId)
        external view returns (VestingSchedule memory)
    {
        return _getExistingSchedule(scheduleId);
    }

    function getSchedulesByBeneficiary(address beneficiary)
        external view returns (uint256[] memory)
    {
        return _beneficiarySchedules[beneficiary];
    }

    function getSchedulesByCreator(address creator)
        external view returns (uint256[] memory)
    {
        return _creatorSchedules[creator];
    }

    function discountedFortunaFee() public view returns (uint256) {
        if (flatFeeFortuna == 0) return 0;
        return (flatFeeFortuna * (10000 - uint256(fortunaFeeDiscountBps))) / 10000;
    }

    function totalOutstandingAllocation() public view returns (uint256) {
        return totalTokensDeposited - totalTokensClaimed - totalTokensRevoked;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────────────────────────────────────

    function setFlatFee(uint256 _flatFeeNative) external onlyOwner {
        flatFeeNative = _flatFeeNative;
        emit FeeUpdated(_flatFeeNative, tokenFeeBps);
    }

    function setTokenFeeBps(uint256 _tokenFeeBps) external onlyOwner {
        require(_tokenFeeBps <= 1000, "Fortuna: fee too high");
        tokenFeeBps = _tokenFeeBps;
        emit FeeUpdated(flatFeeNative, _tokenFeeBps);
    }

    function setFortunaFeeConfig(
        address _feeToken,
        uint256 _flatFeeFortuna,
        uint16 _discountBps
    ) external onlyOwner {
        require(_discountBps <= 10000, "Fortuna: invalid discount");
        if (_flatFeeFortuna > 0) {
            require(_feeToken != address(0), "Fortuna: fee token not set");
        }

        fortunaFeeToken = _feeToken;
        flatFeeFortuna = _flatFeeFortuna;
        fortunaFeeDiscountBps = _discountBps;

        emit FortunaFeeConfigUpdated(_feeToken, _flatFeeFortuna, _discountBps);
    }

    function setTreasuryWallet(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Fortuna: zero treasury");
        treasuryWallet = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function addFeeExempt(address wallet) external onlyOwner {
        feeExempt[wallet] = true;
        emit FeeExemptionUpdated(wallet, true);
    }

    function removeFeeExempt(address wallet) external onlyOwner {
        feeExempt[wallet] = false;
        emit FeeExemptionUpdated(wallet, false);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "Fortuna: zero token");
        require(to != address(0), "Fortuna: zero recipient");

        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 reserved = tokenOutstandingAllocation[token];
        require(balance > reserved, "Fortuna: no excess");
        uint256 maxRescuable = balance - reserved;
        require(amount <= maxRescuable, "Fortuna: rescue exceeds excess");

        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    function rescueNative(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Fortuna: zero recipient");
        require(address(this).balance >= amount, "Fortuna: insufficient native");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Fortuna: native rescue failed");
        emit NativeRescued(to, amount);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL — VESTING MATH
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Timeline:
     *      t < startTime              → 0
     *      startTime ≤ t < cliffEnd   → TGE only
     *      cliffEnd  ≤ t < vestingEnd → TGE + linear (snapped to releaseInterval)
     *      t ≥ vestingEnd             → 100%
     */
    function _vestedAmount(VestingSchedule storage s) internal view returns (uint256) {
        if (block.timestamp < s.startTime) return 0;

        uint256 tgeAmount = (s.totalAllocation * s.tgePercent) / 10000;
        uint64  cliffEnd  = s.startTime + s.cliffDuration;

        if (block.timestamp < cliffEnd) return tgeAmount;
        if (s.vestingDuration == 0)     return s.totalAllocation;

        uint64 vestingEnd = cliffEnd + s.vestingDuration;
        if (block.timestamp >= vestingEnd) return s.totalAllocation;

        uint256 elapsed = block.timestamp - cliffEnd;
        if (s.releaseInterval > 0)
            elapsed = (elapsed / s.releaseInterval) * s.releaseInterval;

        uint256 remaining = s.totalAllocation - tgeAmount;
        return tgeAmount + (remaining * elapsed) / s.vestingDuration;
    }

    /**
     * @dev Post-revocation: ceiling is the vestedAtRevocation snapshot.
     *      Pre-revocation: ceiling is live _vestedAmount.
     */
    function _claimableAmount(VestingSchedule storage s) internal view returns (uint256) {
        uint256 ceiling = s.revoked ? s.vestedAtRevocation : _vestedAmount(s);
        return ceiling > s.claimedAmount ? ceiling - s.claimedAmount : 0;
    }

    function _executeClaim(VestingSchedule storage s, uint256 amount) internal {
        s.claimedAmount    += amount;
        totalTokensClaimed += amount;
        totalTokensLocked   = totalTokensLocked > amount ? totalTokensLocked - amount : 0;
        tokenOutstandingAllocation[s.token] -= amount;
        IERC20(s.token).safeTransfer(s.beneficiary, amount);
        emit TokensClaimed(s.scheduleId, s.beneficiary, s.token, amount);
    }

    function _getExistingSchedule(uint256 scheduleId)
        internal
        view
        returns (VestingSchedule storage s)
    {
        s = schedules[scheduleId];
        require(s.scheduleId != 0, "Fortuna: invalid schedule");
    }

    function _categoryToBytes32(string memory category) internal pure returns (bytes32 value) {
        bytes memory raw = bytes(category);
        require(raw.length <= 32, "Fortuna: category too long");
        if (raw.length == 0) return bytes32(0);
        assembly {
            value := mload(add(raw, 32))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FALLBACK
    // ─────────────────────────────────────────────────────────────────────────

    receive() external payable {
        revert("Fortuna: use createSchedule");
    }
}
