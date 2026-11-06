import { NextResponse, after } from "next/server";
import { marketFeed } from "@/lib/sources";
import { sentiment, liquidityGrade } from "@/lib/score";
import { getSafetySnapshot, type CardSafety } from "@/lib/cardSafety";
import { getHeatSignals } from "@/lib/heatSignals";
import type { HeatSignal } from "@/lib/heat";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // lets a cold snapshot build finish in the background

export type CardMarket = {
  address: string; symbol: string; name: string; image: string | null;
  priceUsd: number; change24: number; change1: number; vol24: number; liquidityUsd: number; fdvUsd: number;
  createdAt: string; feeds: string[]; poolAddress: string;
  sentiment: { score: number; label: string; buyShare: number };
  liquidity: { grade: string };
  vol: { h1: number; h24: number };
  tx: { h1: { buyers: number; sellers: number; buys: number; sells: number }; h6: { buyers: number; sellers: number } };
};

const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export async function GET() {
  const snap = getSafetySnapshot();
  const heat = getHeatSignals();
  // Cached snapshots return instantly; only a cold start would wait, so cap it and keep building after responding.
  const [markets, safety, signals] = await Promise.all([marketFeed(), within(snap, 2500), within(heat, 2500)]);
  if (!safety) after(() => snap.then(() => undefined).catch(() => undefined));
  if (!signals) after(() => heat.then(() => undefined).catch(() => undefined));

  const tokens: CardMarket[] = markets.map((m) => ({
    address: m.address, symbol: m.symbol, name: m.name, image: m.image,
    priceUsd: m.priceUsd, change24: m.change.h24, change1: m.change.h1, vol24: m.vol.h24,
    liquidityUsd: m.liquidityUsd, fdvUsd: m.fdvUsd, createdAt: m.createdAt, feeds: m.feeds, poolAddress: m.poolAddress,
    sentiment: sentiment(m),
    liquidity: { grade: liquidityGrade(m.liquidityUsd) },
    vol: { h1: m.vol.h1, h24: m.vol.h24 },
    tx: { h1: m.tx.h1, h6: { buyers: m.tx.h6.buyers, sellers: m.tx.h6.sellers } },
  }));
  return NextResponse.json(
    { tokens, safety: (safety ?? {}) as Record<string, CardSafety>, heat: (signals ?? {}) as Record<string, HeatSignal>, updatedAt: new Date().toISOString() },
    { headers: { "cache-control": "s-maxage=30, stale-while-revalidate=120" } },
  );
}
