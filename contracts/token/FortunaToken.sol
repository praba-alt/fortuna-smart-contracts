// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.0
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

contract FortunaToken is ERC20, ERC20Burnable, Ownable2Step, ERC20Permit, ERC20Votes {
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_MINT_EXTENSION = 100_000_000 ether;

    address public minter;
    uint256 public mintedExtension;

    error UnauthorizedMinter(address caller);
    error InvalidMinter(address newMinter);
    error MintCapExceeded(uint256 requestedTotalMintedExtension, uint256 maxMintExtension);

    event MinterUpdated(address indexed previousMinter, address indexed newMinter);

    modifier onlyMinter() {
        if (msg.sender != minter) {
            revert UnauthorizedMinter(msg.sender);
        }
        _;
    }

    constructor(address recipient, address initialOwner)
        ERC20("Fortuna Token", "FORT")
        Ownable(initialOwner)
        ERC20Permit("Fortuna Token")
    {
        minter = initialOwner;
        _mint(recipient, INITIAL_SUPPLY);
    }

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) {
            revert InvalidMinter(newMinter);
        }

        address previousMinter = minter;
        minter = newMinter;

        emit MinterUpdated(previousMinter, newMinter);
    }

    function mint(address to, uint256 amount) public onlyMinter {
        uint256 updatedMintedExtension = mintedExtension + amount;
        if (updatedMintedExtension > MAX_MINT_EXTENSION) {
            revert MintCapExceeded(updatedMintedExtension, MAX_MINT_EXTENSION);
        }

        mintedExtension = updatedMintedExtension;
        _mint(to, amount);
    }

    // The following functions are overrides required by Solidity.

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
