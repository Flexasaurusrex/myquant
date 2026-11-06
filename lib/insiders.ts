import "server-only";
import { BURN_ADDRESSES, rpcUrl } from "./chain";
import { blockClock, cached, pool, rpc, TRANSFER_TOPIC, type GoPlus, type Market } from "./sources";
import { holders, nonWhaleSet } from "./score";

export type InsiderWallet = {
  address: string;
  role: "creator" | "owner" | "sniper" | "early" | "allocation" | "fresh-whale" | "contract";
  boughtPct: number; // % of supply received at launch
  holdingPct: number; // % of supply held now
  secondsAfterLaunch: number | null;
  txCount: number | null; // wallet nonce; tiny = fresh wallet
  status: "holding" | "trimmed" | "sold" | "added";
};

export type InsiderReport = {
  launchedAt: string | null;
  launchBlock: number | null;
  creator: { address: string | null; pct: number; txCount: number | null };
  owner: { address: string | null; pct: number };
  snipers: { count: number; boughtPct: number; holdingPct: number };
  early: { count: number; boughtPct: number; holdingPct: number; soldCount: number };
  bundle: { wallets: number; pct: number };
  allocations: { count: number; pct: number };
  freshWhales: { count: number; pct: number };
  contracts: { count: number; pct: number };
  risk: "low" | "medium" | "high" | "unknown";
  riskReasons: string[];
  wallets: InsiderWallet[];
};

const pad = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");

async function balanceOf(token: string, wallet: string, decimals: number) {
  try {
    const r = await rpc(rpcUrl(), "eth_call", [{ to: token, data: "0x70a08231" + pad(wallet) }, "latest"]);
    return Number(BigInt(r === "0x" ? 0 : r)) / 10 ** decimals;
  } catch {
    return NaN;
  }
}

async function txCount(wallet: string) {
  try {
    return parseInt(await rpc(rpcUrl(), "eth_getTransactionCount", [wallet, "latest"]), 16);
  } catch {
    return null;
  }
}

async function launchLogs(token: string, from: number, to: number): Promise<any[]> {
  // Halve the window if a hyped launch blows the 10k-log cap.
  for (let end = to; end > from; end = from + Math.floor((end - from) / 2)) {
    try {
      return await rpc(rpcUrl(), "eth_getLogs", [
        { address: token, fromBlock: "0x" + from.toString(16), toBlock: "0x" + end.toString(16), topics: [TRANSFER_TOPIC] },
      ]);
    } catch {
      /* shrink */
    }
  }
  return [];
}

