import { NextResponse } from "next/server";
import { goplusMany, marketFeed } from "@/lib/sources";
import { safety, whaleShare } from "@/lib/score";

export const dynamic = "force-dynamic";

export type CardSafety = {
  pending: boolean; // true = scanner was busy, ask again shortly
  score: number | null; tier: string; flags: string[];
  holders: number | null; whales: { top10: number; biggest: number } | null;
  devPct: number | null; // % of supply still in the creator wallet
};

export async function GET(req: Request) {
  const list = (new URL(req.url).searchParams.get("a") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^0x[0-9a-f]{40}$/.test(s)).slice(0, 8);
  const [gp, markets] = await Promise.all([goplusMany(list), marketFeed().catch(() => [])]);
  const byAddr = new Map(markets.map((m) => [m.address, m]));
  const out: Record<string, CardSafety> = {};
  for (const a of list) {
    const g = gp.get(a);
    const m = byAddr.get(a) ?? null;
    const s = safety(g ?? null, m);
    out[a] = {
      pending: g === undefined,
      score: s.score, tier: s.tier,
      flags: s.checks.filter((c) => c.level !== "good").slice(0, 2).map((c) => c.title),
      holders: g?.holder_count ? Number(g.holder_count) : null,
      whales: g ? whaleShare(g, m) : null,
      devPct: g ? (Number(g.creator_percent) || 0) * 100 : null,
    };
  }
  return NextResponse.json(out);
}
