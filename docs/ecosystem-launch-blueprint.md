# Ecosystem Specification & Launch Blueprint (Working Context)

Source: user-provided planning input (pasted text). This document is treated as the active planning baseline until superseded.

## 1) Core Supply Framework

- Initial genesis supply at launch (Day 1): `1,000,000,000` tokens.
- Token type: OpenZeppelin ERC20 utility token with mint and burn support.
- Additional mint extension for staking rewards: up to `+10.00%` (`100,000,000` tokens) on top of genesis supply.
- Launch unit price reference: `GBP 0.012`.
- Initial sourced capital milestone: `GBP 1,554,000` (gross).
- Initial circulating market cap reference: `GBP 1,920,000`.

## 2) Allocation Balance Sheet (Genesis Base)

Percentages are based on the `1,000,000,000` genesis supply:

| Allocation Vault | % | Tokens | Entry Price | Asset Value (GBP) | Vesting / Deployment Rule |
|---|---:|---:|---:|---:|---|
| Private Sale | 3.00% | 30,000,000 | 0.0050 | 150,000 | cliff + linear vesting (see notes) |
| Public Sale / IDO | 13.00% | 130,000,000 | 0.0108 | 1,404,000 | 100% unlocked at Day 1 |
| Initial DEX LP Hub | 4.00% | 40,000,000 | 0.0120 | 480,000 | LP lock 24 months |
| CEX Liquidity Market | 15.00% | 150,000,000 | 0.0120 | 1,800,000 | market making allocation |
| Protocol Operations | 15.00% | 150,000,000 | 0.0120 | 1,800,000 | cliff + 36-month linear |
| Future Reserve Vault | 10.00% | 100,000,000 | 0.0120 | 1,200,000 | 24-month absolute lock |
| Marketing Engine | 15.00% | 150,000,000 | 0.0120 | 1,800,000 | 12-month linear |
| Strategic Partners | 10.00% | 100,000,000 | 0.0120 | 1,200,000 | partner growth allocation |
| Core Team | 10.00% | 100,000,000 | 0.0120 | 1,200,000 | cliff + 24-month linear |
| Grants & Bounties | 5.00% | 50,000,000 | 0.0120 | 600,000 | governance-managed |
| **INITIAL GENESIS TOTAL** | **100.00%** | **1,000,000,000** | — | **11,634,000** | minted at TGE |
| User Staking Pool Layer (mint extension) | 10.00% | 100,000,000 | 0.0120 | 1,200,000 | dynamically minted rewards |

## 3) Chronological Launch Roadmap

1. Private sale closes.
2. Pre-market build window (audits, integrations, launch readiness).
3. Public IDO launch.
4. Immediate DEX liquidity deployment.
5. Public staking activation + CEX market-making seeding.

## 4) Corporate Fee Deflation Override

- Weekly mechanism: 10% of gross corporate/service revenue allocated to buyback-and-burn.
- Intended policy outcome: offset staking inflation with recurring burn pressure.

## 5) Listing Strategy Summary

- DEX listing: permissionless, self-managed pool creation.
- CEX listing: formal application, compliance, MM integrations, exchange KPIs.

## 6) DEX vs CEX Dynamics (Planning Model)

- DEX (AMM) requires value-paired liquidity seeding around listing price.
- CEX (order book) allows asymmetric inventory between asks and bids via market maker strategy.
- MM KPI focus is order book depth near mid-price (not strict 50/50 capital symmetry).

## 7) Consistency Notes To Resolve Before Contract Finalization

The pasted planning text includes internal mismatches that must be resolved before encoding immutable on-chain rules:

- Private sale vesting appears as both `6-month cliff` and `9-month cliff`.
- Build window appears as both `2-3 months` and `2-5 months`.
- CEX liquidity appears as both `15% / 150,000,000` and `10% / 100,000,000`.

Status: keep as planning context; treat unresolved items as pending governance/product decision before contract-level implementation.
