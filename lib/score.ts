import { BURN_ADDRESSES, POOL_MANAGERS } from "./chain";
import type { GoPlus, Market, Transfer } from "./sources";

export type Level = "good" | "warn" | "bad";
export type Check = { id: string; level: Level; title: string; detail: string; weight: number };
export type Tier = "safe" | "caution" | "danger" | "unchecked";

const yes = (v: unknown) => v === "1" || v === 1;
const pct = (v: unknown) => (Number(v) || 0) * 100;
const usd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;
export { usd };

/** Addresses that hold tokens but aren't people: pools, burn, locks. */
export function nonWhaleSet(gp: GoPlus, market?: Market | null): Set<string> {
  const s = new Set<string>([...POOL_MANAGERS, ...BURN_ADDRESSES]);
  for (const d of gp?.dex ?? []) if (d.pair && d.pair.length === 42) s.add(String(d.pair).toLowerCase());
  if (market?.poolAddress?.length === 42) s.add(market.poolAddress.toLowerCase());
  return s;
}

export type Holder = { address: string; percent: number; isContract: boolean; locked: boolean; tag: string; kind: "pool" | "burn" | "locked" | "whale" };

export function holders(gp: GoPlus, market?: Market | null): Holder[] {
  const skip = nonWhaleSet(gp, market);
  return (gp?.holders ?? []).map((h: any) => {
    const a = String(h.address).toLowerCase();
    const kind: Holder["kind"] = BURN_ADDRESSES.has(a) ? "burn" : skip.has(a) ? "pool" : yes(h.is_locked) ? "locked" : "whale";
    return { address: a, percent: pct(h.percent), isContract: yes(h.is_contract), locked: yes(h.is_locked), tag: h.tag ?? "", kind };
  });
}

/** % of supply held by the top 10 real wallets (pools, burns, locks excluded). */
export function whaleShare(gp: GoPlus, market?: Market | null) {
  const w = holders(gp, market).filter((h) => h.kind === "whale").slice(0, 10);
  return { top10: w.reduce((s, h) => s + h.percent, 0), biggest: w[0]?.percent ?? 0 };
}

