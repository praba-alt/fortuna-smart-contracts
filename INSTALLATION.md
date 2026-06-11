# Fortuna Vesting Protocol — Installation

## Prerequisites
- Node.js ≥ 18
- npm or yarn

---

## Option 1 — Remix IDE (recommended for quick start)

1. Open [remix.ethereum.org](https://remix.ethereum.org)
2. Import this repo via **File Explorer → Clone Git Repo**
3. In the **Solidity Compiler** tab:
   - Compiler: `0.8.24`
   - Enable **Optimization** → 200 runs
   - Enable **viaIR** (Advanced Settings)
4. Compile `FortunaVestingProtocol.sol`

> `viaIR` is **required** — the contract uses OpenZeppelin's `SafeERC20` which triggers a stack-too-deep error under the legacy pipeline.

---

## Option 2 — Hardhat

```bash
npm init -y
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts@5.6.0
npx hardhat init
```

**`hardhat.config.js`**
```js
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
    },
  },
};
```

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network <network>
```

**`scripts/deploy.js`**
```js
const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
  const protocol = await Protocol.deploy(
    deployer.address,       // treasury
    ethers.parseEther("0.01"), // flat fee
    25                      // 0.25% token fee bps
  );
  await protocol.waitForDeployment();
  console.log("Deployed to:", await protocol.getAddress());
}
main().catch((e) => { console.error(e); process.exit(1); });
```

---

## Option 3 — Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge init
forge install OpenZeppelin/openzeppelin-contracts@v5.6.0
echo "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/" >> remappings.txt
```

**`foundry.toml`**
```toml
[profile.default]
src            = "src"
out            = "out"
libs           = ["lib"]
via_ir         = true
optimizer      = true
optimizer_runs = 200
solc           = "0.8.24"
```

```bash
forge build
forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

**`script/Deploy.s.sol`**
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Script.sol";
import "../src/FortunaVestingProtocol.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        new FortunaVestingProtocol(msg.sender, 0.01 ether, 25);
        vm.stopBroadcast();
    }
}
```

---

## Environment Variables

```env
PRIVATE_KEY=0xyour_private_key
RPC_URL=https://mainnet.infura.io/v3/your_key
ETHERSCAN_API_KEY=your_key
```

---

## Constructor Parameters

| Parameter | Type | Description |
|---|---|---|
| `_treasury` | `address` | Wallet that receives all collected fees |
| `_flatFeeNative` | `uint256` | Flat ETH fee per schedule creation (wei) |
| `_tokenFeeBps` | `uint256` | Token fee in basis points (max 1000 = 10%) |