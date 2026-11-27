// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PihAirdrop} from "../contracts/PihAirdrop.sol";

interface Vm {
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function expectRevert(bytes4 error) external;
    function deal(address account, uint256 value) external;
}

contract MockPIH {
    mapping(address => uint256) public balanceOf;
    bool public fail;
    function mint(address account, uint256 amount) external { balanceOf[account] += amount; }
    function setFail(bool value) external { fail = value; }
    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (fail) return false;
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract PihAirdropTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant TOKEN = 0x687FE7D7247a63E338fF7d089b9434C155B200D8;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    uint256 constant AMOUNT = 1e12;
    PihAirdrop faucet;
    MockPIH token;

    function setUp() public {
        vm.etch(TOKEN, type(MockPIH).runtimeCode);
        token = MockPIH(TOKEN);
        faucet = new PihAirdrop();
        token.mint(address(faucet), 1e18);
    }

    function testFixedAmountAndOneMillionClaims() public {
        require(faucet.CLAIM_AMOUNT() == AMOUNT);
        require(faucet.availableClaims() == 1_000_000);
        vm.prank(ALICE); faucet.claim();
        require(token.balanceOf(ALICE) == AMOUNT);
        require(faucet.claimed(ALICE));
        require(faucet.availableClaims() == 999_999);
    }

    function testRepeatClaimReverts() public {
        vm.prank(ALICE); faucet.claim();
        vm.expectRevert(PihAirdrop.AlreadyClaimed.selector);
        vm.prank(ALICE); faucet.claim();
        require(token.balanceOf(ALICE) == AMOUNT);
    }

    function testSeparateWalletsCanClaim() public {
        vm.prank(ALICE); faucet.claim();
        vm.prank(BOB); faucet.claim();
        require(token.balanceOf(ALICE) == AMOUNT && token.balanceOf(BOB) == AMOUNT);
    }

    function testEmptyClaimDoesNotConsumeEligibility() public {
        faucet.withdraw(1e18);
        vm.expectRevert(PihAirdrop.Empty.selector);
        vm.prank(ALICE); faucet.claim();
        require(!faucet.claimed(ALICE));
        token.mint(address(faucet), AMOUNT);
        vm.prank(ALICE); faucet.claim();
        require(faucet.claimed(ALICE));
    }

    function testTransferFailureDoesNotConsumeEligibility() public {
        token.setFail(true);
        vm.expectRevert(PihAirdrop.TransferFailed.selector);
        vm.prank(ALICE); faucet.claim();
        require(!faucet.claimed(ALICE));
    }

    function testOnlyOwnerCanWithdrawUnclaimedTokens() public {
        vm.expectRevert(PihAirdrop.NotOwner.selector);
        vm.prank(ALICE); faucet.withdraw(AMOUNT);
        faucet.withdraw(AMOUNT);
        require(token.balanceOf(address(this)) == AMOUNT);
    }

    function testClaimCannotAcceptEther() public {
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (bool ok,) = address(faucet).call{value: 1}(abi.encodeCall(faucet.claim, ()));
        require(!ok && !faucet.claimed(ALICE));
    }

    function testFuzzAnyAddressReceivesExactAmountOnce(address recipient) public {
        if (recipient == address(faucet) || recipient == address(this)) return;
        uint256 beforeBalance = token.balanceOf(recipient);
        vm.prank(recipient); faucet.claim();
        require(token.balanceOf(recipient) == beforeBalance + AMOUNT);
        vm.expectRevert(PihAirdrop.AlreadyClaimed.selector);
        vm.prank(recipient); faucet.claim();
    }
}
