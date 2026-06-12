const { task } = require("hardhat/config");
const { isAddress } = require("ethers");

function requireAddressEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  if (!isAddress(value)) {
    throw new Error(`Invalid address in ${name}: ${value}`);
  }
  return value;
}

function requireStringEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

function requireBpsEnv(name) {
  const raw = requireStringEnv(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    throw new Error(`Invalid ${name}: ${raw}. Expected integer between 0 and 1000.`);
  }
  return value;
}

function validateContractAddress(address) {
  if (!isAddress(address)) {
    throw new Error(`Invalid deployed contract address: ${address}`);
  }
}

task("verify-token", "Verify FortunaToken using env constructor args")
  .addParam("address", "Deployed token contract address")
  .setAction(async ({ address }, hre) => {
    validateContractAddress(address);

    const recipient = requireAddressEnv("TOKEN_RECIPIENT");
    const initialOwner = requireAddressEnv("TOKEN_INITIAL_OWNER");

    await hre.run("verify:verify", {
      address,
      contract: "contracts/token/FortunaToken.sol:FortunaToken",
      constructorArguments: [recipient, initialOwner],
    });
  });

task("verify-vesting", "Verify FortunaVestingProtocol using env constructor args")
  .addParam("address", "Deployed vesting contract address")
  .setAction(async ({ address }, hre) => {
    validateContractAddress(address);

    const treasury = requireAddressEnv("TREASURY_WALLET");
    const flatFeeNativeEth = requireStringEnv("FLAT_FEE_NATIVE");
    const tokenFeeBps = requireBpsEnv("TOKEN_FEE_BPS");

    let flatFeeNativeWei;
    try {
      flatFeeNativeWei = hre.ethers.parseEther(flatFeeNativeEth).toString();
    } catch {
      throw new Error(`Invalid FLAT_FEE_NATIVE: ${flatFeeNativeEth}`);
    }

    await hre.run("verify:verify", {
      address,
      contract: "contracts/vesting/FortunaVestingProtocol.sol:FortunaVestingProtocol",
      constructorArguments: [treasury, flatFeeNativeWei, tokenFeeBps],
    });
  });
