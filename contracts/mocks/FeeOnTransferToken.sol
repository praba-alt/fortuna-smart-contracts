// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FeeOnTransferToken is ERC20 {
    uint16 public immutable feeBps;

    constructor(uint16 _feeBps) ERC20("Fee On Transfer Token", "FOT") {
        require(_feeBps <= 2000, "FeeOnTransferToken: fee too high");
        feeBps = _feeBps;
        _mint(msg.sender, 1_000_000 ether);
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBps) / 10000;
        uint256 net = value - fee;

        super._update(from, to, net);
        if (fee > 0) {
            super._update(from, address(0), fee);
        }
    }
}
