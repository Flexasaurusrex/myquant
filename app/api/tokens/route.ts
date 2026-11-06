import { NextResponse } from "next/server";
import { marketFeed } from "@/lib/sources";
import { sentiment, liquidityGrade } from "@/lib/score";

export const dynamic = "force-dynamic";

export type CardMarket = {
  address: string; symbol: string; name: string; image: string | null;
  priceUsd: number; change24: number; change1: number; vol24: number; liquidityUsd: number; fdvUsd: number;
  createdAt: string; feeds: string[]; poolAddress: string;
  sentiment: { score: number; label: string; buyShare: number };
  liquidity: { grade: string };
};

export async function GET() {
  const markets = await marketFeed();
  const tokens: CardMarket[] = markets.map((m) => ({
    address: m.address, symbol: m.symbol, name: m.name, image: m.image,
    priceUsd: m.priceUsd, change24: m.change.h24, change1: m.change.h1, vol24: m.vol.h24,
    liquidityUsd: m.liquidityUsd, fdvUsd: m.fdvUsd, createdAt: m.createdAt, feeds: m.feeds, poolAddress: m.poolAddress,
    sentiment: sentiment(m),
    liquidity: { grade: liquidityGrade(m.liquidityUsd) },
  }));
  return NextResponse.json({ tokens, updatedAt: new Date().toISOString() }, { headers: { "cache-control": "s-maxage=60, stale-while-revalidate=120" } });
}