export async function insiderReport(
  token: string, gp: GoPlus, market: Market | null, pools: Market[], decimals: number,
): Promise<InsiderReport> {
  const a = token.toLowerCase();
  return cached(`ins:${a}`, 5 * 60_000, async () => {
    let supply = Number(gp?.total_supply) || 0;
    if (!supply) {
      try {
        const r = await rpc(rpcUrl(), "eth_call", [{ to: a, data: "0x18160ddd" }, "latest"]);
        supply = Number(BigInt(r)) / 10 ** decimals;
      } catch { /* leave 0 */ }
    }
    const pctOf = (x: number) => (supply ? (x / supply) * 100 : 0);
    const creator = gp?.creator_address ? String(gp.creator_address).toLowerCase() : null;
    const owner = gp?.owner_address ? String(gp.owner_address).toLowerCase() : null;
    const reasons: string[] = [];

    const known = nonWhaleSet(gp, market);
    for (const p of pools) if (p.poolAddress.length === 42) known.add(p.poolAddress.toLowerCase());

    // Pool creation gives a rough date; the token's first mint is the true launch.
    const created = [market, ...pools].filter(Boolean).map((p) => new Date(p!.createdAt).getTime()).filter(isFinite);
    const poolMs = created.length ? Math.min(...created) : NaN;
    const clock = await blockClock();
    const blockAt = (ms: number) => Math.round(clock.block - (clock.ts - ms / 1000) / clock.perBlock);
    const poolBlock = isFinite(poolMs) ? Math.min(clock.block, blockAt(poolMs)) : clock.block;

    const ZERO_TOPIC = "0x" + "0".repeat(64);
    let mints: any[] = [];
    for (let hi = poolBlock + 20_000, i = 0; i < 4 && hi > 0; i++, hi -= 9_999_000) {
      const lo = Math.max(0, hi - 9_999_000);
      try {
        const r: any[] = await rpc(rpcUrl(), "eth_getLogs", [
          { address: a, fromBlock: "0x" + lo.toString(16), toBlock: "0x" + Math.min(hi, clock.block).toString(16), topics: [TRANSFER_TOPIC, ZERO_TOPIC] },
        ]);
        if (r.length) mints = r;
        else if (mints.length) break; // found the earliest chunk
      } catch {
        break;
      }
      if (lo === 0) break;
    }
    const mintBlock = mints.length ? parseInt(mints[0].blockNumber, 16) : null;
    const launchBlock = mintBlock ?? (isFinite(poolMs) ? poolBlock : null);
    const launchMs = launchBlock ? (clock.ts - (clock.block - launchBlock) * clock.perBlock) * 1000 : NaN;

    const wallets = new Map<string, InsiderWallet>();
    let bundleWallets = 0, bundleAmt = 0;

    if (launchBlock && launchBlock > 0) {
      const postWindow = Math.round(600 / clock.perBlock); // first ~10 min of life
      const logs = await launchLogs(a, launchBlock, Math.min(clock.block, launchBlock + postWindow));
      const ts = logs.filter((l) => l.topics?.length === 3).map((l) => ({
        from: ("0x" + l.topics[1].slice(26)).toLowerCase(),
        to: ("0x" + l.topics[2].slice(26)).toLowerCase(),
        amount: Number(BigInt(l.data === "0x" ? 0 : l.data)) / 10 ** decimals,
        block: parseInt(l.blockNumber, 16),
      }));

      // Bonding curves / unknown pools: any non-creator address paying out to 5+ distinct wallets is a market.
      const fanout = new Map<string, Set<string>>();
      for (const t of ts) (fanout.get(t.from) ?? fanout.set(t.from, new Set()).get(t.from)!).add(t.to);
      for (const [addr, set] of fanout) if (set.size >= 5 && addr !== creator && !BURN_ADDRESSES.has(addr)) known.add(addr);
      // Routers pass tokens straight through: they forward nearly everything they receive to several wallets.
      const flow = new Map<string, { in: number; out: number }>();
      for (const t of ts) {
        (flow.get(t.to) ?? flow.set(t.to, { in: 0, out: 0 }).get(t.to)!).in += t.amount;
        (flow.get(t.from) ?? flow.set(t.from, { in: 0, out: 0 }).get(t.from)!).out += t.amount;
      }
      for (const [addr, f] of flow)
        if (f.in > 0 && f.out >= 0.9 * f.in && (fanout.get(addr)?.size ?? 0) >= 3 && addr !== creator) known.add(addr);

      const firstBuyBlock = ts.find((t) => known.has(t.from) && !known.has(t.to) && !BURN_ADDRESSES.has(t.from))?.block ?? launchBlock;
      const blockBuyers = new Set<string>();

      for (const t of ts) {
        if (known.has(t.to) || BURN_ADDRESSES.has(t.to) || t.to === creator) continue;
        const fromMint = BURN_ADDRESSES.has(t.from);
        const fromMarket = known.has(t.from) && !fromMint;
        const fromCreator = !!creator && t.from === creator;
        if (!fromMarket && !fromCreator && !fromMint) continue;
        const handout = fromCreator || fromMint;
        const secs = Math.max(0, Math.round((t.block - firstBuyBlock) * clock.perBlock));
        const w = wallets.get(t.to) ?? ({
          address: t.to,
          role: handout ? "allocation" : secs <= 30 ? "sniper" : "early",
          boughtPct: 0, holdingPct: 0, secondsAfterLaunch: handout ? null : secs, txCount: null, status: "holding",
        } as InsiderWallet);
        w.boughtPct += pctOf(t.amount);
        wallets.set(t.to, w);
        if (fromMarket && t.block === firstBuyBlock) { blockBuyers.add(t.to); bundleAmt += t.amount; }
      }
      bundleWallets = blockBuyers.size;
      if (bundleWallets < 3) bundleAmt = 0;
    }

    // Keep the 40 biggest launch wallets, then add creator, owner and current top whales.
    // No genuine buyer takes 30%+ of supply at launch; that's a team wallet seeding or moving the supply.
    for (const w of wallets.values()) if (w.boughtPct > 30 && w.role !== "allocation") { w.role = "allocation"; w.secondsAfterLaunch = null; }
    let list = [...wallets.values()].filter((w) => w.boughtPct >= 0.05).sort((x, y) => y.boughtPct - x.boughtPct).slice(0, 40);
    const topWhales = holders(gp, market).filter((h) => h.kind === "whale" && !h.isContract).slice(0, 10);
    for (const h of topWhales) {
      if (!list.find((w) => w.address === h.address))
        list.push({ address: h.address, role: "fresh-whale", boughtPct: 0, holdingPct: h.percent, secondsAfterLaunch: null, txCount: null, status: "holding" });
    }

    // Live balances + wallet age (nonce), politely rate limited.
    const [bals, nonces, creatorNonce] = await Promise.all([
      pool(list, 3, (w) => balanceOf(a, w.address, decimals)),
      pool(list, 3, (w) => txCount(w.address)),
      creator ? txCount(creator) : Promise.resolve(null),
    ]);
    list.forEach((w, i) => {
      if (isFinite(bals[i])) w.holdingPct = pctOf(bals[i]);
      w.txCount = nonces[i];
      if (w.boughtPct > 0) {
        const r = w.holdingPct / w.boughtPct;
        w.status = r < 0.05 ? "sold" : r < 0.8 ? "trimmed" : r > 1.2 ? "added" : "holding";
      }
    });
    // Nonce 1 is how every contract starts; check code so launchpads, locks and vesting aren't called people.
    const maybeContract = list.filter((w) => w.txCount != null && w.txCount <= 1 && (w.role === "allocation" || w.holdingPct > 2));
    const codes = await pool(maybeContract, 3, (w) => rpc(rpcUrl(), "eth_getCode", [w.address, "latest"]).catch(() => "0x"));
    maybeContract.forEach((w, i) => { if (codes[i] && codes[i] !== "0x") w.role = "contract"; });
    // A "fresh whale" only counts if the wallet really is new; otherwise it's just a big holder.
    list = list.filter((w) => w.role !== "fresh-whale" || (w.txCount != null && w.txCount <= 3));

    const sum = (ws: InsiderWallet[], k: "boughtPct" | "holdingPct") => ws.reduce((s, w) => s + w[k], 0);
    const snipers = list.filter((w) => w.role === "sniper");
    const early = list.filter((w) => w.role === "sniper" || w.role === "early");
    const allocs = list.filter((w) => w.role === "allocation");
    const fresh = list.filter((w) => w.role === "fresh-whale");
    const contracts = list.filter((w) => w.role === "contract");
    const creatorPct = (Number(gp?.creator_percent) || 0) * 100;
    const ownerPct = (Number(gp?.owner_percent) || 0) * 100;

    const insiderHold = sum(snipers, "holdingPct") + sum(allocs, "holdingPct") + creatorPct + sum(fresh, "holdingPct");
    if (sum(snipers, "holdingPct") > 5) reasons.push(`Launch snipers still hold ${sum(snipers, "holdingPct").toFixed(1)}%`);
    if (bundleWallets >= 3) reasons.push(`${bundleWallets} wallets bought in the very first block (bundled launch)`);
    if (sum(allocs, "holdingPct") > 3) reasons.push(`Wallets handed tokens by the creator hold ${sum(allocs, "holdingPct").toFixed(1)}%`);
    if (creatorPct > 5) reasons.push(`Creator wallet still holds ${creatorPct.toFixed(1)}%`);
    if (fresh.length) reasons.push(`${fresh.length} top holder${fresh.length > 1 ? "s are" : " is a"} brand-new wallet${fresh.length > 1 ? "s" : ""}`);
    if (sum(contracts, "holdingPct") > 20) reasons.push(`A contract that got tokens at launch holds ${sum(contracts, "holdingPct").toFixed(1)}% (launchpad, lock or vesting: check it)`);
    if (early.length && early.filter((w) => w.status === "sold").length / early.length > 0.6) reasons.push("Most early buyers have already sold");

    const risk: InsiderReport["risk"] = !gp
      ? "unknown"
      : insiderHold > 25 || (bundleWallets >= 5 && sum(snipers, "holdingPct") > 10) ? "high"
      : insiderHold > 10 || bundleWallets >= 3 || fresh.length >= 5 ? "medium" : "low";

    return {
      launchedAt: isFinite(launchMs) ? new Date(launchMs).toISOString() : null,
      launchBlock,
      creator: { address: creator, pct: creatorPct, txCount: creatorNonce },
      owner: { address: owner && !BURN_ADDRESSES.has(owner) ? owner : null, pct: ownerPct },
      snipers: { count: snipers.length, boughtPct: sum(snipers, "boughtPct"), holdingPct: sum(snipers, "holdingPct") },
      early: { count: early.length, boughtPct: sum(early, "boughtPct"), holdingPct: sum(early, "holdingPct"), soldCount: early.filter((w) => w.status === "sold").length },
      bundle: { wallets: bundleWallets, pct: pctOf(bundleAmt) },
      allocations: { count: allocs.length, pct: sum(allocs, "holdingPct") },
      freshWhales: { count: fresh.length, pct: sum(fresh, "holdingPct") },
      contracts: { count: contracts.length, pct: sum(contracts, "holdingPct") },
      risk,
      riskReasons: reasons,
      wallets: list.sort((x, y) => y.holdingPct - x.holdingPct),
    };
  });
}
