import "server-only";
import { unstable_cache } from "next/cache";
import { goplus, marketFeed, pool, recentTransfers, tokenDecimals, type Market } from "./sources";
import { whaleMoves } from "./score";
import { insiderReport } from "./insiders";
import { computeHeat, type HeatSignal } from "./heat";

const WINDOW_H = 6;

// Full insider scans are ~100 RPC calls each, so each token's result is cached for an hour.
const insiderRiskCached = unstable_cache(
  async (address: string, poolAddress: string, createdAt: string) => {
    const [gp, decimals] = await Promise.all([goplus(address), tokenDecimals(address)]);
    const stub = { address, poolAddress, createdAt } as Market;
    const r = await insiderReport(address, gp ?? null, stub, [stub], decimals);
    return r.risk;
  },
  ["insider-risk-v1"],
  { revalidate: 3600 },
);

async function whaleSignal(m: Market): Promise<HeatSignal | null> {
  try {
    // No safety-scanner dependency here: the feed already knows the pool, and the $ threshold needs only price.
    const decimals = await tokenDecimals(m.address);
    const tx = await recentTransfers(m.address, decimals);
    const cutoff = Date.now() - WINDOW_H * 3.6e6;
    const moves = whaleMoves(tx.list, null, m, 0, [m.poolAddress])
      .filter((x) => !x.ts || new Date(x.ts).getTime() >= cutoff);
    return {
      whaleBuyUsd: moves.filter((x) => x.side === "buy").reduce((s, x) => s + x.usd, 0),
      whaleSellUsd: moves.filter((x) => x.side === "sell").reduce((s, x) => s + x.usd, 0),
      hours: Math.min(WINDOW_H, tx.hours),
    };
  } catch {
    return null;
  }
}

/** Background snapshot: whale flow for every feed token + insider risk for the 12 hottest. */
const heatSignalsCached = unstable_cache(
  async (): Promise<Record<string, HeatSignal>> => {
    const t0 = Date.now();
    const feed = await marketFeed();
    const sigs = await pool(feed, 4, whaleSignal);
    console.log(`[heat] whale signals ${sigs.filter(Boolean).length}/${feed.length} in ${Date.now() - t0}ms`);
    const out: Record<string, HeatSignal> = {};
    feed.forEach((m, i) => { if (sigs[i]) out[m.address] = sigs[i]!; });

    const prelim = feed
      .map((m) => ({ m, h: computeHeat({ ...m, trending: m.feeds.includes("trending") }, undefined, out[m.address]).score }))
      .sort((a, b) => b.h - a.h)
      .slice(0, 12);
    const risks = await pool(prelim, 2, ({ m }) => insiderRiskCached(m.address, m.poolAddress, m.createdAt).catch(() => undefined));
    prelim.forEach(({ m }, i) => {
      if (risks[i] && out[m.address]) out[m.address].insiderRisk = risks[i];
    });
    console.log(`[heat] snapshot ready in ${Date.now() - t0}ms`);
    return out;
  },
  ["heat-signals-v1"],
  { revalidate: 600 },
);

let inflight: Promise<Record<string, HeatSignal>> | null = null;
export function getHeatSignals() {
  if (!inflight) inflight = heatSignalsCached().finally(() => { inflight = null; });
  return inflight;
}
