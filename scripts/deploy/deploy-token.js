const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const recipient = process.env.TOKEN_RECIPIENT || deployer.address;
  const initialOwner = process.env.TOKEN_INITIAL_OWNER || deployer.address;

  const Token = await ethers.getContractFactory("FortunaToken");
  const token = await Token.deploy(recipient, initialOwner);
  await token.waitForDeployment();

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("FortunaToken:", await token.getAddress());
  console.log("Constructor args:", { recipient, initialOwner });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
