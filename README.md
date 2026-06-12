# Fortuna Smart Contracts

Fortuna contracts are built with Hardhat for local development, testing, and Base deployment.

## Stack
- Solidity `^0.8.28`
- OpenZeppelin `^5.6.0`
- Hardhat `^2.28.6`
- EVM target: `cancun`
- Optimizer: enabled, 200 runs, `viaIR: true`

## Project Structure
```text
contracts/
├── vesting/
│   └── FortunaVestingProtocol.sol
├── token/
│   └── FortunaToken.sol
└── mocks/
    ├── TestToken.sol
    └── Hello.sol

scripts/
├── deploy/
│   ├── deploy-token.js
│   └── deploy-vesting.js
└── local/
    └── create-funded-wallets.js

test/
└── vesting/
    └── FortunaVestingProtocol.test.js

docs/
├── ecosystem-launch-blueprint.md
├── fortuna-token-contract.md
└── fortuna-vesting-protocol.md
```

## Setup
### 1) Install dependencies
```bash
npm install
```

### 2) Configure environment
```bash
cp .env.example .env
```
Set these values for Base deployments:
- `BASE_SEPOLIA_RPC_URL`
- `BASE_MAINNET_RPC_URL`
- `PRIVATE_KEY`
- `ETHERSCAN_API_KEY`

`ETHERSCAN_API_KEY` must be a single key from `etherscan.io` (V2 multichain), not explorer-specific keys.

Optional:
- `LOCALHOST_RPC_URL` (default: `http://127.0.0.1:8545`)
- `LOCAL_MNEMONIC` (12-word seed for deterministic local wallets)
- `LOCAL_HD_PATH` (default: `m/44'/60'/0'/0`)
- `LOCAL_ACCOUNT_COUNT` (how many deterministic node accounts to expose)
- `LOCAL_INITIAL_BALANCE_WEI` (per-account local node balance)
- `TREASURY_WALLET`
- `FLAT_FEE_NATIVE`
- `TOKEN_FEE_BPS`
- `TOKEN_RECIPIENT`
- `TOKEN_INITIAL_OWNER`

## Local Hardhat Network Workflow
### 1) Start local node
```bash
npm run node:local
```
Keep this running in terminal window 1.

### 2) Create and fund new wallets with ETH
In terminal window 2:
```bash
npm run local:wallets
```
Defaults:
- prepares `3` deterministic wallets from `LOCAL_MNEMONIC`
- target balance is `10` ETH each

Override values:
```bash
LOCAL_WALLET_COUNT=5 LOCAL_WALLET_AMOUNT_ETH=25 npm run local:wallets
```
Generated wallets are saved to `.local/wallets.json`.

Role mapping:
- wallet 1: `owner`
- wallet 2: `treasury`
- wallet 3: `creator`
- wallet 4: `beneficiary`
- wallet 5+: `wallet_N`

### 3) Deploy contracts to localhost (optional)
```bash
npm run local:deploy:token
npm run local:deploy:vesting
```

### 4) Run tests against localhost
```bash
npm run local:test
```

## Standard Compile/Test (ephemeral Hardhat network)
```bash
npm run compile
npm test
```

## Base Deployment
### Base Sepolia
```bash
npm run deploy:token -- --network baseSepolia
npm run deploy:vesting -- --network baseSepolia
```

### Base Mainnet
```bash
npm run deploy:token -- --network base
npm run deploy:vesting -- --network base
```

## Verify (Basescan / Etherscan V2)
Constructor args are loaded from `.env`. You only pass deployed contract address.

Token contract:
```bash
npm run verify:token -- --network baseSepolia --address <TOKEN_DEPLOYED_ADDRESS>
```

Vesting contract:
```bash
npm run verify:vesting -- --network baseSepolia --address <VESTING_DEPLOYED_ADDRESS>
```

Required `.env` for verify:
- `ETHERSCAN_API_KEY`
- `TOKEN_RECIPIENT`
- `TOKEN_INITIAL_OWNER`
- `TREASURY_WALLET`
- `FLAT_FEE_NATIVE` (in ETH units, e.g. `0.01`)
- `TOKEN_FEE_BPS` (integer, e.g. `25`)

## Available Scripts
- `npm run clean`
- `npm run compile`
- `npm test`
- `npm run node`
- `npm run node:local`
- `npm run local:wallets`
- `npm run local:deploy:token`
- `npm run local:deploy:vesting`
- `npm run local:test`
- `npm run deploy:token -- --network <baseSepolia|base>`
- `npm run deploy:vesting -- --network <baseSepolia|base>`
- `npm run verify:token -- --network <baseSepolia|base> --address <ADDRESS>`
- `npm run verify:vesting -- --network <baseSepolia|base> --address <ADDRESS>`
