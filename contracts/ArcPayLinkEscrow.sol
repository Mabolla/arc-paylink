// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract ArcPayLinkEscrow {
    using SafeERC20 for IERC20;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Arc PayLink");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address escrow,address recipient,bytes32 secretHash,uint256 deadline)");

    enum State {
        AwaitingFunds,
        Funded,
        Claimed,
        Refunded
    }

    error AlreadyInitialized();
    error InvalidConfiguration();
    error InvalidState();
    error PaymentExpired();
    error PaymentNotExpired();
    error SignatureExpired();
    error InvalidSecret();
    error InvalidSignature();
    error Unauthorized();

    IERC20 public token;
    address public sender;
    uint256 public amount;
    uint256 public expiry;
    bytes32 public secretHash;
    bool public claimed;
    bool public refunded;
    bool private initialized;

    event Initialized(address indexed sender, address indexed token, uint256 amount, uint256 expiry, bytes32 secretHash);
    event Claimed(address indexed recipient, uint256 amount);
    event Refunded(address indexed sender, uint256 amount);

    constructor() {
        initialized = true;
    }

    function initialize(address token_, address sender_, uint256 amount_, uint256 expiry_, bytes32 secretHash_) external {
        if (initialized) revert AlreadyInitialized();
        if (token_ == address(0) || sender_ == address(0) || amount_ == 0 || expiry_ <= block.timestamp || secretHash_ == bytes32(0)) {
            revert InvalidConfiguration();
        }

        initialized = true;
        token = IERC20(token_);
        sender = sender_;
        amount = amount_;
        expiry = expiry_;
        secretHash = secretHash_;

        emit Initialized(sender_, token_, amount_, expiry_, secretHash_);
    }

    function state() public view returns (State) {
        if (claimed) return State.Claimed;
        if (refunded) return State.Refunded;
        if (address(token) != address(0) && token.balanceOf(address(this)) >= amount) return State.Funded;
        return State.AwaitingFunds;
    }

    function claimDigest(address recipient, uint256 deadline) public view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, address(this), recipient, secretHash, deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function claim(bytes32 secret, address recipient, uint256 deadline, bytes calldata signature) external {
        if (claimed || refunded || state() != State.Funded) revert InvalidState();
        if (block.timestamp >= expiry) revert PaymentExpired();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (recipient == address(0)) revert InvalidConfiguration();
        if (keccak256(abi.encodePacked(secret)) != secretHash) revert InvalidSecret();
        if (!SignatureChecker.isValidSignatureNow(recipient, claimDigest(recipient, deadline), signature)) {
            revert InvalidSignature();
        }

        claimed = true;
        token.safeTransfer(recipient, amount);
        emit Claimed(recipient, amount);
    }

    function refund() external {
        if (msg.sender != sender) revert Unauthorized();
        if (claimed || refunded || state() != State.Funded) revert InvalidState();
        if (block.timestamp < expiry) revert PaymentNotExpired();

        refunded = true;
        token.safeTransfer(sender, amount);
        emit Refunded(sender, amount);
    }
}
