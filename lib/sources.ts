import { unstable_cache } from "next/cache";
import "server-only";
import { CHAIN_ID, GT_NETWORK, QUOTE_SYMBOLS, rpcUrl } from "./chain";

/* ---------- tiny in-memory cache + concurrency limiter ---------- */

const mem = new Map<string, { at: number; v: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn();
  mem.set(key, { at: Date.now(), v });
  return v;
}

export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, revalidate = 60) {
  const r = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/* ---------- GeckoTerminal: the token feed + market sentiment ---------- */

export type Market = {
  address: string;
  symbol: string;
  name: string;
  image: string | null;
  poolAddress: string;
  poolName: string;
  dex: string;
  priceUsd: number;
  fdvUsd: number;
  liquidityUsd: number;
  vol: { h1: number; h6: number; h24: number };
  change: { m5: number; h1: number; h6: number; h24: number };
  tx: Record<"h1" | "h6" | "h24", { buys: number; sells: number; buyers: number; sellers: number }>;
  createdAt: string;
  feeds: string[];
};

const n = (x: unknown) => (x == null || x === "" ? 0 : Number(x)) || 0;

function parsePools(json: any, feed: string): Market[] {
  const tokens = new Map<string, any>();
  for (const inc of json.included ?? []) if (inc.type === "token") tokens.set(inc.id, inc.attributes);
  const out: Market[] = [];
  for (const p of json.data ?? []) {
    const a = p.attributes;
    const baseId = p.relationships?.base_token?.data?.id;
    const t = tokens.get(baseId);
    if (!t || QUOTE_SYMBOLS.has(String(t.symbol).toUpperCase())) continue;
    const tx = (k: string) => ({
      buys: n(a.transactions?.[k]?.buys),
      sells: n(a.transactions?.[k]?.sells),
      buyers: n(a.transactions?.[k]?.buyers),
      sellers: n(a.transactions?.[k]?.sellers),
    });
    out.push({
      address: String(t.address).toLowerCase(),
      symbol: t.symbol,
      name: t.name,
      image: t.image_url && t.image_url !== "missing.png" ? t.image_url : null,
      poolAddress: a.address,
      poolName: a.name,
      dex: p.relationships?.dex?.data?.id ?? "",
      priceUsd: n(a.base_token_price_usd),
      fdvUsd: n(a.fdv_usd),
      liquidityUsd: n(a.reserve_in_usd),
      vol: { h1: n(a.volume_usd?.h1), h6: n(a.volume_usd?.h6), h24: n(a.volume_usd?.h24) },
      change: {
        m5: n(a.price_change_percentage?.m5),
        h1: n(a.price_change_percentage?.h1),
        h6: n(a.price_change_percentage?.h6),
        h24: n(a.price_change_percentage?.h24),
      },
      tx: { h1: tx("h1"), h6: tx("h6"), h24: tx("h24") },
      createdAt: a.pool_created_at,
      feeds: [feed],
    });
  }
  return out;
}

const GT = `https://api.geckoterminal.com/api/v2/networks/${GT_NETWORK}`;

export async function marketFeed(): Promise<Market[]> {
  return cached("feed", 90_000, async () => {
    const feeds: [string, string][] = [
      ["trending", `${GT}/trending_pools?include=base_token&page=1`],
      ["trending", `${GT}/trending_pools?include=base_token&page=2`],
      ["top", `${GT}/pools?include=base_token&sort=h24_volume_usd_desc&page=1`],
      ["top", `${GT}/pools?include=base_token&sort=h24_volume_usd_desc&page=2`],
      ["new", `${GT}/new_pools?include=base_token&page=1`],
    ];
    const results = await Promise.allSettled(feeds.map(([, u]) => getJson(u, 90)));
    // One card per token: keep its deepest pool, but remember every feed it appeared in.
    const byToken = new Map<string, Market>();
    results.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      for (const m of parsePools(r.value, feeds[i][0])) {
        const prev = byToken.get(m.address);
        if (!prev) byToken.set(m.address, m);
        else {
          const feedsU = Array.from(new Set([...prev.feeds, ...m.feeds]));
          const keep = m.liquidityUsd > prev.liquidityUsd ? m : prev;
          byToken.set(m.address, { ...keep, feeds: feedsU });
        }
      }
    });
    return Array.from(byToken.values());
  });
}

