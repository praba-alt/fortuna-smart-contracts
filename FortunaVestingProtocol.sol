// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title FortunaVestingProtocol
 * @notice Single-contract ERC20 vesting platform supporting cliff, linear,
 *         TGE, release cycles, revocation, platform fees, and fee exemptions.
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
        uint256 totalAllocation;
        uint256 claimedAmount;
        uint64  startTime;
        uint64  cliffDuration;
        uint64  vestingDuration;
        uint64  releaseInterval;
        uint16  tgePercent;
        bool    revocable;
        bool    revoked;
    }

    /// @dev Calldata bundle to avoid stack-too-deep in createSchedule
    struct ScheduleParams {
        address token;
        address beneficiary;
        uint256 amount;
        uint64  startTime;
        uint64  cliffDuration;
        uint64  vestingDuration;
        uint64  releaseInterval;
        uint16  tgePercent;
        bool    revocable;
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
    event TokensClaimed(uint256 indexed scheduleId, address indexed beneficiary, address token, uint256 amount);
    event ScheduleRevoked(uint256 indexed scheduleId, address indexed creator, uint256 unvestedReturned);
    event FeeExemptionUpdated(address indexed wallet, bool exempt);
    event TreasuryUpdated(address indexed newTreasury);
    event FeeUpdated(uint256 flatFeeNative, uint256 tokenFeeBps);

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _treasury, uint256 _flatFeeNative, uint256 _tokenFeeBps)
        Ownable(msg.sender)
    {
        require(_treasury != address(0), "Fortuna: zero treasury");
        require(_tokenFeeBps <= 1000,    "Fortuna: fee too high");
        treasuryWallet = _treasury;
        flatFeeNative  = _flatFeeNative;
        tokenFeeBps    = _tokenFeeBps;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCHEDULE CREATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Create a vesting schedule.
     * @param token           ERC20 token address
     * @param beneficiary     Recipient of vested tokens
     * @param amount          Gross token amount to deposit (before token fee)
     * @param startTime       Unix timestamp for vesting start (0 = now)
     * @param cliffDuration   Cliff in seconds
     * @param vestingDuration Linear vesting duration in seconds (starts after cliff)
     * @param releaseInterval Seconds between periodic releases (0 = continuous)
     * @param tgePercent      TGE unlock in basis points (0–10000)
     * @param revocable       Whether creator can revoke future vesting
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
        bool    revocable
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        ScheduleParams memory p;
        p.token           = token;
        p.beneficiary     = beneficiary;
        p.amount          = amount;
        p.startTime       = startTime;
        p.cliffDuration   = cliffDuration;
        p.vestingDuration = vestingDuration;
        p.releaseInterval = releaseInterval;
        p.tgePercent      = tgePercent;
        p.revocable       = revocable;
        return _createSchedule(p);
    }

    function _validateParams(ScheduleParams memory p) internal view {
        require(p.token       != address(0), "Fortuna: zero token");
        require(p.beneficiary != address(0), "Fortuna: zero beneficiary");
        require(p.amount      >  0,          "Fortuna: zero amount");
        require(p.tgePercent  <= 10000,      "Fortuna: invalid tgePercent");
        require(p.cliffDuration > 0 || p.vestingDuration > 0, "Fortuna: no cliff or vesting");
        if (p.releaseInterval > 0) {
            require(p.vestingDuration >= p.releaseInterval, "Fortuna: interval > duration");
        }
        require(p.startTime == 0 || p.startTime >= block.timestamp, "Fortuna: start in past");
    }

    function _createSchedule(ScheduleParams memory p) internal returns (uint256 scheduleId) {
        _validateParams(p);
        if (p.startTime == 0) p.startTime = uint64(block.timestamp);

        _handleNativeFee();
        uint256 netAllocation = _handleTokenFee(p.token, p.amount);

        scheduleId = _storeSchedule(p, netAllocation);
    }

    function _storeSchedule(ScheduleParams memory p, uint256 netAllocation)
        internal returns (uint256 scheduleId)
    {
        scheduleId = _nextScheduleId++;

        VestingSchedule storage s = schedules[scheduleId];
        s.scheduleId      = scheduleId;
        s.token           = p.token;
        s.creator         = msg.sender;
        s.beneficiary     = p.beneficiary;
        s.totalAllocation = netAllocation;
        s.claimedAmount   = 0;
        s.startTime       = p.startTime;
        s.cliffDuration   = p.cliffDuration;
        s.vestingDuration = p.vestingDuration;
        s.releaseInterval = p.releaseInterval;
        s.tgePercent      = p.tgePercent;
        s.revocable       = p.revocable;
        s.revoked         = false;

        _beneficiarySchedules[p.beneficiary].push(scheduleId);
        _creatorSchedules[msg.sender].push(scheduleId);

        totalSchedules++;
        totalTokensLocked += netAllocation;

        emit ScheduleCreated(
            scheduleId, msg.sender, p.beneficiary, p.token,
            netAllocation, p.startTime, p.cliffDuration,
            p.vestingDuration, p.releaseInterval, p.tgePercent, p.revocable
        );
    }

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
        if (!feeExempt[msg.sender] && tokenFeeBps > 0) {
            tokenFee = (amount * tokenFeeBps) / 10000;
        }
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

    /// @notice Claim all currently unlocked tokens for a single schedule.
    function claim(uint256 scheduleId) external whenNotPaused nonReentrant {
        VestingSchedule storage s = schedules[scheduleId];
        require(s.beneficiary == msg.sender, "Fortuna: not beneficiary");
        require(!s.revoked,                  "Fortuna: schedule revoked");
        uint256 claimable = _claimableAmount(s);
        require(claimable > 0, "Fortuna: nothing to claim");
        _executeClaim(s, claimable);
    }

    /// @notice Claim all unlocked tokens across every schedule owned by caller.
    function claimAll() external whenNotPaused nonReentrant {
        uint256[] storage ids = _beneficiarySchedules[msg.sender];
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; i++) {
            VestingSchedule storage s = schedules[ids[i]];
            if (s.revoked) continue;
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
     *         Already-vested tokens remain claimable; unvested tokens return to creator.
     */
    function revokeSchedule(uint256 scheduleId) external nonReentrant {
        VestingSchedule storage s = schedules[scheduleId];
        require(s.creator == msg.sender, "Fortuna: not creator");
        require(s.revocable,             "Fortuna: not revocable");
        require(!s.revoked,              "Fortuna: already revoked");

        uint256 vested   = _vestedAmount(s);
        uint256 unvested = s.totalAllocation - vested;
        s.revoked = true;

        if (unvested > 0) {
            totalTokensLocked = totalTokensLocked > unvested ? totalTokensLocked - unvested : 0;
            IERC20(s.token).safeTransfer(s.creator, unvested);
        }

        emit ScheduleRevoked(scheduleId, msg.sender, unvested);
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

    function getSchedule(uint256 scheduleId)
        external view returns (VestingSchedule memory)
    {
        return schedules[scheduleId];
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

    function pause() external onlyOwner { _pause(); }

    function unpause() external onlyOwner { _unpause(); }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL — VESTING MATH
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Computes total vested tokens (TGE + linear) at current timestamp.
     *
     *  Timeline:
     *  t < startTime                  → 0
     *  startTime <= t < cliffEnd      → TGE only
     *  cliffEnd  <= t < vestingEnd    → TGE + proportional linear (snapped to releaseInterval)
     *  t >= vestingEnd                → 100%
     */
    function _vestedAmount(VestingSchedule storage s) internal view returns (uint256) {
        if (block.timestamp < s.startTime) return 0;

        uint256 tgeAmount = (s.totalAllocation * s.tgePercent) / 10000;
        uint64  cliffEnd  = s.startTime + s.cliffDuration;

        if (block.timestamp < cliffEnd) return tgeAmount;

        uint256 remaining  = s.totalAllocation - tgeAmount;
        uint64  vestingEnd = cliffEnd + s.vestingDuration;

        if (s.vestingDuration == 0 || block.timestamp >= vestingEnd) {
            return s.totalAllocation;
        }

        uint256 elapsed = block.timestamp - cliffEnd;
        if (s.releaseInterval > 0) {
            elapsed = (elapsed / s.releaseInterval) * s.releaseInterval;
        }

        return tgeAmount + (remaining * elapsed) / s.vestingDuration;
    }

    function _claimableAmount(VestingSchedule storage s) internal view returns (uint256) {
        if (s.revoked) return 0;
        uint256 vested = _vestedAmount(s);
        return vested > s.claimedAmount ? vested - s.claimedAmount : 0;
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
