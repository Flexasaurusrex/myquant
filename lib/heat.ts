// Pure scoring: runs on the server (to pick insider-scan candidates) and in the browser (live re-ranking).

export type HeatSignal = {
  whaleBuyUsd: number;
  whaleSellUsd: number;
  hours: number; // window the whale numbers cover
  insiderRisk?: "low" | "medium" | "high" | "unknown";
};

export type HeatInput = {
  vol: { h1: number; h24: number };
  liquidityUsd: number;
  tx: { h1: { buyers: number; sellers: number; buys: number; sells: number }; h6: { buyers: number; sellers: number } };
  trending: boolean;
  createdAt: string;
};

export type Heat = { score: number; flames: number; reasons: string[]; hidden: boolean };

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const k = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`);

export function computeHeat(m: HeatInput, tier: string | undefined, sig: HeatSignal | undefined): Heat {
  const reasons: { w: number; text: string }[] = [];

  // Momentum: last hour's volume vs. its average hour. Young tokens average over their real age,
  // otherwise a 14-minute-old token reads as "24x normal".
  const ageH = (Date.now() - new Date(m.createdAt).getTime()) / 3.6e6;
  const hours = Math.max(1, Math.min(24, isFinite(ageH) ? ageH : 24));
  const avgHour = m.vol.h24 / hours;
  const ratio = avgHour > 0 ? m.vol.h1 / avgHour : 0;
  if (ageH < 2) reasons.push({ w: 0.15, text: `Launched ${ageH < 1 ? `${Math.max(1, Math.round(ageH * 60))}m` : `${ageH.toFixed(1)}h`} ago` });
  const mom = clamp((ratio - 0.5) / 2.5);
  if (ratio >= 1.5 && m.vol.h1 > 1000) reasons.push({ w: mom, text: `Volume ${ratio.toFixed(1)}× normal this hour` });

  // New money: unique buyers vs sellers, weighted to the last hour.
  const share = (b: number, s: number) => (b + s ? b / (b + s) : 0.5);
  const b1 = share(m.tx.h1.buyers, m.tx.h1.sellers);
  const b6 = share(m.tx.h6.buyers, m.tx.h6.sellers);
  let money = clamp((0.6 * b1 + 0.4 * b6 - 0.4) / 0.3);
  if (m.tx.h1.buys + m.tx.h1.sells < 5) money *= 0.5; // a handful of trades isn't a crowd
  if (b1 >= 0.6 && m.tx.h1.buyers >= 5) reasons.push({ w: money, text: `${Math.round(b1 * 100)}% buyers in the last hour` });

  // Whale direction: net whale dollars, scaled to the pool so small tokens aren't drowned out.
  let whale = 0.5;
  if (sig && sig.whaleBuyUsd + sig.whaleSellUsd > 0) {
    const net = sig.whaleBuyUsd - sig.whaleSellUsd;
    whale = 0.5 + 0.5 * Math.tanh(net / Math.max(10_000, m.liquidityUsd * 0.05));
    if (net > 2_500) reasons.push({ w: whale, text: `Whales net bought ${k(net)}` });
    if (net < -2_500) reasons.push({ w: 0.2, text: `Whales net sold ${k(-net)}` });
  }

  // Size: real activity matters ($1K/day = 0, $1M/day = full marks).
  const size = clamp((Math.log10(m.vol.h24 + 1) - 3) / 3);

  let score = 100 * (0.3 * mom + 0.25 * money + 0.2 * whale + 0.17 * size + (m.trending ? 0.08 : 0));
  if (m.trending) reasons.push({ w: 0.1, text: "Trending on GeckoTerminal" });

  // Thin pools: easy to pump, hard to exit.
  if (m.liquidityUsd < 10_000) score *= 0.7;
  else if (m.liquidityUsd < 25_000) score *= 0.85;

  // Safety gates.
  if (tier === "danger") score *= 0.3;
  else if (tier === "caution") score *= 0.85;
  else if (tier === "unchecked" || tier === undefined) score *= 0.9;
  if (sig?.insiderRisk === "high") { score *= 0.6; reasons.push({ w: 0.3, text: "High insider risk" }); }
  else if (sig?.insiderRisk === "medium") score *= 0.85;

  score = Math.round(clamp(score, 0, 100));
  return {
    score,
    flames: Math.max(1, Math.min(5, Math.ceil(score / 20))),
    reasons: reasons.sort((a, b) => b.w - a.w).map((r) => r.text).slice(0, 3),
    hidden: tier === "danger",
  };
}
