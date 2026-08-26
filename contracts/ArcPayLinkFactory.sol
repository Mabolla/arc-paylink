// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ArcPayLinkEscrow} from "./ArcPayLinkEscrow.sol";

contract ArcPayLinkFactory {
    address public immutable implementation;
    address public immutable paymentToken;
    mapping(bytes32 paymentId => address escrow) public escrows;
    mapping(address sender => uint256 nonce) public nonces;

    error DuplicatePayment();

    event PayLinkCreated(
        bytes32 indexed paymentId,
        address indexed escrow,
        address indexed sender,
        address token,
        uint256 amount,
        uint256 expiry,
        bytes32 secretHash
    );

    constructor(address paymentToken_) {
        if (paymentToken_ == address(0)) revert ArcPayLinkEscrow.InvalidConfiguration();
        paymentToken = paymentToken_;
        implementation = address(new ArcPayLinkEscrow());
    }

    function createPayLink(uint256 amount, uint256 expiry, bytes32 secretHash)
        external
        returns (bytes32 paymentId, address escrow)
    {
        uint256 nonce = nonces[msg.sender]++;
        paymentId = keccak256(
            abi.encode(block.chainid, address(this), msg.sender, nonce, paymentToken, amount, expiry, secretHash)
        );
        if (escrows[paymentId] != address(0)) revert DuplicatePayment();

        escrow = Clones.cloneDeterministic(implementation, paymentId);
        ArcPayLinkEscrow(escrow).initialize(paymentToken, msg.sender, amount, expiry, secretHash);
        escrows[paymentId] = escrow;

        emit PayLinkCreated(paymentId, escrow, msg.sender, paymentToken, amount, expiry, secretHash);
    }

    function predictEscrow(bytes32 paymentId) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, paymentId, address(this));
    }
}
