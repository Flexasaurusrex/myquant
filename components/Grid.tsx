"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Spinner } from "./Scanning";
import { useRouter } from "next/navigation";
import type { CardMarket } from "@/app/api/tokens/route";
import type { CardSafety } from "@/app/api/safety/route";
import TokenCard from "./TokenCard";
import { usd } from "@/lib/format";

type Tab = "trending" | "top" | "new" | "all";
type Sort = "default" | "safety" | "volume" | "gainers" | "vibe" | "liquidity";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Grid() {
  const router = useRouter();
  const [tokens, setTokens] = useState<CardMarket[] | null>(null);
  const [safety, setSafety] = useState<Record<string, CardSafety>>({});
  const [tab, setTab] = useState<Tab>("trending");
  const [sort, setSort] = useState<Sort>("default");
  const [safeOnly, setSafeOnly] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState(false);
  const [navigating, startNav] = useTransition();
  const [hint, setHint] = useState("");
  const safetyRef = useRef(safety);
  safetyRef.current = safety;

  // Market feed, refreshed every 60s.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/tokens");
        const j = await r.json();
        if (alive) {
          // Server ships a ready-made safety snapshot, so most cards arrive already scored.
          if (j.safety) setSafety((prev) => ({ ...j.safety, ...Object.fromEntries(Object.entries(prev).filter(([, v]) => !v.pending)) }));
          setTokens(j.tokens);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Anything the snapshot didn't cover gets scanned live: batches of 8, two requests in flight.
  useEffect(() => {
    if (!tokens) return;
    let alive = true;
    (async () => {
      await sleep(50); // let the snapshot state land first
      for (let round = 0; round < 6 && alive; round++) {
        const todo = tokens.map((t) => t.address).filter((a) => !safetyRef.current[a] || safetyRef.current[a].pending);
        if (!todo.length) break;
        const batches: string[][] = [];
        for (let i = 0; i < todo.length; i += 8) batches.push(todo.slice(i, i + 8));
        let next = 0;
        await Promise.all([0, 1].map(async () => {
          while (alive && next < batches.length) {
            const batch = batches[next++];
            try {
              const r = await fetch(`/api/safety?a=${batch.join(",")}`);
              const j = (await r.json()) as Record<string, CardSafety>;
              if (alive) setSafety((prev) => ({ ...prev, ...j }));
            } catch { /* next round */ }
          }
        }));
        await sleep(4_000);
      }
    })();
    return () => { alive = false; };
  }, [tokens]);

  const shown = useMemo(() => {
    if (!tokens) return [];
    const needle = q.trim().toLowerCase();
    let list = tokens.filter((t) => {
      if (tab === "new" && Date.now() - new Date(t.createdAt).getTime() > 7 * 86_400_000) return false;
      if (tab === "trending" && !t.feeds.includes("trending")) return false;
      if (tab === "top" && !t.feeds.includes("top")) return false;
      if (safeOnly && safety[t.address]?.tier !== "safe") return false;
      if (needle && !`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const by: Record<Sort, (a: CardMarket, b: CardMarket) => number> = {
      default: (a, b) => (tab === "new" ? +new Date(b.createdAt) - +new Date(a.createdAt) : b.vol24 - a.vol24),
      safety: (a, b) => (safety[b.address]?.score ?? -1) - (safety[a.address]?.score ?? -1),
      volume: (a, b) => b.vol24 - a.vol24,
      gainers: (a, b) => b.change24 - a.change24,
      vibe: (a, b) => b.sentiment.score - a.sentiment.score,
      liquidity: (a, b) => b.liquidityUsd - a.liquidityUsd,
    };
    list = [...list].sort(by[sort]);
    return list;
  }, [tokens, safety, tab, sort, safeOnly, q]);

  const stats = useMemo(() => {
    const vals = Object.values(safety).filter((s) => !s.pending);
    return {
      tokens: tokens?.length ?? 0,
      safe: vals.filter((s) => s.tier === "safe").length,
      risky: vals.filter((s) => s.tier === "danger" || s.tier === "caution").length,
      vol: (tokens ?? []).reduce((s, t) => s + t.vol24, 0),
      scanned: vals.length,
    };
  }, [tokens, safety]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) {
      setHint("");
      startNav(() => router.push(`/token/${v.toLowerCase()}`));
    } else if (v.startsWith("0x")) {
      setHint("That address looks incomplete. Token addresses are 0x + 40 characters.");
    } else if (shown.length === 1) {
      startNav(() => router.push(`/token/${shown[0].address}`));
    }
  };
  const isAddr = /^0x[0-9a-fA-F]{40}$/.test(q.trim());

  return (
    <>
      <div className="stats">
        <div className="stat"><b className="mono">{stats.tokens}</b><small>Tokens live</small></div>
        <div className="stat"><b className="mono" style={{ color: "var(--bull)" }}>{stats.safe}</b><small>Look safe</small></div>
        <div className="stat"><b className="mono" style={{ color: "var(--bear)" }}>{stats.risky}</b><small>Need care</small></div>
        <div className="stat"><b className="mono">{usd(stats.vol)}</b><small>24h volume</small></div>
      </div>

      <div className="controls">
        <div className="tabs" role="group" aria-label="Feed">
          {([["trending", "🔥 Hot", ""], ["top", "💰 Top", " volume"], ["new", "✨ New", ""], ["all", "All", ""]] as [Tab, string, string][]).map(([k, l, more]) => (
            <button key={k} className="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}<span className="long">{more}</span></button>
          ))}
        </div>
        <button className="toggle" aria-pressed={safeOnly} onClick={() => setSafeOnly((v) => !v)}>🛡️ Safe only</button>
        <select className="search" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="default">Sort: default</option>
          <option value="safety">Safest first</option>
          <option value="volume">Most volume</option>
          <option value="gainers">Biggest gainers</option>
          <option value="vibe">Best vibes</option>
          <option value="liquidity">Deepest liquidity</option>
        </select>
        <form onSubmit={onSearch} className="search-wrap" role="search">
          <input className="search" value={q} onChange={(e) => { setQ(e.target.value); setHint(""); }} placeholder="Search or paste a token address…" aria-label="Search tokens" disabled={navigating} />
          {(navigating || isAddr) && (
            <button type="submit" className="go" aria-label={navigating ? "Loading token" : "Scan this token"} disabled={navigating}>
              {navigating ? <Spinner size={16} /> : "→"}
            </button>
          )}
        </form>
      </div>

      {navigating && (
        <p style={{ margin: "-6px 0 14px", fontSize: 14, fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
          <Spinner size={14} /> Opening token scan…
        </p>
      )}
      {hint && <p style={{ margin: "-6px 0 14px", fontSize: 14, fontWeight: 700, color: "var(--bear)" }}>{hint}</p>}
      {tokens && stats.scanned < stats.tokens && (
        <p style={{ margin: "-6px 0 14px", fontSize: 13, color: "var(--ink-3)", fontWeight: 600 }}>
          Safety scans: {stats.scanned}/{stats.tokens} done…
        </p>
      )}

      <div className="grid">
        {!tokens && !error && Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" />)}
        {shown.map((t) => <TokenCard key={t.address} t={t} s={safety[t.address]} />)}
      </div>
      {error && !tokens && <div className="empty">Couldn&apos;t reach the market feed. Retrying…</div>}
      {tokens && shown.length === 0 && (
        <div className="empty">
          {/^0x[0-9a-fA-F]{40}$/.test(q.trim()) ? "Not in the feed. Press Enter to scan that address directly." : "Nothing matches. Try another tab or turn off Safe only."}
        </div>
      )}
    </>
  );
}
