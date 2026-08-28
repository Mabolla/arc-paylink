const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArcPayLink escrow", function () {
  const AMOUNT = 25_000_000n;
  const HOUR = 60 * 60;

  async function fixture() {
    const [sender, recipient, relayer, attacker] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSDC");
    const factory = await ethers.deployContract("ArcPayLinkFactory", [token.target]);
    return { sender, recipient, relayer, attacker, token, factory };
  }

  async function createPayLink(context, overrides = {}) {
    const latest = await ethers.provider.getBlock("latest");
    const secret = overrides.secret ?? ethers.hexlify(ethers.randomBytes(32));
    const secretHash = ethers.keccak256(secret);
    const expiry = overrides.expiry ?? latest.timestamp + HOUR;
    const amount = overrides.amount ?? AMOUNT;
    const nonce = await context.factory.nonces(context.sender.address);
    const network = await ethers.provider.getNetwork();
    const paymentId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "uint256", "address", "uint256", "uint256", "bytes32"],
        [network.chainId, context.factory.target, context.sender.address, nonce, context.token.target, amount, expiry, secretHash],
      ),
    );
    const predicted = await context.factory.predictEscrow(paymentId);
    await context.factory.connect(context.sender).createPayLink(amount, expiry, secretHash);
    const escrow = await ethers.getContractAt("ArcPayLinkEscrow", predicted);
    return { escrow, paymentId, secret, secretHash, expiry, amount };
  }

  async function signClaim(signer, escrow, recipient, secretHash, deadline) {
    const network = await ethers.provider.getNetwork();
    return signer.signTypedData(
      { name: "Arc PayLink", version: "1", chainId: network.chainId, verifyingContract: escrow.target },
      {
        Claim: [
          { name: "escrow", type: "address" },
          { name: "recipient", type: "address" },
          { name: "secretHash", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { escrow: escrow.target, recipient, secretHash, deadline },
    );
  }

  it("creates an isolated deterministic escrow and recognizes forwarded funding", async function () {
    const context = await fixture();
    const link = await createPayLink(context);

    expect(await context.factory.escrows(link.paymentId)).to.equal(link.escrow.target);
    expect(await link.escrow.sender()).to.equal(context.sender.address);
    expect(await link.escrow.state()).to.equal(0);

    await context.token.mint(link.escrow.target, link.amount);
    expect(await link.escrow.state()).to.equal(1);
  });

  it("lets a relayer claim only to the address that signed the request", async function () {
    const context = await fixture();
    const link = await createPayLink(context);
    await context.token.mint(link.escrow.target, link.amount);
    const deadline = link.expiry - 1;
    const signature = await signClaim(context.recipient, link.escrow, context.recipient.address, link.secretHash, deadline);

    await expect(
      link.escrow.connect(context.relayer).claim(link.secret, context.recipient.address, deadline, signature),
    ).to.emit(link.escrow, "Claimed").withArgs(context.recipient.address, link.amount);

    expect(await context.token.balanceOf(context.recipient.address)).to.equal(link.amount);
    expect(await link.escrow.state()).to.equal(2);
  });

  it("rejects a stolen secret when the attacker changes the recipient", async function () {
    const context = await fixture();
    const link = await createPayLink(context);
    await context.token.mint(link.escrow.target, link.amount);
    const deadline = link.expiry - 1;
    const signature = await signClaim(context.recipient, link.escrow, context.recipient.address, link.secretHash, deadline);

    await expect(
      link.escrow.connect(context.attacker).claim(link.secret, context.attacker.address, deadline, signature),
    ).to.be.revertedWithCustomError(link.escrow, "InvalidSignature");
  });

  it("rejects a wrong secret, an expired signature, and a second claim", async function () {
    const context = await fixture();
    const link = await createPayLink(context);
    await context.token.mint(link.escrow.target, link.amount);
    const deadline = link.expiry - 1;
    const signature = await signClaim(context.recipient, link.escrow, context.recipient.address, link.secretHash, deadline);

    await expect(
      link.escrow.claim(ethers.ZeroHash, context.recipient.address, deadline, signature),
    ).to.be.revertedWithCustomError(link.escrow, "InvalidSecret");

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const expiredSignature = await signClaim(context.recipient, link.escrow, context.recipient.address, link.secretHash, now);
    await ethers.provider.send("evm_increaseTime", [1]);
    await ethers.provider.send("evm_mine");
    await expect(
      link.escrow.claim(link.secret, context.recipient.address, now, expiredSignature),
    ).to.be.revertedWithCustomError(link.escrow, "SignatureExpired");

    await link.escrow.claim(link.secret, context.recipient.address, deadline, signature);
    await expect(
      link.escrow.claim(link.secret, context.recipient.address, deadline, signature),
    ).to.be.revertedWithCustomError(link.escrow, "InvalidState");
  });

  it("supports EIP-1271 smart-account recipients", async function () {
    const context = await fixture();
    const smartWallet = await ethers.deployContract("Mock1271Wallet", [context.recipient.address]);
    const link = await createPayLink(context);
    await context.token.mint(link.escrow.target, link.amount);
    const deadline = link.expiry - 1;
    const signature = await signClaim(context.recipient, link.escrow, smartWallet.target, link.secretHash, deadline);

    await link.escrow.connect(context.relayer).claim(link.secret, smartWallet.target, deadline, signature);
    expect(await context.token.balanceOf(smartWallet.target)).to.equal(link.amount);
  });

  it("allows only the sender to refund a funded link after expiry", async function () {
    const context = await fixture();
    const link = await createPayLink(context);
    await context.token.mint(link.escrow.target, link.amount);

    await expect(link.escrow.connect(context.attacker).refund()).to.be.revertedWithCustomError(link.escrow, "Unauthorized");
    await expect(link.escrow.connect(context.sender).refund()).to.be.revertedWithCustomError(link.escrow, "PaymentNotExpired");

    await ethers.provider.send("evm_setNextBlockTimestamp", [link.expiry]);
    await ethers.provider.send("evm_mine");
    await expect(link.escrow.connect(context.sender).refund())
      .to.emit(link.escrow, "Refunded")
      .withArgs(context.sender.address, link.amount);

    expect(await context.token.balanceOf(context.sender.address)).to.equal(link.amount);
    expect(await link.escrow.state()).to.equal(3);
  });

  it("prevents claiming after expiry and reinitializing a clone", async function () {
    const context = await fixture();
    const link = await createPayLink(context);
    await context.token.mint(link.escrow.target, link.amount);
    const signature = await signClaim(context.recipient, link.escrow, context.recipient.address, link.secretHash, link.expiry + HOUR);

    await ethers.provider.send("evm_setNextBlockTimestamp", [link.expiry]);
    await ethers.provider.send("evm_mine");
    await expect(
      link.escrow.claim(link.secret, context.recipient.address, link.expiry + HOUR, signature),
    ).to.be.revertedWithCustomError(link.escrow, "PaymentExpired");

    await expect(
      link.escrow.initialize(context.token.target, context.attacker.address, link.amount, link.expiry + HOUR, link.secretHash),
    ).to.be.revertedWithCustomError(link.escrow, "AlreadyInitialized");
  });

  it("locks the implementation contract against direct initialization", async function () {
    const context = await fixture();
    const implementation = await ethers.getContractAt("ArcPayLinkEscrow", await context.factory.implementation());
    const latest = await ethers.provider.getBlock("latest");

    await expect(
      implementation.initialize(
        context.token.target,
        context.attacker.address,
        AMOUNT,
        latest.timestamp + HOUR,
        ethers.keccak256(ethers.randomBytes(32)),
      ),
    ).to.be.revertedWithCustomError(implementation, "AlreadyInitialized");
  });
});
