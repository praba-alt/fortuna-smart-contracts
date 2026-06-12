const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const treasury = process.env.TREASURY_WALLET || deployer.address;
  const flatFeeNative = ethers.parseEther(process.env.FLAT_FEE_NATIVE || "0.01");
  const tokenFeeBps = BigInt(process.env.TOKEN_FEE_BPS || "25");

  const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
  const protocol = await Protocol.deploy(treasury, flatFeeNative, tokenFeeBps);
  await protocol.waitForDeployment();

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("FortunaVestingProtocol:", await protocol.getAddress());
  console.log("Constructor args:", {
    treasury,
    flatFeeNative: flatFeeNative.toString(),
    tokenFeeBps: tokenFeeBps.toString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
