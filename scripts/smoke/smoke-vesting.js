const { ethers, network } = require("hardhat");

function sameAddress(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label, retries = 6, delayMs = 2000) {
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
      console.log(`[vesting] ${label}: retrying after provider submission error...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function deployOrAttachToken(deployer) {
  const configuredAddress = (process.env.SMOKE_TOKEN_ADDRESS || "").trim();
  const Token = await ethers.getContractFactory("FortunaToken");
  if (configuredAddress.length > 0) {
    const token = Token.attach(configuredAddress).connect(deployer);
    console.log(`[vesting] attached FortunaToken: ${configuredAddress}`);
    return token;
  }

  const recipient = process.env.SMOKE_TOKEN_RECIPIENT || deployer.address;
  const initialOwner = process.env.SMOKE_TOKEN_INITIAL_OWNER || deployer.address;
  const token = await sendWithRetry(
    async () => Token.connect(deployer).deploy(recipient, initialOwner),
    "token deploy"
  );
  await token.waitForDeployment();
  console.log(`[vesting] deployed FortunaToken: ${await token.getAddress()}`);
  return token;
}

async function deployOrAttachVesting(deployer, configuredAddress) {
  if (configuredAddress.length > 0) {
    const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
    const protocol = Protocol.attach(configuredAddress).connect(deployer);
    console.log(`[vesting] attached protocol: ${configuredAddress}`);
    return { protocol, deployed: false };
  }

  const treasury = process.env.SMOKE_TREASURY_WALLET || deployer.address;
  const flatFeeNative = ethers.parseEther(process.env.SMOKE_FLAT_FEE_NATIVE || "0");
  const tokenFeeBps = BigInt(process.env.SMOKE_TOKEN_FEE_BPS || "25");

  const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
  const protocol = await sendWithRetry(
    async () => Protocol.connect(deployer).deploy(treasury, flatFeeNative, tokenFeeBps),
    "vesting deploy"
  );
  await protocol.waitForDeployment();

  console.log(`[vesting] deployed protocol: ${await protocol.getAddress()}`);
  console.log(
    `[vesting] constructor args: treasury=${treasury} flatFeeNative=${flatFeeNative} tokenFeeBps=${tokenFeeBps}`
  );
  return { protocol, deployed: true };
}

function findScheduleIdFromReceipt(protocol, receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = protocol.interface.parseLog(log);
      if (parsed && parsed.name === "ScheduleCreated") {
        return parsed.args.scheduleId;
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

  const beneficiary = process.env.SMOKE_BENEFICIARY || deployer.address;
  const configuredVestingAddress = (process.env.SMOKE_VESTING_ADDRESS || "").trim();
  const flatFeeFortuna = ethers.parseEther(process.env.SMOKE_FLAT_FEE_FORTUNA || "0");
  const fortunaFeeDiscountBps = Number(process.env.SMOKE_FORTUNA_FEE_DISCOUNT_BPS || "0");
  if (!Number.isInteger(fortunaFeeDiscountBps) || fortunaFeeDiscountBps < 0 || fortunaFeeDiscountBps > 10000) {
    throw new Error(
      `Invalid SMOKE_FORTUNA_FEE_DISCOUNT_BPS: ${process.env.SMOKE_FORTUNA_FEE_DISCOUNT_BPS}. Expected integer 0..10000`
    );
  }
  const amount = ethers.parseEther(process.env.SMOKE_VESTING_AMOUNT || "1");
  const cliffDuration = Number(process.env.SMOKE_CLIFF_SECONDS || "3600");
  const vestingDuration = Number(process.env.SMOKE_VESTING_SECONDS || "86400");
  const releaseInterval = Number(process.env.SMOKE_RELEASE_INTERVAL_SECONDS || "3600");
  const tgePercent = Number(process.env.SMOKE_TGE_BPS || "1000");
  const revocable = (process.env.SMOKE_REVOCABLE || "true").toLowerCase() !== "false";
  const title = process.env.SMOKE_TITLE || "Base Sepolia Smoke";
  const category = process.env.SMOKE_CATEGORY || "SMOKE";

  const token = await deployOrAttachToken(deployer);
  const { protocol, deployed: vestingDeployed } = await deployOrAttachVesting(
    deployer,
    configuredVestingAddress
  );
  const tokenAddress = await token.getAddress();
  const protocolAddress = await protocol.getAddress();
  const payFeeInFortuna = (process.env.SMOKE_PAY_FEE_IN_FORTUNA || "false").toLowerCase() === "true";

  if (vestingDeployed) {
    const cfgTx = await sendWithRetry(
      async () =>
        protocol
          .connect(deployer)
          .setFortunaFeeConfig(tokenAddress, flatFeeFortuna, fortunaFeeDiscountBps, { gasLimit: 300000 }),
      "vesting setFortunaFeeConfig"
    );
    await cfgTx.wait();
    const configuredFeeToken = await withRetry(
      async () => protocol.fortunaFeeToken(),
      "vesting fortunaFeeToken read"
    );
    if (!sameAddress(configuredFeeToken, tokenAddress)) {
      throw new Error("Configured fortunaFeeToken does not match deployed/attached token.");
    }
    console.log(`[vesting] configured fortunaFeeToken=${configuredFeeToken}`);
  }

  const [owner, treasury, flatFeeNative, tokenFeeBps] = await withRetry(async () =>
    Promise.all([
      protocol.owner(),
      protocol.treasuryWallet(),
      protocol.flatFeeNative(),
      protocol.tokenFeeBps(),
    ]),
  "vesting reads");
  console.log(
    `[vesting] network=${network.name} owner=${owner} treasury=${treasury} flatFee=${flatFeeNative} tokenFeeBps=${tokenFeeBps}`
  );

  const balance = await token.balanceOf(deployer.address);
  if (balance < amount) {
    throw new Error(
      `Insufficient token balance for smoke createSchedule. Have=${balance} need=${amount}`
    );
  }

  let approveAmount = amount;
  let nativeValue = flatFeeNative;
  if (payFeeInFortuna) {
    const fortunaFee = await withRetry(
      async () => protocol.discountedFortunaFee(),
      "vesting discountedFortunaFee"
    );
    approveAmount += fortunaFee;
    nativeValue = 0n;
    console.log(`[vesting] pay-fee mode=fortuna discountedFee=${fortunaFee}`);
  }

  const approveTx = await sendWithRetry(
    async () => token.connect(deployer).approve(protocolAddress, approveAmount, { gasLimit: 150000 }),
    "vesting approve"
  );
  await approveTx.wait();

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
  const createTx = payFeeInFortuna
    ? await sendWithRetry(
        async () =>
          protocol
            .connect(deployer)
            .createScheduleWithFortunaFee(...args, { value: nativeValue, gasLimit: 1200000 }),
        "vesting createScheduleWithFortunaFee"
      )
    : await sendWithRetry(
        async () =>
          protocol.connect(deployer).createSchedule(...args, { value: nativeValue, gasLimit: 1200000 }),
        "vesting createSchedule"
      );
  const createReceipt = await createTx.wait();

  let scheduleId = findScheduleIdFromReceipt(protocol, createReceipt);
  if (!scheduleId) {
    const creatorSchedules = await withRetry(
      async () => protocol.getSchedulesByCreator(deployer.address),
      "vesting getSchedulesByCreator"
    );
    scheduleId = creatorSchedules[creatorSchedules.length - 1];
  }
  if (!scheduleId) {
    throw new Error("Could not determine created scheduleId.");
  }

  const claimable = await withRetry(
    async () => protocol.claimableAmount(scheduleId),
    "vesting claimableAmount"
  );
  console.log(`[vesting] created scheduleId=${scheduleId.toString()} claimableNow=${claimable}`);

  if (claimable === 0n) {
    console.log("[vesting] claimableAmount is zero immediately after createSchedule; skipping claim.");
  } else if (sameAddress(beneficiary, deployer.address)) {
    const balanceBefore = await token.balanceOf(deployer.address);
    const claimTx = await sendWithRetry(
      async () => protocol.connect(deployer).claim(scheduleId, { gasLimit: 300000 }),
      "vesting claim"
    );
    await claimTx.wait();
    const [claimedAmount, balanceAfter] = await withRetry(async () =>
      Promise.all([protocol.claimedAmount(scheduleId), token.balanceOf(deployer.address)]),
    "vesting post-claim reads");
    if (claimedAmount === 0n) {
      throw new Error("claim() executed but claimedAmount is still zero.");
    }
    if (balanceAfter <= balanceBefore) {
      throw new Error("claim() executed but beneficiary token balance did not increase.");
    }
    console.log(`[vesting] claim smoke passed: claimed=${claimedAmount}`);
  } else {
    console.log("[vesting] claim smoke skipped: beneficiary signer not available in this session");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