export async function tokenMarket(address: string): Promise<{ best: Market | null; pools: Market[] }> {
  const a = address.toLowerCase();
  try {
    // Failures throw out of cached() so a rate-limited empty answer is never stored.
    return await cached(`tm:${a}`, 90_000, async () => {
      const j = await getJson(`${GT}/tokens/${a}/pools?include=base_token&page=1`, 90);
      const pools = parsePools(j, "token").filter((p) => p.address === a);
      pools.sort((x, y) => y.liquidityUsd - x.liquidityUsd);
      return { best: pools[0] ?? null, pools };
    });
  } catch {
    const feed = await marketFeed().catch(() => [] as Market[]);
    const m = feed.find((x) => x.address === a) ?? null;
    if (m) return { best: m, pools: [m] };
    const ds = await dexScreenerMarket(a).catch(() => [] as Market[]);
    return { best: ds[0] ?? null, pools: ds };
  }
}

/** Backup market source when GeckoTerminal is rate limiting (DexScreener has no unique-wallet counts, so txns stand in). */
async function dexScreenerMarket(a: string): Promise<Market[]> {
  const pairs: any[] = await getJson(`https://api.dexscreener.com/tokens/v1/robinhood/${a}`, 60);
  const tx = (t: any) => ({ buys: n(t?.buys), sells: n(t?.sells), buyers: n(t?.buys), sellers: n(t?.sells) });
  return pairs
    .filter((p) => String(p.baseToken?.address).toLowerCase() === a)
    .map((p) => ({
      address: a, symbol: p.baseToken.symbol, name: p.baseToken.name, image: p.info?.imageUrl ?? null,
      poolAddress: String(p.pairAddress).toLowerCase(), poolName: `${p.baseToken.symbol} / ${p.quoteToken?.symbol ?? "?"}`,
      dex: p.dexId, priceUsd: n(p.priceUsd), fdvUsd: n(p.fdv), liquidityUsd: n(p.liquidity?.usd),
      vol: { h1: n(p.volume?.h1), h6: n(p.volume?.h6), h24: n(p.volume?.h24) },
      change: { m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1), h6: n(p.priceChange?.h6), h24: n(p.priceChange?.h24) },
      tx: { h1: tx(p.txns?.h1), h6: tx(p.txns?.h6), h24: tx(p.txns?.h24) },
      createdAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : "",
      feeds: ["dexscreener"],
    }))
    .sort((x, y) => y.liquidityUsd - x.liquidityUsd);
}

export async function ohlcv(poolAddress: string): Promise<[number, number][]> {
  return cached(`ohlc:${poolAddress}`, 300_000, async () => {
    try {
      const j = await getJson(`${GT}/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=48`, 300);
      const list: number[][] = j.data?.attributes?.ohlcv_list ?? [];
      return list.map((c) => [c[0], c[4]] as [number, number]).reverse();
    } catch {
      return [];
    }
  });
}

/* ---------- GoPlus: the "is this token safe?" engine ---------- */

export type GoPlus = Record<string, any> | null;

// Throws on rate limits so failures are never cached; only real answers persist (Data Cache, 15 min).
const goplusCached = unstable_cache(
  async (a: string): Promise<GoPlus> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(
        `https://api.gopluslabs.io/api/v1/token_security/${CHAIN_ID}?contract_addresses=${a}`,
        { cache: "no-store", headers: { accept: "application/json" } },
      );
      const j = r.ok ? await r.json().catch(() => null) : null;
      if (j?.code === 1) return j.result?.[a] ?? null; // null = GoPlus has no record yet
      await sleep(2000 * (attempt + 1));
    }
    throw new Error("goplus rate limited");
  },
  ["goplus-v1"],
  { revalidate: 3600 },
);

export async function goplus(address: string): Promise<GoPlus> {
  const a = address.toLowerCase();
  const hit = mem.get(`gp:${a}`);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.v as GoPlus;
  try {
    const v = await goplusCached(a);
    mem.set(`gp:${a}`, { at: Date.now(), v });
    return v;
  } catch {
    return undefined as unknown as GoPlus; // undefined = "couldn't scan right now", retry later
  }
}

export async function goplusMany(addresses: string[], limit = 3) {
  const res = await pool(addresses, limit, goplus);
  return new Map(addresses.map((a, i) => [a, res[i]]));
}

/* ---------- Whale moves: Alchemy transfers, public-RPC logs as fallback ---------- */

export type Transfer = { hash: string; from: string; to: string; amount: number; block: number; ts?: string };

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function rpc(url: string, method: string, params: unknown[]) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    if (r.status === 429 && attempt < 4) {
      await sleep(800 * 2 ** attempt);
      continue;
    }
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }
}

