export const CHAIN_ID = 4663;
export const GT_NETWORK = "robinhood"; // GeckoTerminal network id
export const DS_CHAIN = "robinhood"; // DexScreener chain id
export const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

export function rpcUrl() {
  const key = process.env.ALCHEMY_API_KEY;
  return key ? `https://robinhood-mainnet.g.alchemy.com/v2/${key}` : PUBLIC_RPC;
}

// Uniswap v4 PoolManager on Robinhood Chain: holds pooled tokens, never a "whale".
export const POOL_MANAGERS = new Set(["0x8366a39cc670b4001a1121b8f6a443a643e40951"]);

export const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdead000000000000000042069420694206942069",
]);

// Quote assets we never show as their own card.
export const QUOTE_SYMBOLS = new Set(["WETH", "ETH", "USDC", "USDT", "USDC.E", "DAI"]);
