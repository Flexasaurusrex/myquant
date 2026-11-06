"use client";
import Link from "next/link";
import type { CardMarket } from "@/app/api/tokens/route";
import type { CardSafety } from "@/app/api/safety/route";
import type { Heat } from "@/lib/heat";
import { age, hueFor, pctStr, price, usd, TIER_COPY, VIBE_EMOJI } from "@/lib/format";

export function Avatar({ src, symbol, size }: { src: string | null; symbol: string; size?: number }) {
  const style = size ? { width: size, height: size } : undefined;
  if (src) return <img className="avatar" src={src} alt="" style={style} loading="lazy" />;
  return (
    <span className="avatar" style={{ ...style, background: hueFor(symbol) }} aria-hidden>
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function TokenCard({ t, s, heat }: { t: CardMarket; s?: CardSafety; heat?: Heat }) {
  const tier = !s || s.pending ? "scanning" : s.tier;
  const copy = TIER_COPY[tier];
  const whale = s?.whales?.top10 ?? null;
  const isNew = Date.now() - new Date(t.createdAt).getTime() < 3 * 86_400_000;

  return (
    <Link href={`/token/${t.address}`} className="card" aria-label={`${t.symbol}: ${copy.label}`}>
      <div className="c-head">
        <Avatar src={t.image} symbol={t.symbol} />
        <div className="c-id">
          <div className="c-sym">{t.symbol}</div>
          <div className="c-name">{t.name} · {age(t.createdAt)}</div>
        </div>
        <div className="c-price">
          <div className="mono">{price(t.priceUsd)}</div>
          <span className={`chg ${t.change24 >= 0 ? "up" : "down"}`}>{pctStr(t.change24)}</span>
        </div>
      </div>

      <div className="badges" style={{ marginBottom: 10 }}>
        {heat && (
          <span className={`heat h${heat.flames}`} title={heat.reasons.join(" · ") || "Not much happening right now"}>
            {"🔥".repeat(heat.flames)} <b>{heat.score}</b>
          </span>
        )}
        {t.feeds.includes("trending") && <span className="badge hot">Trending</span>}
        {isNew && <span className="badge new">New</span>}
      </div>
      {heat && heat.reasons[0] && <div className="heat-why">{heat.reasons[0]}</div>}

      <div className={`verdict t-${tier}`}>
        <div>
          <div className="v-label">{copy.label}</div>
          <div className="v-sub">{copy.sub}</div>
        </div>
        <div className="ring" style={{ ["--p" as string]: s?.score ?? 0 }}>
          <b>{s?.score ?? "?"}</b>
        </div>
      </div>

      <div className="meters">
        <div className="meter" title="Share of unique buyers vs sellers over the last 6h and 24h">
          <span>Vibe</span>
          <div className="bar"><i style={{ width: `${t.sentiment.buyShare}%` }} /></div>
          <span className="val">{VIBE_EMOJI[t.sentiment.label]} {t.sentiment.label}</span>
        </div>
        <div className="meter" title="How much money sits in the main trading pool">
          <span>Liquidity</span>
          <div className="mono" style={{ fontWeight: 700 }}>{usd(t.liquidityUsd)} <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>· vol {usd(t.vol24)}</span></div>
          <span className={`grade g-${t.liquidity.grade}`}>{t.liquidity.grade}</span>
        </div>
        <div className="meter" title="Share of supply held by the top 10 wallets (pools and burns excluded)">
          <span>Whales</span>
          <div className="bar whale"><i style={{ width: `${Math.min(100, whale ?? 0)}%` }} /></div>
          <span className="val">{whale == null ? "…" : `🐋 ${whale.toFixed(0)}%`}</span>
        </div>
        <div className="meter" title="Share of supply still sitting in the wallet that created the token">
          <span>Dev wallet</span>
          <div className="bar whale"><i style={{ width: `${Math.min(100, s?.devPct ?? 0)}%`, background: "var(--pop)" }} /></div>
          <span className="val">{s?.devPct == null ? "…" : s.devPct < 0.01 ? "🧑‍💻 0%" : `🧑‍💻 ${s.devPct.toFixed(1)}%`}</span>
        </div>
      </div>

      <div className="flags">
        {s && !s.pending && s.flags.length === 0 && s.tier !== "unchecked" && <span className="flag good">✓ All checks passed</span>}
        {s?.flags.map((f) => <span key={f} className="flag">⚠ {f}</span>)}
        {s?.holders ? <span className="flag">{s.holders.toLocaleString()} holders</span> : null}
      </div>
    </Link>
  );
}
