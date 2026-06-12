# Fortuna Smart Contracts - Token Contract

Fortuna is a utility-focused blockchain ecosystem designed to support rewards, staking, governance, AI-powered services, and long-term community participation.

This repository contains the core smart contracts powering the Fortuna ecosystem.

## Core Token Contract

Path:
- `contracts/token/FortunaToken.sol`

Contract:
- `FortunaToken`

## Features

- ERC20 standard
- Burnable
- Mintable (owner controlled)
- Permit (EIP-2612)
- Votes / governance-ready
- OpenZeppelin security standards

## Current Configuration

- Name: `FortunaToken`
- Symbol: `FORT`
- Initial Supply: `1,000,000,000` tokens
- Mint extension target (staking layer): up to `100,000,000` additional tokens (planning context; governance/policy controlled)

## Constructor Parameters

`FortunaToken` constructor:
- `recipient` (`address`): receives initial supply
- `initialOwner` (`address`): contract owner with mint permissions

`.env` variables used by deploy/verify flow:
- `TOKEN_RECIPIENT`
- `TOKEN_INITIAL_OWNER`

## Deploy Token

Base Sepolia:
```bash
npm run deploy:token -- --network baseSepolia
```

Base Mainnet:
```bash
npm run deploy:token -- --network base
```

## Verify Token (Etherscan V2)

Token verification uses constructor args from `.env`.

```bash
npm run verify:token -- --network baseSepolia --address <TOKEN_DEPLOYED_ADDRESS>
```

Required env:
- `ETHERSCAN_API_KEY`
- `TOKEN_RECIPIENT`
- `TOKEN_INITIAL_OWNER`

## Related Planning Context

For full ecosystem tokenomics, launch sequence, and allocation matrix, see:
- `docs/ecosystem-launch-blueprint.md`

## Planned Contracts

### Staking Contract
Responsible for:
- Token staking
- Reward distribution
- APY calculations
- Reward claiming

### Vesting Contract
Responsible for:
- Team token vesting
- Advisor vesting
- Treasury unlock schedules
- Investor vesting schedules

### Treasury Contract
Responsible for:
- Treasury management
- Buyback execution
- Ecosystem funding
- Community grants

### Governance Contract
Responsible for:
- Proposal creation
- Community voting
- Treasury governance
- Ecosystem decisions

## Technology Stack

- Solidity `^0.8.28`
- OpenZeppelin Contracts `^5.x`
- Base Network
- Ethereum-compatible (EVM)

## Repository Structure (Current + Planned)

```text
contracts/
├── token/
│   └── FortunaToken.sol
├── vesting/
│   └── FortunaVestingProtocol.sol
├── staking/                    (planned)
├── treasury/                   (planned)
├── governance/                 (planned)
├── interfaces/                 (planned)
├── libraries/                  (planned)
└── mocks/

scripts/
├── deploy/
├── verify/                     (task-based verify currently)
└── local/

test/
├── vesting/
└── token/                      (planned)

docs/
```

## Deployment Networks

- Base Sepolia: development and testing
- Base Mainnet: planned production deployment

## Security

The project uses OpenZeppelin audited libraries and follows established Ethereum security practices.

Recommended before mainnet:
- Independent smart contract audit
- Multisig ownership
- Treasury access controls
- Comprehensive test coverage