export function safety(gp: GoPlus, market?: Market | null) {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  if (!gp) {
    return { score: null as number | null, tier: "unchecked" as Tier, checks, critical: false };
  }

  const round = (t: number) => (t < 0.1 ? 0 : t); // dust-level taxes read as zero
  const buyTax = round(pct(gp.buy_tax));
  const sellTax = round(pct(gp.sell_tax));
  const owner = String(gp.owner_address ?? "").toLowerCase();
  const renounced = !owner || BURN_ADDRESSES.has(owner);

  // Can you actually get out?
  if (yes(gp.is_honeypot)) add({ id: "honeypot", level: "bad", weight: 100, title: "Honeypot", detail: "Buying works, selling doesn't. You can't get your money back out." });
  else add({ id: "honeypot", level: "good", weight: 0, title: "You can sell", detail: "No honeypot trap detected." });
  if (yes(gp.cannot_sell_all)) add({ id: "sellall", level: "bad", weight: 40, title: "Can't sell it all", detail: "The contract stops you from selling your whole bag." });
  if (yes(gp.cannot_buy)) add({ id: "cannotbuy", level: "bad", weight: 30, title: "Buying blocked", detail: "Regular wallets can't buy this token." });

  // Taxes
  const taxLevel = (t: number): Level => (t > 10 ? "bad" : t > 0 ? "warn" : "good");
  add({
    id: "tax", level: taxLevel(Math.max(buyTax, sellTax)), weight: Math.max(buyTax, sellTax) > 10 ? 30 : Math.max(buyTax, sellTax) > 0 ? 8 : 0,
    title: buyTax || sellTax ? `Tax: ${buyTax.toFixed(1)}% buy / ${sellTax.toFixed(1)}% sell` : "No trading tax",
    detail: buyTax || sellTax ? "A cut of every trade goes to the contract or team." : "You keep 100% of every trade.",
  });
  if (yes(gp.slippage_modifiable)) add({ id: "taxchange", level: "bad", weight: 15, title: "Tax can be raised", detail: "The owner can change the trading tax at any time, even to 100%." });
  if (yes(gp.personal_slippage_modifiable)) add({ id: "pertax", level: "bad", weight: 15, title: "Per-wallet tax", detail: "The owner can set a special tax on specific wallets." });

  // Owner powers
  add(renounced
    ? { id: "owner", level: "good", weight: 0, title: "No owner", detail: "Ownership is renounced. Nobody can change the rules." }
    : { id: "owner", level: "warn", weight: 5, title: "Has an owner", detail: "Someone still controls this contract. Check what they can do below." });
  if (yes(gp.is_mintable)) add({ id: "mint", level: renounced ? "warn" : "bad", weight: renounced ? 5 : 20, title: "More can be minted", detail: "New tokens can be created, which waters down your share." });
  else add({ id: "mint", level: "good", weight: 0, title: "Fixed supply", detail: "No one can print more tokens." });
  if (yes(gp.hidden_owner)) add({ id: "hidden", level: "bad", weight: 20, title: "Hidden owner", detail: "There's a secret admin who can control the contract." });
  if (yes(gp.can_take_back_ownership)) add({ id: "takeback", level: "bad", weight: 20, title: "Fake renounce", detail: "Ownership looks given up but can be reclaimed." });
  if (yes(gp.owner_change_balance)) add({ id: "balance", level: "bad", weight: 30, title: "Owner can edit balances", detail: "The owner can change how many tokens your wallet holds." });
  if (yes(gp.transfer_pausable)) add({ id: "pause", level: "bad", weight: 15, title: "Trading can be paused", detail: "The owner can freeze all transfers." });
  if (yes(gp.is_blacklisted)) add({ id: "blacklist", level: "warn", weight: 10, title: "Has a blacklist", detail: "Specific wallets can be blocked from trading." });
  if (yes(gp.trading_cooldown)) add({ id: "cooldown", level: "warn", weight: 5, title: "Trade cooldown", detail: "You have to wait between trades." });
  if (yes(gp.anti_whale_modifiable)) add({ id: "antiwhale", level: "warn", weight: 5, title: "Adjustable max buy", detail: "The owner can change how much one wallet may buy or hold." });

  // Code
  if (gp.is_open_source === "0") add({ id: "source", level: "bad", weight: 25, title: "Code is hidden", detail: "The contract isn't verified, so nobody can read what it does." });
  else add({ id: "source", level: "good", weight: 0, title: "Code is public", detail: "Anyone can read the contract." });
  if (yes(gp.is_proxy)) add({ id: "proxy", level: "warn", weight: 10, title: "Upgradeable", detail: "The code can be swapped out later for different rules." });
  if (yes(gp.selfdestruct)) add({ id: "selfdestruct", level: "bad", weight: 20, title: "Self-destruct", detail: "The contract can delete itself." });
  if (yes(gp.external_call)) add({ id: "external", level: "warn", weight: 5, title: "Calls other contracts", detail: "Behavior depends on outside code." });
  if (yes(gp.honeypot_with_same_creator)) add({ id: "serial", level: "bad", weight: 30, title: "Creator made a honeypot before", detail: "This deployer has launched a scam token in the past." });

  // People + liquidity
  const creatorPct = pct(gp.creator_percent);
  if (creatorPct > 10) add({ id: "creator", level: "warn", weight: 10, title: `Creator holds ${creatorPct.toFixed(1)}%`, detail: "The deployer still holds a big pile and could dump it." });
  const { top10 } = whaleShare(gp, market);
  add({
    id: "whales", level: top10 > 50 ? "bad" : top10 > 30 ? "warn" : "good", weight: top10 > 50 ? 15 : top10 > 30 ? 8 : 0,
    title: `Top 10 wallets hold ${top10.toFixed(1)}%`,
    detail: top10 > 50 ? "A few wallets control most of it. One sale can crash the price." : top10 > 30 ? "Fairly concentrated. Watch the big holders." : "Nicely spread out across holders.",
  });
  const liq = market?.liquidityUsd ?? 0;
  if (market) add({
    id: "liq", level: liq < 5_000 ? "bad" : liq < 25_000 ? "warn" : "good", weight: liq < 5_000 ? 20 : liq < 25_000 ? 10 : 0,
    title: `${usd(liq)} liquidity`,
    detail: liq < 5_000 ? "Very thin. Even small trades move the price a lot." : liq < 25_000 ? "Shallow pool. Big trades will slip." : "Deep enough to trade normal sizes.",
  });
  // Only fungible (v2-style) LP tokens have a meaningful lock status; v3/v4 positions are NFTs.
  const lp = (gp.lp_holders as any[] | undefined)?.filter((h) => !h.NFT_list);
  if (lp?.length) {
    const locked = lp.reduce((s, h) => s + (yes(h.is_locked) || BURN_ADDRESSES.has(String(h.address).toLowerCase()) ? pct(h.percent) : 0), 0);
    add({
      id: "lplock", level: locked >= 90 ? "good" : locked >= 50 ? "warn" : "bad", weight: locked >= 90 ? 0 : locked >= 50 ? 5 : 15,
      title: `${locked.toFixed(0)}% of liquidity locked`,
      detail: locked >= 90 ? "The pool can't be pulled out from under you." : "The team could pull liquidity (a rug pull).",
    });
  }

  const critical = checks.some((c) => ["honeypot", "sellall", "balance", "serial"].includes(c.id) && c.level === "bad");
  const score = critical ? Math.min(15, 100 - checks.reduce((s, c) => s + c.weight, 0)) : Math.max(0, 100 - checks.reduce((s, c) => s + c.weight, 0));
  const tier: Tier = critical || score < 45 ? "danger" : score < 75 ? "caution" : "safe";
  const order = { bad: 0, warn: 1, good: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level] || b.weight - a.weight);
  return { score: Math.max(0, score), tier, checks, critical };
}

