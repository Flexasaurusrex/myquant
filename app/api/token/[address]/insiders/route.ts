import { NextResponse } from "next/server";
import { goplus, tokenMarket, tokenDecimals } from "@/lib/sources";
import { insiderReport } from "@/lib/insiders";

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address: raw } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return NextResponse.json({ error: "Not a token address" }, { status: 400 });
  const address = raw.toLowerCase();
  const [gp, mk, decimals] = await Promise.all([goplus(address), tokenMarket(address), tokenDecimals(address)]);
  try {
    return NextResponse.json(await insiderReport(address, gp, mk.best, mk.pools, decimals));
  } catch (e) {
    return NextResponse.json({ error: "Insider scan unavailable right now" }, { status: 503 });
  }
}
