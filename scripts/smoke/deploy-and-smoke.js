const { ethers, network } = require("hardhat");

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

function isInflightLimitError(error) {
  const message = `${error?.message || error || ""}`.toLowerCase();
  return (
    message.includes("in-flight transaction limit") ||
    message.includes("already known") ||
    message.includes("nonce too low")
  );
}

async function sendWithInflightRetry(sendFn, label, retries = 6, delayMs = 4000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await sendFn();
    } catch (error) {
      lastError = error;
      if (!isInflightLimitError(error) || i === retries - 1) {
        throw error;
      }
      console.log(`${label}: provider in-flight limit hit, retrying...`);
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

async function deployTokenAndSmoke(deployer) {
  const Token = await ethers.getContractFactory("FortunaToken");
  const recipient = process.env.SMOKE_TOKEN_RECIPIENT || deployer.address;
  const initialOwner = process.env.SMOKE_TOKEN_INITIAL_OWNER || deployer.address;

  const token = await sendWithInflightRetry(
    async () => Token.connect(deployer).deploy(recipient, initialOwner),
    "Token deploy"
  );
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  const [owner, minter, maxSupply, remainingMintAllowance] = await withRetry(async () =>
    Promise.all([token.owner(), token.minter(), token.maxSupply(), token.remainingMintAllowance()]),
  "Token post-deploy reads");

  const initialSupply = await token.INITIAL_SUPPLY();
  const maxMintExtension = await token.MAX_MINT_EXTENSION();
  if (maxSupply !== initialSupply + maxMintExtension) {
    throw new Error("Token maxSupply mismatch.");
  }

  let minted = false;
  if (minter.toLowerCase() === deployer.address.toLowerCase()) {
    const mintAmount = 1n;
    const tx = await sendWithInflightRetry(
      async () => token.connect(deployer).mint(deployer.address, mintAmount, { gasLimit: 300000 }),
      "Token mint"
    );
    const receipt = await tx.wait();
    const mintedArgs = findEventArgs(token.interface, receipt, "TokensMinted");
    if (!mintedArgs || mintedArgs.to.toLowerCase() !== deployer.address.toLowerCase()) {
      throw new Error("Token mint event smoke check failed.");
    }
    if (mintedArgs.amount !== mintAmount) {
      throw new Error("Token mint amount in event does not match expected value.");
    }
    minted = true;
  }

  return {
    token,
    tokenAddress,
    owner,
    minter,
    minted,
  };
}

async function deployVestingAndSmoke(deployer, token) {
  const treasury = process.env.SMOKE_TREASURY_WALLET || deployer.address;
  const flatFeeNative = ethers.parseEther(process.env.SMOKE_FLAT_FEE_NATIVE || "0");
  const tokenFeeBps = BigInt(process.env.SMOKE_TOKEN_FEE_BPS || "25");
  const payFeeInFortuna = (process.env.SMOKE_PAY_FEE_IN_FORTUNA || "false").toLowerCase() === "true";
  const flatFeeFortuna = ethers.parseEther(process.env.SMOKE_FLAT_FEE_FORTUNA || "0");
  const fortunaFeeDiscountBps = Number(process.env.SMOKE_FORTUNA_FEE_DISCOUNT_BPS || "0");
  if (!Number.isInteger(fortunaFeeDiscountBps) || fortunaFeeDiscountBps < 0 || fortunaFeeDiscountBps > 10000) {
    throw new Error(
      `Invalid SMOKE_FORTUNA_FEE_DISCOUNT_BPS: ${process.env.SMOKE_FORTUNA_FEE_DISCOUNT_BPS}`
    );
  }

  const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
  const protocol = await sendWithInflightRetry(
    async () => Protocol.connect(deployer).deploy(treasury, flatFeeNative, tokenFeeBps),
    "Vesting deploy"
  );
  await protocol.waitForDeployment();

  const beneficiary = process.env.SMOKE_BENEFICIARY || deployer.address;
  const amount = ethers.parseEther(process.env.SMOKE_VESTING_AMOUNT || "1");
  const cliffDuration = Number(process.env.SMOKE_CLIFF_SECONDS || "3600");
  const vestingDuration = Number(process.env.SMOKE_VESTING_SECONDS || "86400");
  const releaseInterval = Number(process.env.SMOKE_RELEASE_INTERVAL_SECONDS || "3600");
  const tgePercent = Number(process.env.SMOKE_TGE_BPS || "1000");
  const revocable = (process.env.SMOKE_REVOCABLE || "true").toLowerCase() !== "false";
  const title = process.env.SMOKE_TITLE || "Base Sepolia Deploy+Smoke";
  const category = process.env.SMOKE_CATEGORY || "SMOKE";

  const protocolAddress = await protocol.getAddress();
  const tokenAddress = await token.getAddress();

  await (
    await sendWithInflightRetry(
      async () =>
        protocol
          .connect(deployer)
          .setFortunaFeeConfig(tokenAddress, flatFeeFortuna, fortunaFeeDiscountBps, {
            gasLimit: 300000,
          }),
      "Vesting setFortunaFeeConfig"
    )
  ).wait();

  const fortunaFee = payFeeInFortuna ? await protocol.discountedFortunaFee() : 0n;
  const configuredFortunaFeeToken = await withRetry(
    async () => protocol.fortunaFeeToken(),
    "Vesting fortunaFeeToken read"
  );
  if (configuredFortunaFeeToken.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error("Vesting fortunaFeeToken does not match deployed token address.");
  }
  const approveAmount = amount + fortunaFee;

  await (
    await sendWithInflightRetry(
      async () => token.connect(deployer).approve(protocolAddress, approveAmount, { gasLimit: 120000 }),
      "Vesting approve"
    )
  ).wait();

  const createTx = await sendWithInflightRetry(
    async () => {
      const args = [
        tokenAddress,
        beneficiary,
        amount,
        0,
        cliffDuration,
        vestingDuration,
        releaseInterval,
        tgePercent,
        revocable,
        title,
        category,
      ];
      if (payFeeInFortuna) {
        return protocol.connect(deployer).createScheduleWithFortunaFee(...args, {
          value: 0,
          gasLimit: 1200000,
        });
      }
      return protocol.connect(deployer).createSchedule(...args, {
        value: flatFeeNative,
        gasLimit: 1200000,
      });
    },
    "Vesting createSchedule"
  );
  const createReceipt = await createTx.wait();

  let scheduleId = findEventArgs(protocol.interface, createReceipt, "ScheduleCreated")?.scheduleId;
  if (!scheduleId) {
    const scheduleIds = await withRetry(
      async () => protocol.getSchedulesByCreator(deployer.address),
      "Vesting getSchedulesByCreator",
      8,
      2500
    );
    scheduleId = scheduleIds[scheduleIds.length - 1];
  }
  if (!scheduleId) {
    throw new Error("Vesting schedule creation failed.");
  }

  const claimable = await withRetry(
    async () => protocol.claimableAmount(scheduleId),
    "Vesting claimableAmount"
  );

  let claimed = false;
  if (claimable === 0n) {
    console.log("[vesting] claimableAmount is zero immediately after createSchedule; skipping claim.");
  } else if (beneficiary.toLowerCase() === deployer.address.toLowerCase()) {
    await (
      await sendWithInflightRetry(
        async () => protocol.connect(deployer).claim(scheduleId, { gasLimit: 300000 }),
        "Vesting claim"
      )
    ).wait();
    const claimedAmount = await withRetry(
      async () => protocol.claimedAmount(scheduleId),
      "Vesting claimedAmount post-claim"
    );
    if (claimedAmount === 0n) {
      throw new Error("Vesting claim smoke check failed.");
    }
    claimed = true;
  }

  return {
    protocolAddress,
    tokenAddress,
    scheduleId: scheduleId.toString(),
    claimed,
    payFeeInFortuna,
    configuredFortunaFeeToken,
    fortunaFee,
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer configured for this network.");
  }

  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log("Running deploy + smoke for token...");
  const tokenResult = await deployTokenAndSmoke(deployer);
  console.log("Running deploy + smoke for vesting...");
  const vestingResult = await deployVestingAndSmoke(deployer, tokenResult.token);

  console.log("Deploy + smoke completed.");
  console.log(
    JSON.stringify(
      {
        network: network.name,
        deployer: deployer.address,
        token: {
          address: tokenResult.tokenAddress,
          owner: tokenResult.owner,
          minter: tokenResult.minter,
          mintSmokeExecuted: tokenResult.minted,
        },
        vesting: {
          address: vestingResult.protocolAddress,
          token: vestingResult.tokenAddress,
          scheduleId: vestingResult.scheduleId,
          claimSmokeExecuted: vestingResult.claimed,
          payFeeInFortuna: vestingResult.payFeeInFortuna,
          fortunaFeeToken: vestingResult.configuredFortunaFeeToken,
          fortunaFeeCharged: vestingResult.fortunaFee.toString(),
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
