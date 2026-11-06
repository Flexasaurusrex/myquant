import { NextResponse } from "next/server";
import { goplus, tokenMarket, recentTransfers, tokenDecimals, ohlcv } from "@/lib/sources";
import { safety, sentiment, liquidityGrade, whaleShare, holders, whaleMoves } from "@/lib/score";

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address: raw } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return NextResponse.json({ error: "Not a token address" }, { status: 400 });
  const address = raw.toLowerCase();

  const [gp, mk, decimals] = await Promise.all([goplus(address), tokenMarket(address), tokenDecimals(address)]);
  const market = mk.best;
  const totalSupply = Number(gp?.total_supply) || 0;

  const [tx, chart] = await Promise.all([
    recentTransfers(address, decimals).catch(() => ({ list: [], source: "unavailable", hours: 0 })),
    market ? ohlcv(market.poolAddress) : Promise.resolve([]),
  ]);
  const moves = whaleMoves(tx.list, gp, market, totalSupply, mk.pools.map((p) => p.poolAddress));
  const buyUsd = moves.filter((m) => m.side === "buy").reduce((s, m) => s + m.usd, 0);
  const sellUsd = moves.filter((m) => m.side === "sell").reduce((s, m) => s + m.usd, 0);

  return NextResponse.json({
    address,
    symbol: market?.symbol ?? gp?.token_symbol ?? "???",
    name: market?.name ?? gp?.token_name ?? "Unknown token",
    image: market?.image ?? null,
    market,
    pools: mk.pools.map((p) => ({ poolAddress: p.poolAddress, name: p.poolName, dex: p.dex, liquidityUsd: p.liquidityUsd, vol24: p.vol.h24 })),
    chart,
    holderCount: gp?.holder_count ? Number(gp.holder_count) : null,
    safety: safety(gp, market),
    sentiment: sentiment(market),
    liquidity: { grade: liquidityGrade(market?.liquidityUsd ?? 0), usd: market?.liquidityUsd ?? 0 },
    whales: gp ? { ...whaleShare(gp, market), holders: holders(gp, market).slice(0, 12) } : null,
    whaleFlow: { buyUsd, sellUsd, moves, source: tx.source, hours: tx.hours },
  });
}
