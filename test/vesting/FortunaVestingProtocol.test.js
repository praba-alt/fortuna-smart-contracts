const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FortunaVestingProtocol", function () {
  async function deployFixture() {
    const [owner, creator, beneficiary, treasury] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const token = await TestToken.connect(owner).deploy();
    await token.waitForDeployment();

    await token.connect(owner).transfer(creator.address, ethers.parseEther("500"));

    const flatFeeNative = ethers.parseEther("0.01");
    const tokenFeeBps = 25n;

    const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
    const protocol = await Protocol.connect(owner).deploy(
      treasury.address,
      flatFeeNative,
      tokenFeeBps
    );
    await protocol.waitForDeployment();

    return { owner, creator, beneficiary, treasury, token, protocol, flatFeeNative, tokenFeeBps };
  }

  it("deploys with expected constructor values", async function () {
    const { owner, treasury, protocol, flatFeeNative, tokenFeeBps } = await loadFixture(deployFixture);

    expect(await protocol.owner()).to.equal(owner.address);
    expect(await protocol.treasuryWallet()).to.equal(treasury.address);
    expect(await protocol.flatFeeNative()).to.equal(flatFeeNative);
    expect(await protocol.tokenFeeBps()).to.equal(tokenFeeBps);
  });

  it("creates a schedule and collects token/native fees", async function () {
    const { creator, beneficiary, treasury, token, protocol, flatFeeNative, tokenFeeBps } =
      await loadFixture(deployFixture);

    const amount = ethers.parseEther("100");
    const tokenFee = (amount * tokenFeeBps) / 10000n;

    await token.connect(creator).approve(await protocol.getAddress(), amount);

    const nativeBefore = await ethers.provider.getBalance(treasury.address);
    const tokenBefore = await token.balanceOf(treasury.address);

    await protocol.connect(creator).createSchedule(
      await token.getAddress(),
      beneficiary.address,
      amount,
      0,
      30 * 24 * 60 * 60,
      180 * 24 * 60 * 60,
      30 * 24 * 60 * 60,
      1000,
      true,
      "Team Allocation",
      "TEAM",
      { value: flatFeeNative }
    );

    const ids = await protocol.getSchedulesByBeneficiary(beneficiary.address);
    expect(ids.length).to.equal(1);

    const schedule = await protocol.getSchedule(ids[0]);
    expect(schedule.totalAllocation).to.equal(amount - tokenFee);
    expect(await protocol.totalSchedules()).to.equal(1);

    expect(await token.balanceOf(treasury.address)).to.equal(tokenBefore + tokenFee);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(nativeBefore + flatFeeNative);
  });

  it("keeps vested balance claimable after revocation", async function () {
    const { owner, creator, beneficiary, token, protocol } = await loadFixture(deployFixture);

    await protocol.connect(owner).setFlatFee(0);
    await protocol.connect(owner).setTokenFeeBps(0);

    const amount = ethers.parseEther("100");
    await token.connect(creator).approve(await protocol.getAddress(), amount);

    await protocol.connect(creator).createSchedule(
      await token.getAddress(),
      beneficiary.address,
      amount,
      0,
      0,
      1000,
      0,
      0,
      true,
      "Advisor",
      "ADVISOR"
    );

    const ids = await protocol.getSchedulesByBeneficiary(beneficiary.address);
    const scheduleId = ids[0];

    await time.increase(400);
    await protocol.connect(creator).revokeSchedule(scheduleId);

    const revoked = await protocol.getSchedule(scheduleId);
    expect(revoked.revoked).to.equal(true);
    expect(revoked.vestedAtRevocation).to.be.gt(0);
    expect(revoked.vestedAtRevocation).to.be.lt(amount);

    await protocol.connect(beneficiary).claim(scheduleId);
    expect(await protocol.claimedAmount(scheduleId)).to.equal(revoked.vestedAtRevocation);
    expect(await token.balanceOf(await protocol.getAddress())).to.equal(0);
  });
});
