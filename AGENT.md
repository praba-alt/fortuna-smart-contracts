# AGENT.md

## Project Snapshot
Fortuna Contracts currently centers on:
- `FortunaToken` (ERC20 + Burnable + Permit + Votes + owner minting)
- `FortunaVestingProtocol` (single-contract vesting protocol with platform fee support and admin controls)

Based on existing docs:
- `README.md`: ecosystem context and planned future modules (staking, treasury, governance).
- `docs/fortuna-token-contract.md`: token specification, deploy, and verify flow.
- `docs/fortuna-vesting-protocol.md`: PRD for vesting behavior, fee model, analytics, and security expectations.
- `docs/ecosystem-launch-blueprint.md`: ecosystem tokenomics and launch blueprint from latest user planning input.

## Current Setup Decision
Hardhat environment is standardized to one compiler line for all contracts:
- Solidity: `^0.8.28`
- OpenZeppelin: `5.6.0`
- Optimizer: enabled, 200 runs
- `viaIR`: enabled

This ensures all current contracts compile under a single Base-compatible EVM toolchain.

## Hardhat Workspace Added
- `hardhat.config.js`
- `contracts/` as the canonical Solidity source tree
- `scripts/deploy/deploy-vesting.js`
- `scripts/deploy/deploy-token.js`
- `scripts/local/create-funded-wallets.js`
- `tasks/verify.js`
- `test/vesting/FortunaVestingProtocol.test.js`
- `.env.example`

NPM scripts:
- `npm run compile`
- `npm run test`
- `npm run node`
- `npm run node:local`
- `npm run local:wallets`
- `npm run local:test`
- `npm run deploy:vesting -- --network baseSepolia`
- `npm run deploy:token -- --network baseSepolia`
- `npm run verify:token -- --network baseSepolia --address <address>`
- `npm run verify:vesting -- --network baseSepolia --address <address>`

## Token Contract Instructions

Token contract:
- Path: `contracts/token/FortunaToken.sol`
- Contract name: `FortunaToken`
- Constructor: `(address recipient, address initialOwner)`

Deploy token:
- `npm run deploy:token -- --network baseSepolia`
- `npm run deploy:token -- --network base`

Verify token:
- `npm run verify:token -- --network baseSepolia --address <token_address>`
- `npm run verify:token -- --network base --address <token_address>`

Token verify constructor args are loaded from `.env`:
- `TOKEN_RECIPIENT`
- `TOKEN_INITIAL_OWNER`
- `ETHERSCAN_API_KEY`

## Latest Planning Context (Saved)

The latest user-provided blueprint is captured in:
- `docs/ecosystem-launch-blueprint.md`

Key locked planning targets from that input:
- Genesis supply: `1,000,000,000`
- Additional staking mint extension: `+100,000,000` max layer
- Launch price reference: `GBP 0.012`
- Weekly revenue buyback-and-burn policy target: `10%`

Pending resolution before immutable contract updates:
- Private sale vesting conflict (`6-month` vs `9-month` cliff)
- Build window conflict (`2-3` vs `2-5` months)
- CEX liquidity conflict (`15% / 150M` vs `10% / 100M`)

## Contract Scope Under Test
Current baseline tests cover:
- Constructor initialization
- Schedule creation with native + token fees
- Revocation behavior where vested balances remain claimable

## Assumptions Captured
- Base Sepolia is default deployment target for iteration.
- Base mainnet deployment will reuse same artifacts/scripts with production env values.
- Contract sources now live directly under `contracts/` (no import-wrapper entry files).

## Inputs Needed For Full Plan (Next Materials)
Provide when ready:
1. Final tokenomics and vesting parameter matrix (team, advisor, investor, treasury, public).
2. Role/ownership model for production (EOA vs multisig addresses).
3. Target deployment order and chain list (Base Sepolia only vs multi-chain rollout).
4. Required test depth (unit only vs fork/integration + coverage threshold).
5. Verification and CI requirements (GitHub Actions, linting, static analysis, gas snapshots).
6. Audit readiness checklist and release gates.

## Immediate Next Execution Steps
After receiving the additional materials, expand to:
- scenario-based vesting math tests per category
- deployment manifests per environment
- verification automation
- CI pipeline and release checklist
