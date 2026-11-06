import { NextResponse } from "next/server";
import { goplusMany, marketFeed } from "@/lib/sources";
import { toCardSafety, type CardSafety } from "@/lib/cardSafety";

export const dynamic = "force-dynamic";
export type { CardSafety };

export async function GET(req: Request) {
  const list = (new URL(req.url).searchParams.get("a") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^0x[0-9a-f]{40}$/.test(s)).slice(0, 8);
  const [gp, markets] = await Promise.all([goplusMany(list, 4), marketFeed().catch(() => [])]);
  const byAddr = new Map(markets.map((m) => [m.address, m]));
  const out: Record<string, CardSafety> = {};
  for (const a of list) out[a] = toCardSafety(gp.get(a), byAddr.get(a) ?? null);
  return NextResponse.json(out);
}
