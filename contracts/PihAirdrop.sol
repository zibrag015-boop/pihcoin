// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPihToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

/// @notice Recipient-paid, once-per-address faucet for the existing Ethereum PIH token.
contract PihAirdrop {
    IPihToken public constant TOKEN = IPihToken(0x687FE7D7247a63E338fF7d089b9434C155B200D8);
    uint256 public constant CLAIM_AMOUNT = 1_000_000_000_000; // 0.000001 PIH, 18 decimals
    address public immutable owner;
    mapping(address => bool) public claimed;

    error AlreadyClaimed();
    error Empty();
    error TransferFailed();
    error NotOwner();

    event Claimed(address indexed recipient, uint256 amount);
    event Withdrawn(uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    /// @dev No approval, payment, signature, or token transfer from the recipient is required.
    function claim() external {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        if (TOKEN.balanceOf(address(this)) < CLAIM_AMOUNT) revert Empty();
        claimed[msg.sender] = true;
        emit Claimed(msg.sender, CLAIM_AMOUNT);
        if (!TOKEN.transfer(msg.sender, CLAIM_AMOUNT)) revert TransferFailed();
    }

    function availableClaims() external view returns (uint256) {
        return TOKEN.balanceOf(address(this)) / CLAIM_AMOUNT;
    }

    /// @notice The original funder can recover undistributed PIH.
    function withdraw(uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        emit Withdrawn(amount);
        if (!TOKEN.transfer(owner, amount)) revert TransferFailed();
    }
}