export function sentiment(m: Market | null) {
  if (!m) return { score: 50, label: "Quiet", buyShare: 50 };
  const b = m.tx.h6.buyers + m.tx.h24.buyers;
  const s = m.tx.h6.sellers + m.tx.h24.sellers;
  const buyShare = b + s ? (b / (b + s)) * 100 : 50;
  const momentum = Math.max(-25, Math.min(25, m.change.h6 / 2 + m.change.h1));
  const score = Math.round(Math.max(0, Math.min(100, buyShare * 0.7 + 15 + momentum)));
  const label = m.tx.h24.buys + m.tx.h24.sells < 20 ? "Quiet" : score >= 65 ? "Bullish" : score >= 55 ? "Warming" : score > 45 ? "Neutral" : score > 35 ? "Cooling" : "Bearish";
  return { score, label, buyShare: Math.round(buyShare) };
}

export function liquidityGrade(liq: number) {
  return liq >= 1_000_000 ? "A+" : liq >= 250_000 ? "A" : liq >= 100_000 ? "B" : liq >= 25_000 ? "C" : liq >= 5_000 ? "D" : "F";
}

export type WhaleMove = { hash: string; block: number; ts?: string; side: "buy" | "sell" | "move"; wallet: string; amount: number; usd: number; pctSupply: number };

/**
 * Net each transaction against the pools: tokens leaving pools = a buy, tokens entering = a sell.
 * Routed swaps hop through routers and several pools, so per-transfer labels would be wrong.
 */
export function whaleMoves(transfers: Transfer[], gp: GoPlus, market: Market | null, totalSupply: number, extraPools: string[] = []): WhaleMove[] {
  const pools = nonWhaleSet(gp, market);
  for (const p of extraPools) if (p.length === 42) pools.add(p.toLowerCase());
  const price = market?.priceUsd ?? 0;
  const byTx = new Map<string, Transfer[]>();
  for (const t of transfers) (byTx.get(t.hash) ?? byTx.set(t.hash, []).get(t.hash)!).push(t);

  const out: WhaleMove[] = [];
  for (const [hash, ts] of byTx) {
    let out_ = 0, in_ = 0;
    for (const t of ts) {
      if (pools.has(t.from) && !pools.has(t.to)) out_ += t.amount;
      if (pools.has(t.to) && !pools.has(t.from)) in_ += t.amount;
    }
    const net = out_ - in_;
    let side: WhaleMove["side"], wallet: string, amount: number;
    if (Math.abs(net) > 0 && (out_ || in_)) {
      side = net > 0 ? "buy" : "sell";
      amount = Math.abs(net);
      // buyer = last non-pool recipient; seller = first non-pool sender
      wallet = side === "buy"
        ? [...ts].reverse().find((t) => !pools.has(t.to))?.to ?? ts[ts.length - 1].to
        : ts.find((t) => !pools.has(t.from))?.from ?? ts[0].from;
    } else {
      const big = ts.reduce((m, t) => (t.amount > m.amount ? t : m), ts[0]);
      if (pools.has(big.from) || pools.has(big.to)) continue;
      side = "move"; amount = big.amount; wallet = big.to;
    }
    if (BURN_ADDRESSES.has(wallet)) continue;
    const usd = amount * price;
    const pctSupply = totalSupply ? (amount / totalSupply) * 100 : 0;
    if (usd >= 2_500 || pctSupply >= 0.25) out.push({ hash, block: ts[0].block, ts: ts[0].ts, side, wallet, amount, usd, pctSupply });
  }
  // Wallets that both buy and sell repeatedly in the window are arbitrage/MEV bots, not whales.
  const tally = new Map<string, { b: number; s: number }>();
  for (const m of out) {
    const t = tally.get(m.wallet) ?? { b: 0, s: 0 };
    if (m.side === "buy") t.b++;
    if (m.side === "sell") t.s++;
    tally.set(m.wallet, t);
  }
  const bot = (w: string) => { const t = tally.get(w)!; return t.b >= 2 && t.s >= 2; };
  return out.filter((m) => !bot(m.wallet)).sort((x, y) => y.block - x.block).slice(0, 40);
}
