import "server-only";
import { unstable_cache } from "next/cache";
import { goplusMany, marketFeed, type GoPlus, type Market } from "./sources";
import { safety, whaleShare } from "./score";

export type CardSafety = {
  pending: boolean; // true = scanner was busy, ask again shortly
  score: number | null; tier: string; flags: string[];
  holders: number | null; whales: { top10: number; biggest: number } | null;
  devPct: number | null; // % of supply still in the creator wallet
};

export function toCardSafety(g: GoPlus | undefined, m: Market | null): CardSafety {
  const s = safety(g ?? null, m);
  return {
    pending: g === undefined,
    score: s.score, tier: s.tier,
    flags: s.checks.filter((c) => c.level !== "good").slice(0, 2).map((c) => c.title),
    holders: g?.holder_count ? Number(g.holder_count) : null,
    whales: g ? whaleShare(g, m) : null,
    devPct: g ? (Number(g.creator_percent) || 0) * 100 : null,
  };
}

/**
 * One shared safety snapshot for the whole feed, kept in Vercel's Data Cache.
 * When it goes stale, visitors still get the last copy instantly while it rebuilds in the background.
 * Individual GoPlus answers are cached for an hour, so rebuilds only re-scan new tokens.
 */
export const safetySnapshot = unstable_cache(
  async (): Promise<Record<string, CardSafety>> => {
    const feed = await marketFeed();
    const gp = await goplusMany(feed.map((m) => m.address), 4);
    const out: Record<string, CardSafety> = {};
    for (const m of feed) {
      const g = gp.get(m.address);
      if (g !== undefined) out[m.address] = toCardSafety(g, m); // only store real answers
    }
    return out;
  },
  ["safety-snapshot-v1"],
  { revalidate: 600 },
);

// One build at a time per instance; concurrent cold requests share it instead of stampeding GoPlus.
let inflight: Promise<Record<string, CardSafety>> | null = null;
export function getSafetySnapshot() {
  if (!inflight) inflight = safetySnapshot().finally(() => { inflight = null; });
  return inflight;
}
