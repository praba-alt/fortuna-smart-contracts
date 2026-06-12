const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FortunaToken", function () {
  async function deployFixture() {
    const [owner, recipient, stakingContract, spender, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("FortunaToken");
    const token = await Token.connect(owner).deploy(recipient.address, owner.address);
    await token.waitForDeployment();

    return { token, owner, recipient, stakingContract, spender, other };
  }

  it("sets initial supply and default minter", async function () {
    const { token, owner, recipient } = await loadFixture(deployFixture);

    const initialSupply = await token.INITIAL_SUPPLY();

    expect(await token.owner()).to.equal(owner.address);
    expect(await token.minter()).to.equal(owner.address);
    expect(await token.totalSupply()).to.equal(initialSupply);
    expect(await token.balanceOf(recipient.address)).to.equal(initialSupply);
  });

  it("allows only owner to set minter", async function () {
    const { token, owner, stakingContract, other } = await loadFixture(deployFixture);

    await expect(token.connect(other).setMinter(stakingContract.address))
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(other.address);

    await expect(token.connect(owner).setMinter(stakingContract.address))
      .to.emit(token, "MinterUpdated")
      .withArgs(owner.address, stakingContract.address);
  });

  it("uses two-step ownership transfer with pending owner acceptance", async function () {
    const { token, owner, other } = await loadFixture(deployFixture);

    await expect(token.connect(owner).transferOwnership(other.address))
      .to.emit(token, "OwnershipTransferStarted")
      .withArgs(owner.address, other.address);

    expect(await token.owner()).to.equal(owner.address);
    expect(await token.pendingOwner()).to.equal(other.address);

    await expect(token.connect(owner).setMinter(other.address)).to.not.be.reverted;
    await expect(token.connect(other).setMinter(owner.address))
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(other.address);

    await expect(token.connect(other).acceptOwnership())
      .to.emit(token, "OwnershipTransferred")
      .withArgs(owner.address, other.address);

    expect(await token.owner()).to.equal(other.address);
    expect(await token.pendingOwner()).to.equal(ethers.ZeroAddress);
  });

  it("rejects acceptOwnership by non-pending account", async function () {
    const { token, owner, stakingContract, other } = await loadFixture(deployFixture);

    await token.connect(owner).transferOwnership(stakingContract.address);
    await expect(token.connect(other).acceptOwnership())
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
  });

  it("allows owner to reassign minter role", async function () {
    const { token, owner, stakingContract } = await loadFixture(deployFixture);

    await expect(token.connect(owner).setMinter(stakingContract.address))
      .to.emit(token, "MinterUpdated")
      .withArgs(owner.address, stakingContract.address);

    expect(await token.minter()).to.equal(stakingContract.address);
  });

  it("rejects zero address minter assignment", async function () {
    const { token, owner } = await loadFixture(deployFixture);

    await expect(token.connect(owner).setMinter(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(token, "InvalidMinter")
      .withArgs(ethers.ZeroAddress);
  });

  it("restricts minting to current minter", async function () {
    const { token, owner, recipient, stakingContract, other } = await loadFixture(deployFixture);
    const mintAmount = ethers.parseEther("1");

    await expect(token.connect(other).mint(recipient.address, mintAmount))
      .to.be.revertedWithCustomError(token, "UnauthorizedMinter")
      .withArgs(other.address);

    await token.connect(owner).setMinter(stakingContract.address);

    await expect(token.connect(owner).mint(recipient.address, mintAmount))
      .to.be.revertedWithCustomError(token, "UnauthorizedMinter")
      .withArgs(owner.address);

    await expect(token.connect(stakingContract).mint(recipient.address, mintAmount)).to.not.be.reverted;
  });

  it("enforces max mint extension cap", async function () {
    const { token, owner, recipient } = await loadFixture(deployFixture);

    const maxMintExtension = await token.MAX_MINT_EXTENSION();
    await token.connect(owner).mint(recipient.address, maxMintExtension);

    expect(await token.mintedExtension()).to.equal(maxMintExtension);

    await expect(token.connect(owner).mint(recipient.address, 1n))
      .to.be.revertedWithCustomError(token, "MintCapExceeded")
      .withArgs(maxMintExtension + 1n, maxMintExtension);
  });

  it("is transferable and preserves total supply", async function () {
    const { token, recipient, other } = await loadFixture(deployFixture);
    const totalBefore = await token.totalSupply();
    const amount = ethers.parseEther("250");

    await token.connect(recipient).transfer(other.address, amount);

    expect(await token.balanceOf(other.address)).to.equal(amount);
    expect(await token.totalSupply()).to.equal(totalBefore);
  });

  it("supports approvals and transferFrom", async function () {
    const { token, recipient, spender, other } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("75");

    await token.connect(recipient).approve(spender.address, amount);
    expect(await token.allowance(recipient.address, spender.address)).to.equal(amount);

    await token.connect(spender).transferFrom(recipient.address, other.address, amount);
    expect(await token.balanceOf(other.address)).to.equal(amount);
    expect(await token.allowance(recipient.address, spender.address)).to.equal(0);
  });

  it("supports burn and burnFrom flows", async function () {
    const { token, recipient, spender } = await loadFixture(deployFixture);
    const burnSelfAmount = ethers.parseEther("10");
    const burnFromAmount = ethers.parseEther("15");

    const supplyBefore = await token.totalSupply();
    await token.connect(recipient).burn(burnSelfAmount);
    expect(await token.totalSupply()).to.equal(supplyBefore - burnSelfAmount);

    await token.connect(recipient).approve(spender.address, burnFromAmount);
    await token.connect(spender).burnFrom(recipient.address, burnFromAmount);

    expect(await token.allowance(recipient.address, spender.address)).to.equal(0);
    expect(await token.totalSupply()).to.equal(supplyBefore - burnSelfAmount - burnFromAmount);
  });

  it("supports permit approvals", async function () {
    const { token, owner, recipient, spender } = await loadFixture(deployFixture);
    const permitOwner = ethers.Wallet.createRandom().connect(ethers.provider);
    const value = ethers.parseEther("20");
    const nonce = await token.nonces(permitOwner.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const network = await ethers.provider.getNetwork();

    await owner.sendTransaction({ to: permitOwner.address, value: ethers.parseEther("1") });
    await token.connect(recipient).transfer(permitOwner.address, value);

    const domain = {
      name: await token.name(),
      version: "1",
      chainId: network.chainId,
      verifyingContract: await token.getAddress(),
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const signature = await permitOwner.signTypedData(domain, types, {
      owner: permitOwner.address,
      spender: spender.address,
      value,
      nonce,
      deadline,
    });

    const { v, r, s } = ethers.Signature.from(signature);
    await token
      .connect(spender)
      .permit(permitOwner.address, spender.address, value, deadline, v, r, s);

    expect(await token.allowance(permitOwner.address, spender.address)).to.equal(value);
    expect(await token.nonces(permitOwner.address)).to.equal(nonce + 1n);
  });

  it("tracks voting power across delegation and transfers", async function () {
    const { token, recipient, other } = await loadFixture(deployFixture);
    const initial = await token.balanceOf(recipient.address);
    const moved = ethers.parseEther("100");

    expect(await token.getVotes(recipient.address)).to.equal(0);

    await token.connect(recipient).delegate(recipient.address);
    expect(await token.getVotes(recipient.address)).to.equal(initial);

    await token.connect(recipient).transfer(other.address, moved);
    expect(await token.getVotes(recipient.address)).to.equal(initial - moved);
    expect(await token.getVotes(other.address)).to.equal(0);

    await token.connect(other).delegate(other.address);
    expect(await token.getVotes(other.address)).to.equal(moved);
  });
});
