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
        string  category;           // e.g. "TEAM", "ADVISOR", "SEED"
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────────────────

    uint256 private _nextScheduleId;

    mapping(uint256 => VestingSchedule) public schedules;
    mapping(address => uint256[]) private _beneficiarySchedules;
    mapping(address => uint256[]) private _creatorSchedules;

    uint256 public flatFeeNative;
    uint256 public tokenFeeBps;
    address public treasuryWallet;
    mapping(address => bool) public feeExempt;

    uint256 public totalSchedules;
    uint256 public totalTokensLocked;
    uint256 public totalTokensClaimed;
    uint256 public totalFeesCollectedNative;
    mapping(address => uint256) public totalFeesCollectedTokens;

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
        // ── Validation ───────────────────────────────────────────────────────
        require(token       != address(0), "Fortuna: zero token");
        require(beneficiary != address(0), "Fortuna: zero beneficiary");
        require(amount      >  0,          "Fortuna: zero amount");
        require(tgePercent  <= 10000,      "Fortuna: invalid tgePercent");
        require(cliffDuration > 0 || vestingDuration > 0, "Fortuna: no cliff or vesting");
        if (releaseInterval > 0)
            require(vestingDuration >= releaseInterval, "Fortuna: interval > duration");
        if (startTime == 0)
            startTime = uint64(block.timestamp);
        else
            require(startTime >= block.timestamp, "Fortuna: start in past");

        // ── Fees ─────────────────────────────────────────────────────────────
        _handleNativeFee();
        uint256 netAllocation = _handleTokenFee(token, amount);

        // ── Store ─────────────────────────────────────────────────────────────
        scheduleId = _nextScheduleId++;

        VestingSchedule storage s = schedules[scheduleId];
        s.scheduleId         = scheduleId;
        s.token              = token;
        s.creator            = msg.sender;
        s.beneficiary        = beneficiary;
        s.totalAllocation    = netAllocation;
        s.startTime          = startTime;
        s.cliffDuration      = cliffDuration;
        s.vestingDuration    = vestingDuration;
        s.releaseInterval    = releaseInterval;
        s.tgePercent         = tgePercent;
        s.revocable          = revocable;
        s.title              = title;
        s.category           = category;
        // claimedAmount, revoked, revokedAt, vestedAtRevocation default to 0/false

        _beneficiarySchedules[beneficiary].push(scheduleId);
        _creatorSchedules[msg.sender].push(scheduleId);

        totalSchedules++;
        totalTokensLocked += netAllocation;

        // ── Events ────────────────────────────────────────────────────────────
        _emitScheduleCreated(scheduleId, beneficiary, token, netAllocation,
            startTime, cliffDuration, vestingDuration, releaseInterval,
            tgePercent, revocable);
        emit ScheduleMetadata(scheduleId, title, category);
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

    function _handleNativeFee() internal {
        if (feeExempt[msg.sender]) {
            if (msg.value > 0) {
                (bool ok,) = msg.sender.call{value: msg.value}("");
                require(ok, "Fortuna: refund failed");
            }
            return;
        }
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

    function _handleTokenFee(address token, uint256 amount)
        internal returns (uint256 netAllocation)
    {
        uint256 tokenFee;
        if (!feeExempt[msg.sender] && tokenFeeBps > 0)
            tokenFee = (amount * tokenFeeBps) / 10000;

        netAllocation = amount - tokenFee;
        require(netAllocation > 0, "Fortuna: net allocation zero");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
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
    function claim(uint256 scheduleId) external whenNotPaused nonReentrant {
        VestingSchedule storage s = schedules[scheduleId];
        require(s.beneficiary == msg.sender, "Fortuna: not beneficiary");
        uint256 claimable = _claimableAmount(s);
        require(claimable > 0, "Fortuna: nothing to claim");
        _executeClaim(s, claimable);
    }

    /**
     * @notice Claim all unlocked tokens across every schedule owned by caller.
     * @dev    Includes revoked schedules with remaining vested balance.
     */
    function claimAll() external whenNotPaused nonReentrant {
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
        VestingSchedule storage s = schedules[scheduleId];
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
            IERC20(s.token).safeTransfer(s.creator, unvested);
        }

        emit ScheduleRevoked(scheduleId, msg.sender, vested, unvested);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VIEW FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    function claimableAmount(uint256 scheduleId) external view returns (uint256) {
        return _claimableAmount(schedules[scheduleId]);
    }

    function lockedAmount(uint256 scheduleId) external view returns (uint256) {
        VestingSchedule storage s = schedules[scheduleId];
        if (s.revoked) return 0;
        uint256 vested = _vestedAmount(s);
        return s.totalAllocation > vested ? s.totalAllocation - vested : 0;
    }

    function claimedAmount(uint256 scheduleId) external view returns (uint256) {
        return schedules[scheduleId].claimedAmount;
    }

    function getSchedule(uint256 scheduleId)
        external view returns (VestingSchedule memory)
    {
        return schedules[scheduleId];
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
        IERC20(s.token).safeTransfer(s.beneficiary, amount);
        emit TokensClaimed(s.scheduleId, s.beneficiary, s.token, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FALLBACK
    // ─────────────────────────────────────────────────────────────────────────

    receive() external payable {
        revert("Fortuna: use createSchedule");
    }
}
