"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "./TokenCard";
import Scanning, { PanelLoading } from "./Scanning";
import { ago, age, pctStr, price, short, usd, TIER_COPY, VIBE_EMOJI } from "@/lib/format";
import type { InsiderReport, InsiderWallet } from "@/lib/insiders";
import { EXPLORER } from "@/lib/chain";

type Detail = any; // shape of /api/token/[address]

const VERDICT_LINE: Record<string, string> = {
  safe: "No major red flags in the contract. Still do your own homework.",
  caution: "Some settings give the team power over your tokens. Read the flags below before buying.",
  danger: "Serious red flags. Most people should stay away.",
  unchecked: "The scanner has no data on this contract yet. Treat it as unknown.",
};

const ROLE: Record<InsiderWallet["role"], { label: string; color: string }> = {
  sniper: { label: "Sniper", color: "var(--danger)" },
  early: { label: "Early buyer", color: "var(--caution)" },
  allocation: { label: "Team handout", color: "var(--pink)" },
  "fresh-whale": { label: "Fresh wallet", color: "var(--sky)" },
  contract: { label: "Contract", color: "var(--unchecked)" },
  creator: { label: "Creator", color: "var(--pop)" },
  owner: { label: "Owner", color: "var(--pop)" },
};

function Sparkline({ points, up }: { points: [number, number][]; up: boolean }) {
  if (points.length < 2) return null;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const X = (x: number) => ((x - x0) / (x1 - x0 || 1)) * 600;
  const Y = (y: number) => 110 - ((y - y0) / (y1 - y0 || 1)) * 100;
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const color = up ? "var(--bull)" : "var(--bear)";
  return (
    <svg className="spark" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="48 hour price chart">
      <path d={`${d} L600,120 L0,120 Z`} fill={color} opacity="0.15" />
      <path d={d} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function InsiderPanel({ address }: { address: string }) {
  const [r, setR] = useState<InsiderReport | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/token/${address}/insiders`).then((x) => (x.ok ? x.json() : Promise.reject())).then((j) => alive && setR(j)).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [address]);

  const riskTier = { low: "safe", medium: "caution", high: "danger", unknown: "unchecked" } as const;
  return (
    <section className="panel wide">
      <h2>🕵️ Insiders</h2>
      <p className="hint">Who got in first, who got tokens for free, and whether they&apos;re still holding. Rebuilt from on-chain transfers in the token&apos;s first 10 minutes.</p>
      {!r && !err && <PanelLoading label="Tracing launch wallets… this takes a few seconds" />}
      {err && <p className="hint">Insider scan is busy right now. Refresh in a minute.</p>}
      {r && (
        <>
          <div className={`big-verdict t-${riskTier[r.risk]}`} style={{ marginBottom: 14 }}>
            <div>
              <h3>Insider risk: {r.risk}</h3>
              <p>{r.riskReasons.length ? r.riskReasons.join(" · ") : "No insider warning signs found."}</p>
              {r.launchedAt && <p style={{ fontSize: 13, opacity: 0.8 }}>Launched {new Date(r.launchedAt).toLocaleString()} ({age(r.launchedAt)})</p>}
            </div>
          </div>
          <div className="stats" style={{ margin: "0 0 14px" }}>
            <div className="stat"><b className="mono">{r.creator.pct.toFixed(1)}%</b><small>Dev holds</small></div>
            <div className="stat"><b className="mono">{r.snipers.count}</b><small>Snipers · hold {r.snipers.holdingPct.toFixed(1)}%</small></div>
            <div className="stat"><b className="mono">{r.early.soldCount}/{r.early.count}</b><small>Early buyers sold</small></div>
            <div className="stat"><b className="mono">{r.freshWhales.count}</b><small>Fresh whale wallets</small></div>
          </div>
          {r.bundle.wallets >= 3 && <p className="flag" style={{ display: "inline-block", marginBottom: 12 }}>⚠ Bundled launch: {r.bundle.wallets} wallets bought in the first block ({r.bundle.pct.toFixed(1)}%)</p>}
          {r.wallets.length > 0 && (
            <div className="moves">
              {r.wallets.slice(0, 25).map((w) => (
                <a key={w.address} className="move" href={`${EXPLORER}/address/${w.address}`} target="_blank" rel="noreferrer" style={{ gridTemplateColumns: "96px minmax(0,1fr) auto" }}>
                  <span className="side" style={{ background: ROLE[w.role].color, color: "#15111f" }}>{ROLE[w.role].label}</span>
                  <span className="who mono">
                    {short(w.address)}
                    {w.secondsAfterLaunch != null && ` · ${w.secondsAfterLaunch}s in`}
                    {w.txCount != null && ` · ${w.txCount} txs`}
                  </span>
                  <span className="amt mono">
                    {w.holdingPct.toFixed(2)}%
                    <small>{w.boughtPct ? `got ${w.boughtPct.toFixed(2)}% · ${w.status}` : "of supply"}</small>
                  </span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function WhaleFlowPanel({ address }: { address: string }) {
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState(false);
  const [showMoves, setShowMoves] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/token/${address}/whales`).then((x) => (x.ok ? x.json() : Promise.reject())).then((j) => alive && setF(j)).catch(() => alive && setErr(true));
    load();
    const id = setInterval(load, 90_000);
    return () => { alive = false; clearInterval(id); };
  }, [address]);
  const moves = ((f?.moves ?? []) as any[]).filter((x) => showMoves || x.side !== "move");
  const flowTotal = f ? f.buyUsd + f.sellUsd : 0;
  return (
    <section className="panel">
      <h2>🌊 Whale flow</h2>
      <p className="hint">
        Big trades (≥ $2.5K or ≥ 0.25% of supply){f ? ` in the last ${f.hours || "few"}h` : ""}. Bots that flip back and forth are filtered out.
      </p>
      {!f && !err && <PanelLoading label="Following the whales…" />}
      {err && !f && <p className="hint">Whale feed is busy right now. It&apos;ll retry shortly.</p>}
      {f && (
        <>
          <div className="flow">
            <div className="in"><small>Whales bought</small><b className="mono">{usd(f.buyUsd)}</b></div>
            <div className="out"><small>Whales sold</small><b className="mono">{usd(f.sellUsd)}</b></div>
          </div>
          {flowTotal > 0 && (
            <div className="bar" style={{ height: 14, marginBottom: 14 }}><i style={{ width: `${(f.buyUsd / flowTotal) * 100}%` }} /></div>
          )}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            <input type="checkbox" checked={showMoves} onChange={(e) => setShowMoves(e.target.checked)} /> Show wallet-to-wallet transfers
          </label>
          <div className="moves">
            {moves.length === 0 && <p className="hint">No whale-sized trades in this window.</p>}
            {moves.map((x: any) => (
              <a key={x.hash + x.wallet} className="move" href={`${EXPLORER}/tx/${x.hash}`} target="_blank" rel="noreferrer">
                <span className={`side ${x.side}`}>{x.side === "move" ? "xfer" : x.side}</span>
                <span className="who mono">{short(x.wallet)} · {ago(x.ts)}</span>
                <span className="amt mono">{usd(x.usd)}<small>{x.pctSupply < 0.01 ? "<0.01" : x.pctSupply.toFixed(2)}% supply</small></span>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function TokenDetail({ address }: { address: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/token/${address}`).then((r) => r.json()).then((j) => {
        if (!alive) return;
        if (j.error) setErr(j.error); else setD(j);
      }).catch(() => alive && setErr("Couldn't load this token."));
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [address]);

  if (err) return (<><Link href="/" className="back">← All tokens</Link><div className="empty">{err}</div></>);
  if (!d) return (<><Link href="/" className="back">← All tokens</Link><Scanning address={address} steps={["Reading the contract…", "Checking for honeypots and hidden taxes…", "Measuring liquidity…", "Counting buyers and sellers…", "Mapping the top holders…"]} /></>);

  const m = d.market;
  const tier = d.safety.tier as string;
  const tf = m ? (["h1", "h6", "h24"] as const).map((k) => ({ k, ...m.tx[k] })) : [];

  return (
    <>
      <Link href="/" className="back">← All tokens</Link>

      <div className="d-hero">
        <Avatar src={d.image} symbol={d.symbol} />
        <div style={{ minWidth: 0 }}>
          <h1>{d.symbol}</h1>
          <div className="sub">{d.name} · <span className="mono">{short(address)}</span>{m && ` · ${age(m.createdAt)}`}{d.holderCount && ` · ${d.holderCount.toLocaleString()} holders`}</div>
        </div>
        {m && (
          <div className="d-price">
            <div className="mono">{price(m.priceUsd)}</div>
            <span className={`chg ${m.change.h24 >= 0 ? "up" : "down"}`}>{pctStr(m.change.h24)} 24h</span>{" "}
            <span style={{ color: "var(--ink-3)", fontSize: 13, fontWeight: 600 }}>FDV {usd(m.fdvUsd)}</span>
          </div>
        )}
      </div>

      <div className="trade">
        <a className="btn primary" href={`https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${address}`} target="_blank" rel="noreferrer">⚡ Trade on Uniswap</a>
        {m && <a className="btn" href={`https://www.geckoterminal.com/robinhood/pools/${m.poolAddress}`} target="_blank" rel="noreferrer">📊 Chart</a>}
        <a className="btn" href={`https://dexscreener.com/robinhood/${address}`} target="_blank" rel="noreferrer">🦅 DexScreener</a>
        <a className="btn" href={`${EXPLORER}/token/${address}`} target="_blank" rel="noreferrer">🔍 Explorer</a>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(address)}>📋 Copy address</button>
      </div>

      <div className="panels">
        <section className="panel wide">
          <div className={`big-verdict t-${tier}`}>
            <div className="ring" style={{ ["--p" as string]: d.safety.score ?? 0 }}><b>{d.safety.score ?? "?"}</b></div>
            <div>
              <h3>{TIER_COPY[tier].label}</h3>
              <p>{VERDICT_LINE[tier]}</p>
            </div>
          </div>
          <div className="checks">
            {d.safety.checks.map((c: any) => (
              <div key={c.id} className={`check ${c.level}`}>
                <span className="ic" aria-hidden>{c.level === "good" ? "✓" : c.level === "warn" ? "!" : "✕"}</span>
                <div style={{ minWidth: 0 }}><b>{c.title}</b><small>{c.detail}</small></div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>{VIBE_EMOJI[d.sentiment.label]} Vibe: {d.sentiment.label}</h2>
          <p className="hint">Green = unique buyers, red = unique sellers.</p>
          <div className="tf">
            {tf.map((r) => {
              const tot = r.buyers + r.sellers;
              return (
                <div key={r.k} className="tf-row">
                  <span>{r.k.replace("h", "")}h</span>
                  <div className="bar"><i style={{ width: `${tot ? (r.buyers / tot) * 100 : 50}%` }} /></div>
                  <span className="r mono">{r.buyers}↑ {r.sellers}↓</span>
                </div>
              );
            })}
          </div>
          {m && <Sparkline points={d.chart} up={m.change.h24 >= 0} />}
          {m && <p className="hint" style={{ margin: "6px 0 0" }}>48h price · 1h {pctStr(m.change.h1)} · 6h {pctStr(m.change.h6)}</p>}
        </section>

        <section className="panel">
          <h2>💧 Liquidity <span className={`grade g-${d.liquidity.grade}`}>{d.liquidity.grade}</span></h2>
          <p className="hint">Money sitting in pools. More liquidity = you can buy and sell without moving the price.</p>
          <div className="flow">
            <div><small>Main pool</small><b className="mono">{usd(d.liquidity.usd)}</b></div>
            <div><small>24h volume</small><b className="mono">{usd(m?.vol.h24 ?? 0)}</b></div>
          </div>
          <div className="pools">
            {d.pools.slice(0, 6).map((p: any) => (
              <a key={p.poolAddress} className="pool" href={`https://www.geckoterminal.com/robinhood/pools/${p.poolAddress}`} target="_blank" rel="noreferrer">
                <span>{p.name}</span><span className="mono">{usd(p.liquidityUsd)}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>🐋 Who holds it</h2>
          <p className="hint">Top wallets by share of supply. Pink = real wallets, blue = pools, green = burned or locked.</p>
          <div className="legend">
            <span><i className="k-whale" />Wallet</span><span><i className="k-pool" />Pool</span><span><i className="k-burn" />Burned / locked</span>
          </div>
          {d.whales ? (
            <div className="holders">
              {d.whales.holders.map((h: any) => (
                <a key={h.address} className="h-row" href={`${EXPLORER}/address/${h.address}`} target="_blank" rel="noreferrer">
                  <div className="h-bar">
                    <i className={`k-${h.kind}`} style={{ width: `${Math.max(2, Math.min(100, h.percent))}%` }} />
                    <span className="mono">{h.tag || short(h.address)}{h.isContract && h.kind === "whale" ? " · contract" : ""}</span>
                  </div>
                  <span className="mono" style={{ textAlign: "right", fontWeight: 800 }}>{h.percent.toFixed(2)}%</span>
                </a>
              ))}
            </div>
          ) : <p className="hint">No holder data yet.</p>}
        </section>

        <WhaleFlowPanel address={address} />

        <InsiderPanel address={address} />
      </div>

      <p className="foot">Not financial advice. Automated checks can miss things. Always check the contract yourself before putting in money you can&apos;t afford to lose.</p>
    </>
  );
}
