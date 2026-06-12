const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FortunaVestingProtocol", function () {
  async function deployFixture() {
    const [owner, creator, creator2, beneficiary, beneficiary2, treasury, other] =
      await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const token = await TestToken.connect(owner).deploy();
    await token.waitForDeployment();

    await token.connect(owner).transfer(creator.address, ethers.parseEther("400"));
    await token.connect(owner).transfer(creator2.address, ethers.parseEther("300"));

    const flatFeeNative = ethers.parseEther("0.01");
    const tokenFeeBps = 100n;

    const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");
    const protocol = await Protocol.connect(owner).deploy(
      treasury.address,
      flatFeeNative,
      tokenFeeBps
    );
    await protocol.waitForDeployment();

    return {
      owner,
      creator,
      creator2,
      beneficiary,
      beneficiary2,
      treasury,
      other,
      token,
      protocol,
      flatFeeNative,
      tokenFeeBps,
    };
  }

  async function createSchedule(ctx, overrides = {}) {
    const creator = overrides.creator ?? ctx.creator;
    const beneficiary = overrides.beneficiary ?? ctx.beneficiary;
    const token = overrides.token ?? ctx.token;
    const amount = overrides.amount ?? ethers.parseEther("100");
    const startTime = overrides.startTime ?? 0;
    const cliffDuration = overrides.cliffDuration ?? 30 * 24 * 60 * 60;
    const vestingDuration = overrides.vestingDuration ?? 180 * 24 * 60 * 60;
    const releaseInterval = overrides.releaseInterval ?? 30 * 24 * 60 * 60;
    const tgePercent = overrides.tgePercent ?? 1000;
    const revocable = overrides.revocable ?? true;
    const title = overrides.title ?? "Team Allocation";
    const category = overrides.category ?? "TEAM";
    const value = overrides.value ?? ctx.flatFeeNative;

    await token.connect(creator).approve(await ctx.protocol.getAddress(), amount);

    await ctx.protocol.connect(creator).createSchedule(
      await token.getAddress(),
      beneficiary.address ?? beneficiary,
      amount,
      startTime,
      cliffDuration,
      vestingDuration,
      releaseInterval,
      tgePercent,
      revocable,
      title,
      category,
      { value }
    );

    const ids = await ctx.protocol.getSchedulesByBeneficiary(beneficiary.address ?? beneficiary);
    return ids[ids.length - 1];
  }

  describe("constructor and admin", function () {
    it("deploys with expected constructor values", async function () {
      const { owner, treasury, protocol, flatFeeNative, tokenFeeBps } =
        await loadFixture(deployFixture);

      expect(await protocol.owner()).to.equal(owner.address);
      expect(await protocol.treasuryWallet()).to.equal(treasury.address);
      expect(await protocol.flatFeeNative()).to.equal(flatFeeNative);
      expect(await protocol.tokenFeeBps()).to.equal(tokenFeeBps);
      expect(await protocol.totalSchedules()).to.equal(0);
    });

    it("rejects invalid constructor values", async function () {
      const { owner } = await loadFixture(deployFixture);
      const Protocol = await ethers.getContractFactory("FortunaVestingProtocol");

      await expect(
        Protocol.connect(owner).deploy(ethers.ZeroAddress, 1, 0)
      ).to.be.revertedWith("Fortuna: zero treasury");

      await expect(
        Protocol.connect(owner).deploy(owner.address, 1, 1001)
      ).to.be.revertedWith("Fortuna: fee too high");
    });

    it("enforces owner-only admin controls and validation", async function () {
      const { owner, other, creator, treasury, protocol } = await loadFixture(deployFixture);

      await expect(protocol.connect(other).setFlatFee(1))
        .to.be.revertedWithCustomError(protocol, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await expect(protocol.connect(other).setTokenFeeBps(1))
        .to.be.revertedWithCustomError(protocol, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await expect(protocol.connect(other).setTreasuryWallet(other.address))
        .to.be.revertedWithCustomError(protocol, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await expect(protocol.connect(other).addFeeExempt(creator.address))
        .to.be.revertedWithCustomError(protocol, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await expect(protocol.connect(other).removeFeeExempt(creator.address))
        .to.be.revertedWithCustomError(protocol, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await expect(protocol.connect(other).pause())
        .to.be.revertedWithCustomError(protocol, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await expect(protocol.connect(other).unpause())
        .to.be.revertedWithCustomError(protocol, "OwnableUnauthorizedAccount")
        .withArgs(other.address);

      await expect(protocol.connect(owner).setTokenFeeBps(1001)).to.be.revertedWith(
        "Fortuna: fee too high"
      );
      await expect(protocol.connect(owner).setTreasuryWallet(ethers.ZeroAddress)).to.be.revertedWith(
        "Fortuna: zero treasury"
      );

      await expect(protocol.connect(owner).setFlatFee(123))
        .to.emit(protocol, "FeeUpdated")
        .withArgs(123, await protocol.tokenFeeBps());
      await expect(protocol.connect(owner).setTokenFeeBps(25))
        .to.emit(protocol, "FeeUpdated")
        .withArgs(123, 25);
      await expect(protocol.connect(owner).setTreasuryWallet(other.address))
        .to.emit(protocol, "TreasuryUpdated")
        .withArgs(other.address);
      await expect(protocol.connect(owner).addFeeExempt(creator.address))
        .to.emit(protocol, "FeeExemptionUpdated")
        .withArgs(creator.address, true);
      await expect(protocol.connect(owner).removeFeeExempt(creator.address))
        .to.emit(protocol, "FeeExemptionUpdated")
        .withArgs(creator.address, false);

      expect(await protocol.treasuryWallet()).to.equal(other.address);
      expect(await protocol.feeExempt(creator.address)).to.equal(false);
      expect(await protocol.flatFeeNative()).to.equal(123);
      expect(await protocol.tokenFeeBps()).to.equal(25);
      expect(await protocol.owner()).to.equal(owner.address);
      expect(treasury.address).to.not.equal(other.address);
    });

    it("rejects direct native transfers", async function () {
      const { owner, protocol } = await loadFixture(deployFixture);

      await expect(
        owner.sendTransaction({ to: await protocol.getAddress(), value: 1n })
      ).to.be.revertedWith("Fortuna: use createSchedule");
    });
  });

  describe("schedule creation", function () {
    it("validates createSchedule inputs", async function () {
      const { creator, beneficiary, token, protocol, flatFeeNative } = await loadFixture(deployFixture);
      const tokenAddress = await token.getAddress();

      await expect(
        protocol.connect(creator).createSchedule(
          ethers.ZeroAddress,
          beneficiary.address,
          ethers.parseEther("1"),
          0,
          1,
          1,
          0,
          0,
          true,
          "A",
          "B",
          { value: flatFeeNative }
        )
      ).to.be.revertedWith("Fortuna: zero token");

      await expect(
        protocol.connect(creator).createSchedule(
          tokenAddress,
          ethers.ZeroAddress,
          ethers.parseEther("1"),
          0,
          1,
          1,
          0,
          0,
          true,
          "A",
          "B",
          { value: flatFeeNative }
        )
      ).to.be.revertedWith("Fortuna: zero beneficiary");

      await expect(
        protocol.connect(creator).createSchedule(
          tokenAddress,
          beneficiary.address,
          0,
          0,
          1,
          1,
          0,
          0,
          true,
          "A",
          "B",
          { value: flatFeeNative }
        )
      ).to.be.revertedWith("Fortuna: zero amount");

      await expect(
        protocol.connect(creator).createSchedule(
          tokenAddress,
          beneficiary.address,
          ethers.parseEther("1"),
          0,
          1,
          1,
          0,
          10001,
          true,
          "A",
          "B",
          { value: flatFeeNative }
        )
      ).to.be.revertedWith("Fortuna: invalid tgePercent");

      await expect(
        protocol.connect(creator).createSchedule(
          tokenAddress,
          beneficiary.address,
          ethers.parseEther("1"),
          0,
          0,
          0,
          0,
          0,
          true,
          "A",
          "B",
          { value: flatFeeNative }
        )
      ).to.be.revertedWith("Fortuna: no cliff or vesting");

      await expect(
        protocol.connect(creator).createSchedule(
          tokenAddress,
          beneficiary.address,
          ethers.parseEther("1"),
          0,
          10,
          10,
          11,
          0,
          true,
          "A",
          "B",
          { value: flatFeeNative }
        )
      ).to.be.revertedWith("Fortuna: interval > duration");

      await expect(
        protocol.connect(creator).createSchedule(
          tokenAddress,
          beneficiary.address,
          ethers.parseEther("1"),
          (await time.latest()) - 1,
          10,
          10,
          0,
          0,
          true,
          "A",
          "B",
          { value: flatFeeNative }
        )
      ).to.be.revertedWith("Fortuna: start in past");

      await expect(
        protocol.connect(creator).createSchedule(
          tokenAddress,
          beneficiary.address,
          ethers.parseEther("1"),
          0,
          1,
          1,
          0,
          0,
          true,
          "A",
          "B",
          { value: 0 }
        )
      ).to.be.revertedWith("Fortuna: insufficient native fee");
    });

    it("creates schedules with fees, metadata, and indexed creator/beneficiary views", async function () {
      const ctx = await loadFixture(deployFixture);
      const { creator, creator2, beneficiary, beneficiary2, treasury, token, protocol, tokenFeeBps, flatFeeNative } =
        ctx;

      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("60");
      const tokenFee1 = (amount1 * tokenFeeBps) / 10000n;
      const tokenFee2 = (amount2 * tokenFeeBps) / 10000n;
      const start = (await time.latest()) + 120;

      const treasuryNativeBefore = await ethers.provider.getBalance(treasury.address);
      const treasuryTokenBefore = await token.balanceOf(treasury.address);

      const id1 = await createSchedule(ctx, {
        creator,
        beneficiary,
        amount: amount1,
        startTime: start,
        cliffDuration: 100,
        vestingDuration: 500,
        releaseInterval: 50,
        tgePercent: 1000,
        revocable: true,
        title: "Team",
        category: "TEAM",
        value: flatFeeNative + ethers.parseEther("0.02"),
      });

      const id2 = await createSchedule(ctx, {
        creator: creator2,
        beneficiary: beneficiary2,
        amount: amount2,
        startTime: start,
        cliffDuration: 50,
        vestingDuration: 300,
        releaseInterval: 0,
        tgePercent: 0,
        revocable: false,
        title: "Advisor",
        category: "ADVISOR",
      });

      expect(id1).to.equal(1n);
      expect(id2).to.equal(2n);
      expect(await protocol.totalSchedules()).to.equal(2);
      expect(await protocol.totalFeesCollectedNative()).to.equal(flatFeeNative * 2n);
      expect(await protocol.totalFeesCollectedTokens(await token.getAddress())).to.equal(
        tokenFee1 + tokenFee2
      );

      const schedule1 = await protocol.getSchedule(id1);
      expect(schedule1.scheduleId).to.equal(id1);
      expect(schedule1.creator).to.equal(creator.address);
      expect(schedule1.beneficiary).to.equal(beneficiary.address);
      expect(schedule1.totalAllocation).to.equal(amount1 - tokenFee1);
      expect(schedule1.title).to.equal("Team");
      expect(schedule1.category).to.equal("TEAM");

      const creatorIds = await protocol.getSchedulesByCreator(creator.address);
      const beneficiaryIds = await protocol.getSchedulesByBeneficiary(beneficiary.address);
      expect(creatorIds.map((x) => x.toString())).to.deep.equal(["1"]);
      expect(beneficiaryIds.map((x) => x.toString())).to.deep.equal(["1"]);

      expect(await ethers.provider.getBalance(treasury.address)).to.equal(
        treasuryNativeBefore + flatFeeNative * 2n
      );
      expect(await token.balanceOf(treasury.address)).to.equal(treasuryTokenBefore + tokenFee1 + tokenFee2);
      expect(await ethers.provider.getBalance(await protocol.getAddress())).to.equal(0);
    });

    it("supports fee-exempt creators and refunds native value", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, creator, beneficiary, treasury, token, protocol, flatFeeNative } = ctx;
      const amount = ethers.parseEther("40");

      await protocol.connect(owner).addFeeExempt(creator.address);

      const treasuryNativeBefore = await ethers.provider.getBalance(treasury.address);
      const treasuryTokenBefore = await token.balanceOf(treasury.address);
      const totalFeesNativeBefore = await protocol.totalFeesCollectedNative();

      const scheduleId = await createSchedule(ctx, {
        amount,
        cliffDuration: 1,
        vestingDuration: 100,
        releaseInterval: 0,
        tgePercent: 0,
        value: flatFeeNative,
      });

      const schedule = await protocol.getSchedule(scheduleId);
      expect(schedule.totalAllocation).to.equal(amount);
      expect(await token.balanceOf(await protocol.getAddress())).to.equal(amount);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryNativeBefore);
      expect(await token.balanceOf(treasury.address)).to.equal(treasuryTokenBefore);
      expect(await protocol.totalFeesCollectedNative()).to.equal(totalFeesNativeBefore);
    });
  });

  describe("claiming and vesting math", function () {
    it("enforces beneficiary-only claim and supports time-based partial/full claims", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, creator, beneficiary, other, token, protocol } = ctx;
      const amount = ethers.parseEther("100");
      const tgeAmount = ethers.parseEther("10");

      await protocol.connect(owner).setFlatFee(0);
      await protocol.connect(owner).setTokenFeeBps(0);

      const start = (await time.latest()) + 100;
      const scheduleId = await createSchedule(ctx, {
        amount,
        startTime: start,
        cliffDuration: 100,
        vestingDuration: 400,
        releaseInterval: 50,
        tgePercent: 1000,
        revocable: true,
        value: 0,
      });

      expect(await protocol.claimableAmount(scheduleId)).to.equal(0);

      await time.increaseTo(start + 50);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(tgeAmount);
      expect(await protocol.lockedAmount(scheduleId)).to.equal(amount - tgeAmount);

      await expect(protocol.connect(other).claim(scheduleId)).to.be.revertedWith(
        "Fortuna: not beneficiary"
      );

      await protocol.connect(beneficiary).claim(scheduleId);
      expect(await token.balanceOf(beneficiary.address)).to.equal(tgeAmount);

      await time.increaseTo(start + 300);
      const expectedVested = ethers.parseEther("55");
      expect(await protocol.claimableAmount(scheduleId)).to.equal(expectedVested - tgeAmount);
      await protocol.connect(beneficiary).claim(scheduleId);
      expect(await token.balanceOf(beneficiary.address)).to.equal(expectedVested);

      await time.increaseTo(start + 650);
      await protocol.connect(beneficiary).claim(scheduleId);
      expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
      expect(await protocol.claimedAmount(scheduleId)).to.equal(amount);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(0);
      expect(await protocol.totalTokensClaimed()).to.equal(amount);

      const creatorIds = await protocol.getSchedulesByCreator(creator.address);
      expect(creatorIds[0]).to.equal(scheduleId);
    });

    it("supports claimAll across multiple schedules", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, beneficiary, token, protocol } = ctx;

      await protocol.connect(owner).setFlatFee(0);
      await protocol.connect(owner).setTokenFeeBps(0);

      const start = (await time.latest()) + 10;
      const id1 = await createSchedule(ctx, {
        amount: ethers.parseEther("100"),
        startTime: start,
        cliffDuration: 0,
        vestingDuration: 1000,
        releaseInterval: 100,
        tgePercent: 0,
        value: 0,
      });
      const id2 = await createSchedule(ctx, {
        amount: ethers.parseEther("50"),
        startTime: start,
        cliffDuration: 0,
        vestingDuration: 1000,
        releaseInterval: 100,
        tgePercent: 0,
        value: 0,
      });

      await time.increaseTo(start + 500);
      const claimable1 = await protocol.claimableAmount(id1);
      const claimable2 = await protocol.claimableAmount(id2);

      await protocol.connect(beneficiary).claimAll();

      expect(await token.balanceOf(beneficiary.address)).to.equal(claimable1 + claimable2);
      expect(await protocol.claimedAmount(id1)).to.equal(claimable1);
      expect(await protocol.claimedAmount(id2)).to.equal(claimable2);
      expect(await protocol.totalTokensClaimed()).to.equal(claimable1 + claimable2);
    });

    it("snaps linear vesting to release intervals", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, protocol } = ctx;
      const amount = ethers.parseEther("100");

      await protocol.connect(owner).setFlatFee(0);
      await protocol.connect(owner).setTokenFeeBps(0);

      const start = (await time.latest()) + 10;
      const scheduleId = await createSchedule(ctx, {
        amount,
        startTime: start,
        cliffDuration: 0,
        vestingDuration: 1000,
        releaseInterval: 100,
        tgePercent: 0,
        value: 0,
      });

      await time.increaseTo(start + 149);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(ethers.parseEther("10"));

      await time.increaseTo(start + 199);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(ethers.parseEther("10"));

      await time.increaseTo(start + 200);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(ethers.parseEther("20"));

      await time.increaseTo(start + 999);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(ethers.parseEther("90"));

      await time.increaseTo(start + 1001);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(amount);
    });
  });

  describe("revocation", function () {
    it("allows creator revocation while preserving vested beneficiary claims", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, creator, beneficiary, token, protocol } = ctx;
      const amount = ethers.parseEther("100");

      await protocol.connect(owner).setFlatFee(0);
      await protocol.connect(owner).setTokenFeeBps(0);

      const start = (await time.latest()) + 10;
      const scheduleId = await createSchedule(ctx, {
        amount,
        startTime: start,
        cliffDuration: 0,
        vestingDuration: 1000,
        releaseInterval: 100,
        tgePercent: 0,
        revocable: true,
        value: 0,
      });

      await time.increaseTo(start + 400);
      const creatorBefore = await token.balanceOf(creator.address);

      await expect(protocol.connect(creator).revokeSchedule(scheduleId))
        .to.emit(protocol, "ScheduleRevoked")
        .withArgs(scheduleId, creator.address, ethers.parseEther("40"), ethers.parseEther("60"));

      const schedule = await protocol.getSchedule(scheduleId);
      expect(schedule.revoked).to.equal(true);
      expect(schedule.vestedAtRevocation).to.equal(ethers.parseEther("40"));
      expect(await token.balanceOf(creator.address)).to.equal(creatorBefore + ethers.parseEther("60"));
      expect(await protocol.lockedAmount(scheduleId)).to.equal(0);

      await time.increaseTo(start + 900);
      expect(await protocol.claimableAmount(scheduleId)).to.equal(ethers.parseEther("40"));
      await protocol.connect(beneficiary).claim(scheduleId);
      expect(await token.balanceOf(beneficiary.address)).to.equal(ethers.parseEther("40"));
      await expect(protocol.connect(beneficiary).claim(scheduleId)).to.be.revertedWith(
        "Fortuna: nothing to claim"
      );
    });

    it("enforces revoke permission and state constraints", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, creator, beneficiary, other, protocol } = ctx;

      await protocol.connect(owner).setFlatFee(0);
      await protocol.connect(owner).setTokenFeeBps(0);

      const nonRevocableId = await createSchedule(ctx, {
        amount: ethers.parseEther("20"),
        cliffDuration: 1,
        vestingDuration: 100,
        releaseInterval: 0,
        revocable: false,
        value: 0,
      });
      await expect(protocol.connect(creator).revokeSchedule(nonRevocableId)).to.be.revertedWith(
        "Fortuna: not revocable"
      );

      const revocableId = await createSchedule(ctx, {
        amount: ethers.parseEther("20"),
        beneficiary,
        cliffDuration: 1,
        vestingDuration: 100,
        releaseInterval: 0,
        revocable: true,
        value: 0,
      });
      await expect(protocol.connect(other).revokeSchedule(revocableId)).to.be.revertedWith(
        "Fortuna: not creator"
      );

      await protocol.connect(creator).revokeSchedule(revocableId);
      await expect(protocol.connect(creator).revokeSchedule(revocableId)).to.be.revertedWith(
        "Fortuna: already revoked"
      );
    });
  });

  describe("pause behavior", function () {
    it("blocks createSchedule and claims while paused", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, creator, beneficiary, token, protocol, flatFeeNative } = ctx;
      const amount = ethers.parseEther("30");

      await token.connect(creator).approve(await protocol.getAddress(), amount);
      await protocol.connect(owner).pause();

      await expect(
        protocol.connect(creator).createSchedule(
          await token.getAddress(),
          beneficiary.address,
          amount,
          0,
          1,
          100,
          0,
          0,
          true,
          "Paused",
          "TEST",
          { value: flatFeeNative }
        )
      ).to.be.revertedWithCustomError(protocol, "EnforcedPause");

      await protocol.connect(owner).unpause();
      const scheduleId = await createSchedule(ctx, {
        amount,
        cliffDuration: 1,
        vestingDuration: 100,
        releaseInterval: 0,
      });

      await protocol.connect(owner).pause();
      await expect(protocol.connect(beneficiary).claim(scheduleId)).to.be.revertedWithCustomError(
        protocol,
        "EnforcedPause"
      );
      await expect(protocol.connect(beneficiary).claimAll()).to.be.revertedWithCustomError(
        protocol,
        "EnforcedPause"
      );
    });
  });
});