/** Block -> time estimator (this RPC reports blockTimestamp as 0x0 in logs). */
export async function blockClock() {
  return cached("clock", 10 * 60_000, async () => {
    const latest = await rpc(rpcUrl(), "eth_getBlockByNumber", ["latest", false]);
    const n = parseInt(latest.number, 16);
    const past = await rpc(rpcUrl(), "eth_getBlockByNumber", ["0x" + (n - 200_000).toString(16), false]);
    const t1 = parseInt(latest.timestamp, 16), t0 = parseInt(past.timestamp, 16);
    return { block: n, ts: t1, perBlock: (t1 - t0) / 200_000 };
  });
}

export async function recentTransfers(address: string, decimals: number): Promise<{ list: Transfer[]; source: string; hours: number }> {
  const a = address.toLowerCase();
  return cached(`tx:${a}`, 120_000, async () => {
    const clock = await blockClock();
    const latest = clock.block;
    const toIso = (b: number) => new Date((clock.ts - (latest - b) * clock.perBlock) * 1000).toISOString();
    const hoursFor = (span: number) => Math.round((span * clock.perBlock) / 360) / 10;

    if (process.env.ALCHEMY_API_KEY) {
      try {
        const span = 1_500_000;
        // 1,000 transfers per page; busy tokens need a few pages to cover meaningful hours.
        const raw: any[] = [];
        let pageKey: string | undefined;
        for (let page = 0; page < 4; page++) {
          const res = await rpc(rpcUrl(), "alchemy_getAssetTransfers", [
            {
              fromBlock: "0x" + Math.max(0, latest - span).toString(16), toBlock: "latest", contractAddresses: [a],
              category: ["erc20"], order: "desc", maxCount: "0x3e8", withMetadata: true, excludeZeroValue: true,
              ...(pageKey ? { pageKey } : {}),
            },
          ]);
          raw.push(...(res.transfers ?? []));
          pageKey = res.pageKey;
          if (!pageKey) break;
        }
        const list: Transfer[] = raw.map((t: any) => {
          const block = parseInt(t.blockNum, 16);
          return {
            hash: t.hash, from: String(t.from).toLowerCase(), to: String(t.to).toLowerCase(),
            amount: Number(t.value) || 0, block, ts: t.metadata?.blockTimestamp || toIso(block),
          };
        });
        const oldest = list.length ? list[list.length - 1].block : latest - span;
        return { list, source: "alchemy", hours: hoursFor(latest - oldest) };
      } catch {
        /* fall through to logs */
      }
    }

    // The RPC caps responses at 10k logs. Probe a small window to measure density,
    // then size one query to fit (~8k logs), capped at ~1.8 days.
    const getLogs = (span: number) =>
      rpc(rpcUrl(), "eth_getLogs", [
        { address: a, fromBlock: "0x" + Math.max(0, latest - span).toString(16), toBlock: "latest", topics: [TRANSFER_TOPIC] },
      ]) as Promise<any[]>;
    const PROBE = 20_000;
    let logs: any[] = await getLogs(PROBE).catch(() => []);
    let used = PROBE;
    const target = logs.length ? Math.floor((PROBE * 8_000) / logs.length) : 1_500_000;
    const span = Math.min(1_500_000, target);
    if (span > PROBE * 1.5) {
      try {
        logs = await getLogs(span);
        used = span;
      } catch {
        /* keep the probe window */
      }
    }
        const scale = 10 ** decimals;
    const list: Transfer[] = logs
      .filter((l) => l.topics?.length === 3)
      .map((l) => {
        const block = parseInt(l.blockNumber, 16);
        return {
          hash: l.transactionHash,
          from: ("0x" + l.topics[1].slice(26)).toLowerCase(),
          to: ("0x" + l.topics[2].slice(26)).toLowerCase(),
          amount: Number(BigInt(l.data === "0x" ? 0 : l.data)) / scale,
          block,
          ts: toIso(block),
        };
      })
      .reverse();
    return { list, source: process.env.ALCHEMY_API_KEY ? "alchemy-logs" : "public-rpc", hours: hoursFor(used) };
  });
}

export async function tokenDecimals(address: string): Promise<number> {
  return cached(`dec:${address}`, 86_400_000, async () => {
    try {
      return parseInt(await rpc(rpcUrl(), "eth_call", [{ to: address, data: "0x313ce567" }, "latest"]), 16) || 18;
    } catch {
      return 18;
    }
  });
}
