import { NextResponse } from "next/server";
import { goplus, tokenMarket, recentTransfers, tokenDecimals } from "@/lib/sources";
import { whaleMoves } from "@/lib/score";

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address: raw } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return NextResponse.json({ error: "Not a token address" }, { status: 400 });
  const address = raw.toLowerCase();
  const [gp, mk, decimals] = await Promise.all([goplus(address), tokenMarket(address), tokenDecimals(address)]);
  const tx = await recentTransfers(address, decimals).catch(() => ({ list: [], source: "unavailable", hours: 0 }));
  const moves = whaleMoves(tx.list, gp, mk.best, Number(gp?.total_supply) || 0, mk.pools.map((p) => p.poolAddress));
  return NextResponse.json({
    buyUsd: moves.filter((m) => m.side === "buy").reduce((s, m) => s + m.usd, 0),
    sellUsd: moves.filter((m) => m.side === "sell").reduce((s, m) => s + m.usd, 0),
    moves, source: tx.source, hours: tx.hours,
  });
}
