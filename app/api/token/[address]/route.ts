import { NextResponse } from "next/server";
import { goplus, tokenMarket, ohlcv } from "@/lib/sources";
import { safety, sentiment, liquidityGrade, whaleShare, holders } from "@/lib/score";

// Fast core: market + contract scan. Whale flow and insiders load separately so this returns in ~1s.
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address: raw } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return NextResponse.json({ error: "That's not a valid token address" }, { status: 400 });
  const address = raw.toLowerCase();

  const [gp, mk] = await Promise.all([goplus(address), tokenMarket(address)]);
  const market = mk.best;
  const chart = market ? await ohlcv(market.poolAddress) : [];
  if (!market && !gp) return NextResponse.json({ error: "No token found at that address on Robinhood Chain" }, { status: 404 });

  return NextResponse.json({
    address,
    symbol: market?.symbol ?? gp?.token_symbol ?? "???",
    name: market?.name ?? gp?.token_name ?? "Unknown token",
    image: market?.image ?? null,
    market,
    pools: mk.pools.map((p) => ({ poolAddress: p.poolAddress, name: p.poolName, dex: p.dex, liquidityUsd: p.liquidityUsd, vol24: p.vol.h24 })),
    chart,
    holderCount: gp?.holder_count ? Number(gp.holder_count) : null,
    safety: safety(gp ?? null, market),
    sentiment: sentiment(market),
    liquidity: { grade: liquidityGrade(market?.liquidityUsd ?? 0), usd: market?.liquidityUsd ?? 0 },
    whales: gp ? { ...whaleShare(gp, market), holders: holders(gp, market).slice(0, 12) } : null,
  });
}
