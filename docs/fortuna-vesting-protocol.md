# Fortuna Vesting Protocol - Product Requirements Document (PRD)

## Version

v1.0

## Status

Draft

## Purpose

Fortuna Vesting Protocol is a reusable ERC20 token vesting platform that allows projects to create and manage token vesting schedules using a single protocol contract.

The protocol will support:

* Team vesting
* Advisor vesting
* Investor vesting
* Employee ESOPs
* Treasury vesting
* Launchpad token distribution vesting
* Public SaaS usage

The protocol must support configurable platform fees, fee exemptions, release cycles, revocable schedules, and multiple vesting models.

---

# Design Principles

* Single contract architecture
* No vesting contract deployment per schedule
* Low gas costs
* Easy frontend integration
* Scalable to thousands of schedules
* Compatible with any ERC20 token
* Reusable as a commercial product

---

# Architecture

```text
FortunaVestingProtocol

├── Schedule Registry
├── Claim Engine
├── Release Engine
├── Fee Engine
├── Revocation Engine
├── Analytics Engine
└── Treasury Integration
```

---

# Supported Tokens

The protocol must support:

* Any ERC20 token
* Fortuna Token
* Third-party project tokens

LP tokens are out of scope for V1.

---

# Vesting Schedule Model

Each vesting schedule is stored as a record.

Example structure:

```solidity
struct VestingSchedule {
    uint256 scheduleId;

    address token;
    address creator;
    address beneficiary;

    uint256 totalAllocation;
    uint256 claimedAmount;

    uint64 startTime;

    uint64 cliffDuration;
    uint64 vestingDuration;

    uint64 releaseInterval;

    uint16 tgePercent;

    bool revocable;
    bool revoked;
}
```

---

# Supported Vesting Types

## Type 1 - Cliff Only

Tokens remain locked until cliff completion.

Example:

* Allocation: 1,000,000
* Cliff: 12 Months

Result:

* 0 claimable before cliff
* 100% claimable after cliff

---

## Type 2 - Linear Vesting

Continuous vesting from start date.

Example:

* Allocation: 1,000,000
* Duration: 24 Months

Result:

* Tokens unlock continuously over duration

---

## Type 3 - Cliff + Linear Vesting

Most common startup model.

Example:

* Allocation: 1,000,000
* Cliff: 12 Months
* Vesting: 24 Months

Result:

* Nothing claimable during cliff
* Linear vesting begins after cliff

---

## Type 4 - TGE + Cliff + Linear Vesting

Common launchpad model.

Example:

* Allocation: 1,000,000
* TGE Unlock: 10%
* Cliff: 6 Months
* Vesting: 18 Months

Result:

* 100,000 immediately claimable
* Remaining tokens locked
* Vesting starts after cliff

---

# Release Cycle Support

The protocol must support configurable release intervals.

Instead of continuous unlocking, projects may release tokens periodically.

Supported intervals:

```text
Daily
Weekly
Monthly
Quarterly
Custom Seconds
```

Examples:

### Monthly Release

* Allocation: 120,000
* Vesting: 12 Months
* Release Cycle: Monthly

Result:

* 10,000 released each month

---

### Quarterly Release

* Allocation: 120,000
* Vesting: 12 Months
* Release Cycle: Quarterly

Result:

* 30,000 released every quarter

---

### Weekly Release

* Allocation: 52,000
* Vesting: 12 Months

Result:

* 1,000 released each week

---

# Revocable Vesting

Optional per schedule.

## Revocable = True

Creator may revoke future vesting.

Already vested tokens remain claimable.

Unvested tokens return to creator.

Suitable for:

* Employees
* Advisors
* Contractors

---

## Revocable = False

Creator cannot revoke.

Suitable for:

* Investors
* Public Sale Participants
* Team Allocations

---

# Schedule Creation

Function:

```solidity
createSchedule(...)
```

Must:

* Validate parameters
* Collect fees
* Transfer tokens
* Store schedule
* Emit event

---

# Claim Functionality

## Claim Tokens

Function:

```solidity
claim(scheduleId)
```

Requirements:

* Partial claims supported
* Multiple claims supported
* Accurate vesting calculations
* Prevent over-claiming

---

## Claim All

Function:

```solidity
claimAll()
```

Claims all available tokens across all schedules.

---

# View Functions

## Beneficiary Schedules

```solidity
getSchedulesByBeneficiary(address)
```

Returns all schedules owned by beneficiary.

---

## Creator Schedules

```solidity
getSchedulesByCreator(address)
```

Returns all schedules created by wallet.

---

## Claimable Amount

```solidity
claimableAmount(scheduleId)
```

---

## Locked Amount

```solidity
lockedAmount(scheduleId)
```

---

## Claimed Amount

```solidity
claimedAmount(scheduleId)
```

---

# Platform Fees

The protocol supports both fixed fees and token-based fees.

---

## Flat Native Fee

Example:

```text
0.01 ETH
```

Charged during schedule creation.

Configurable by admin.

---

## Token Percentage Fee

Example:

```text
0.25%
```

Charged from deposited token allocation.

Example:

* User deposits 1,000,000 tokens
* Fee = 2,500 tokens
* Vested amount = 997,500 tokens

Configurable by admin.

---

## Hybrid Fee

Combination of:

* Native fee
* Token fee

Both applied simultaneously.

---

# Fee Exemption System

Fortuna-owned wallets may use the protocol without fees.

```solidity
mapping(address => bool) public feeExempt;
```

---

## Fee Exempt Examples

* Fortuna Treasury
* Founder Wallets
* Team Wallets
* Internal Launchpad Contracts

---

# Treasury Configuration

All collected fees are sent directly to:

```solidity
treasuryWallet
```

Admin configurable.

Function:

```solidity
setTreasuryWallet(address)
```

The protocol does not perform:

* Buybacks
* Burns
* Swaps

Treasury manages those separately.

---

# Administration

Owner-only functions:

```solidity
setFlatFee()

setTokenFeeBps()

setTreasuryWallet()

addFeeExempt()

removeFeeExempt()

pause()

unpause()
```

---

# Analytics

Protocol should track:

```solidity
totalSchedules()

totalTokensLocked()

totalTokensClaimed()

totalFeesCollectedNative()

totalFeesCollectedTokens()
```

---

# Events

```solidity
ScheduleCreated

TokensClaimed

ScheduleRevoked

FeeExemptionUpdated

TreasuryUpdated

FeeUpdated
```

---

# Security Requirements

Must use:

* OpenZeppelin Ownable
* OpenZeppelin ReentrancyGuard
* OpenZeppelin SafeERC20
* OpenZeppelin Pausable

Validation:

* No zero beneficiary
* No zero allocation
* No invalid timestamps
* No invalid release intervals

---

# Frontend Requirements

Dashboard must support:

* My Vestings
* Claimable Tokens
* Total Locked Tokens
* Claimed Tokens
* Vesting Progress
* Claim All Button
* Schedule History

---

# MVP Scope

Included:

* Single protocol contract
* Any ERC20 support
* Cliff vesting
* Linear vesting
* Cliff + vesting
* TGE unlock
* Release cycles
* Revocable schedules
* Flat fees
* Token percentage fees
* Fee exemptions
* Treasury routing
* Analytics
* Claim All

Excluded:

* NFT vesting positions
* Multi-signature approvals
* Governance
* Upgradeability
* LP token locks
* Cross-chain vesting

```
```
