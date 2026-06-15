const { ethers, network } = require("hardhat");

function sameAddress(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label, retries = 5, delayMs = 2000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        await sleep(delayMs);
      }
    }
  }
  throw new Error(`${label} failed after ${retries} attempts: ${lastError?.message || lastError}`);
}

function isRetryableSendError(error) {
  const message = `${error?.message || error || ""}`.toLowerCase();
  return (
    message.includes("in-flight transaction limit") ||
    message.includes("already known") ||
    message.includes("nonce too low")
  );
}

async function sendWithRetry(sendFn, label, retries = 6, delayMs = 4000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await sendFn();
    } catch (error) {
      lastError = error;
      if (!isRetryableSendError(error) || i === retries - 1) {
        throw error;
      }
      console.log(`[token] ${label}: retrying after provider submission error...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function findEventArgs(contractInterface, receipt, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed.args;
      }
    } catch {
      // Ignore logs from other contracts.
    }
  }
  return null;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer configured for this network.");
  }

  const Token = await ethers.getContractFactory("FortunaToken");
  const configuredAddress = (process.env.SMOKE_TOKEN_ADDRESS || "").trim();
  const shouldAttach = configuredAddress.length > 0;

  let token;
  if (shouldAttach) {
    token = Token.attach(configuredAddress);
    console.log(`[token] attached: ${configuredAddress}`);
  } else {
    const recipient = process.env.SMOKE_TOKEN_RECIPIENT || deployer.address;
    const initialOwner = process.env.SMOKE_TOKEN_INITIAL_OWNER || deployer.address;
    token = await sendWithRetry(
      async () => Token.connect(deployer).deploy(recipient, initialOwner),
      "deploy"
    );
    await token.waitForDeployment();
    console.log(`[token] deployed: ${await token.getAddress()}`);
    console.log(`[token] constructor args: recipient=${recipient}, initialOwner=${initialOwner}`);
  }

  const tokenAddress = await token.getAddress();
  const [name, symbol, owner, minter, totalSupply, initialSupply, maxMintExtension, mintedExtension] =
    await withRetry(async () =>
      Promise.all([
        token.name(),
        token.symbol(),
        token.owner(),
        token.minter(),
        token.totalSupply(),
        token.INITIAL_SUPPLY(),
        token.MAX_MINT_EXTENSION(),
        token.mintedExtension(),
      ]),
    "token reads");
  const [maxSupply, remainingMintAllowance] = await withRetry(
    async () => Promise.all([token.maxSupply(), token.remainingMintAllowance()]),
    "token supply helper reads"
  );

  if (maxSupply !== initialSupply + maxMintExtension) {
    throw new Error("maxSupply() does not match INITIAL_SUPPLY + MAX_MINT_EXTENSION.");
  }
  if (remainingMintAllowance !== maxMintExtension - mintedExtension) {
    throw new Error("remainingMintAllowance() does not match MAX_MINT_EXTENSION - mintedExtension.");
  }

  console.log(`[token] network=${network.name} contract=${tokenAddress}`);
  console.log(`[token] name=${name} symbol=${symbol}`);
  console.log(`[token] owner=${owner} minter=${minter}`);
  console.log(
    `[token] supply total=${totalSupply} initial=${initialSupply} mintedExtension=${mintedExtension}`
  );

  if (sameAddress(minter, deployer.address)) {
    const mintAmount = 1n;
    const tx = await sendWithRetry(
      async () => token.connect(deployer).mint(deployer.address, mintAmount, { gasLimit: 300000 }),
      "mint"
    );
    const receipt = await tx.wait();
    const mintedArgs = findEventArgs(token.interface, receipt, "TokensMinted");
    if (!mintedArgs || !sameAddress(mintedArgs.to, deployer.address)) {
      throw new Error("mint() did not emit TokensMinted for deployer.");
    }
    if (mintedArgs.amount !== mintAmount) {
      throw new Error("mint() emitted unexpected amount.");
    }
    console.log(`[token] mint smoke passed: minted ${mintAmount.toString()} wei`);
  } else {
    console.log("[token] mint smoke skipped: deployer is not current minter");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
