const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const treasury = process.env.TREASURY_WALLET || deployer.address;
  const flatFeeNative = ethers.parseEther(process.env.FLAT_FEE_NATIVE || "0.01");
  const tokenFeeBps = BigInt(process.env.TOKEN_FEE_BPS || "25");
  const fortunaFeeToken = (process.env.FORTUNA_FEE_TOKEN || "").trim();
  const flatFeeFortuna = ethers.parseEther(process.env.FLAT_FEE_FORTUNA || "0");
  const fortunaFeeDiscountBps = Number(process.env.FORTUNA_FEE_DISCOUNT_BPS || "0");
  if (!Number.isInteger(fortunaFeeDiscountBps) || fortunaFeeDiscountBps < 0 || fortunaFeeDiscountBps > 10000) {
    throw new Error(
      `Invalid FORTUNA_FEE_DISCOUNT_BPS: ${process.env.FORTUNA_FEE_DISCOUNT_BPS}. Expected integer 0..10000`
    );
  }

  const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
  const protocol = await Protocol.deploy(treasury, flatFeeNative, tokenFeeBps);
  await protocol.waitForDeployment();

  if (fortunaFeeToken || flatFeeFortuna > 0n || fortunaFeeDiscountBps > 0) {
    const feeTokenAddress = fortunaFeeToken || ethers.ZeroAddress;
    const tx = await protocol.setFortunaFeeConfig(
      feeTokenAddress,
      flatFeeFortuna,
      fortunaFeeDiscountBps
    );
    await tx.wait();
  }

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("FortunaVestingProtocol:", await protocol.getAddress());
  console.log("Constructor args:", {
    treasury,
    flatFeeNative: flatFeeNative.toString(),
    tokenFeeBps: tokenFeeBps.toString(),
  });
  console.log("Fortuna fee config:", {
    fortunaFeeToken: await protocol.fortunaFeeToken(),
    flatFeeFortuna: (await protocol.flatFeeFortuna()).toString(),
    fortunaFeeDiscountBps: (await protocol.fortunaFeeDiscountBps()).toString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
