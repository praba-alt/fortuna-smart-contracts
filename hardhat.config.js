require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
require("./tasks/verify");

const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "";
const BASE_MAINNET_RPC_URL = process.env.BASE_MAINNET_RPC_URL || "";
const LOCALHOST_RPC_URL = process.env.LOCALHOST_RPC_URL || "http://127.0.0.1:8545";
const LOCAL_MNEMONIC =
  process.env.LOCAL_MNEMONIC ||
  "test test test test test test test test test test test junk";
const LOCAL_HD_PATH = process.env.LOCAL_HD_PATH || "m/44'/60'/0'/0";
const LOCAL_ACCOUNT_COUNT = Number(process.env.LOCAL_ACCOUNT_COUNT || "20");
const LOCAL_INITIAL_BALANCE_WEI =
  process.env.LOCAL_INITIAL_BALANCE_WEI || "10000000000000000000000"; // 10,000 ETH
const PRIVATE_KEY = (process.env.PRIVATE_KEY || "").trim();
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

function configuredAccounts() {
  if (!PRIVATE_KEY) return [];
  const sanitized = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY.slice(2) : PRIVATE_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(sanitized)) return [];
  return [`0x${sanitized}`];
}

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./hh-cache",
    artifacts: "./hh-artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: {
        mnemonic: LOCAL_MNEMONIC,
        path: LOCAL_HD_PATH,
        count: LOCAL_ACCOUNT_COUNT,
        accountsBalance: LOCAL_INITIAL_BALANCE_WEI,
      },
    },
    localhost: {
      url: LOCALHOST_RPC_URL,
      chainId: 31337,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL,
      chainId: 84532,
      accounts: configuredAccounts(),
    },
    base: {
      url: BASE_MAINNET_RPC_URL,
      chainId: 8453,
      accounts: configuredAccounts(),
    },
  },
  etherscan: {
    // Single Etherscan key enables V2 multichain verification (incl. Base/Base Sepolia).
    apiKey: ETHERSCAN_API_KEY,
  },
};
