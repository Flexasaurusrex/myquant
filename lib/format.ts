export const usd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

export function price(p: number) {
  if (!p) return "$0";
  if (p >= 1) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  // $0.0₅123 style for tiny prices
  const s = p.toFixed(20);
  const zeros = s.slice(2).match(/^0*/)![0].length;
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[+d]).join("");
  return `$0.0${sub}${s.slice(2 + zeros, 2 + zeros + 3)}`;
}

export const pctStr = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;

export function age(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  if (!isFinite(h)) return "";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m old`;
  if (h < 48) return `${Math.round(h)}h old`;
  if (h < 24 * 60) return `${Math.round(h / 24)}d old`;
  return `${Math.round(h / 24 / 30)}mo old`;
}

export function ago(iso?: string) {
  if (!iso) return "";
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 60 * 48) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const HUES = ["#7b5cff", "#ff7ad9", "#3db8ff", "#2ee59d", "#ffb020", "#ff5c6c"];
export const hueFor = (s: string) => HUES[[...s].reduce((h, c) => h + c.charCodeAt(0), 0) % HUES.length];

export const TIER_COPY: Record<string, { label: string; sub: string }> = {
  safe: { label: "Looks safe", sub: "No major red flags" },
  caution: { label: "Be careful", sub: "Some risky settings" },
  danger: { label: "Danger", sub: "Serious red flags" },
  unchecked: { label: "Not scanned", sub: "No security data yet" },
  scanning: { label: "Scanning…", sub: "Checking the contract" },
};

export const VIBE_EMOJI: Record<string, string> = {
  Bullish: "🔥", Warming: "📈", Neutral: "😐", Cooling: "📉", Bearish: "🧊", Quiet: "💤",
};
