const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { HDNodeWallet } = require("ethers");

const DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";
const DEFAULT_HD_PATH = "m/44'/60'/0'/0";
const ROLE_BY_INDEX = {
  0: "owner",
  1: "treasury",
  2: "creator",
  3: "beneficiary",
};

function parseCount() {
  const raw = process.env.LOCAL_WALLET_COUNT || "3";
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid wallet count: ${raw}`);
  }
  return value;
}

function parseAmountEth() {
  const raw = process.env.LOCAL_WALLET_AMOUNT_ETH || "10";
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ETH amount: ${raw}`);
  }
  return raw;
}

async function main() {
  if (network.name !== "localhost" && network.name !== "hardhat") {
    throw new Error(`Refusing to run on network '${network.name}'. Use localhost/hardhat only.`);
  }

  const mnemonic = (process.env.LOCAL_MNEMONIC || DEFAULT_MNEMONIC).trim();
  const hdPath = process.env.LOCAL_HD_PATH || DEFAULT_HD_PATH;
  const count = parseCount();
  const amountEth = parseAmountEth();
  const amountWei = ethers.parseEther(amountEth);

  const [funder] = await ethers.getSigners();
  const funderAddress = await funder.getAddress();

  const created = [];

  for (let i = 0; i < count; i++) {
    const derivationPath = `${hdPath}/${i}`;
    const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath).connect(
      ethers.provider
    );
    const balance = await ethers.provider.getBalance(wallet.address);

    if (balance < amountWei && wallet.address !== funderAddress) {
      const topup = amountWei - balance;
      const tx = await funder.sendTransaction({
        to: wallet.address,
        value: topup,
      });
      await tx.wait();
    }

    created.push({
      index: i + 1,
      role: ROLE_BY_INDEX[i] || `wallet_${i + 1}`,
      address: wallet.address,
      derivationPath,
      privateKey: wallet.privateKey,
      targetEth: amountEth,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    funder: funderAddress,
    mnemonicPathBase: hdPath,
    wallets: created,
  };

  const outDir = path.join(process.cwd(), ".local");
  const outFile = path.join(outDir, "wallets.json");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log(`Prepared ${created.length} deterministic wallet(s) from mnemonic.`);
  console.log(`Saved: ${outFile}`);
  for (const w of created) {
    console.log(`${w.index}. ${w.role}: ${w.address} | target ${w.targetEth} ETH`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
