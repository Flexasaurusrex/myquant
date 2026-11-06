"use client";
import { useEffect, useState } from "react";

const STEPS = [
  "Reading the contract…",
  "Checking for honeypots and hidden taxes…",
  "Measuring liquidity…",
  "Counting buyers and sellers…",
  "Following the whales…",
  "Tracing insider wallets…",
];

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}

export default function Scanning({ address, steps = STEPS }: { address?: string; steps?: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 900);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div className="scanning" role="status" aria-live="polite">
      <div className="radar" aria-hidden><i /></div>
      <div style={{ minWidth: 0 }}>
        <b>Scanning token</b>
        {address && <div className="mono scan-addr">{address}</div>}
        <ul>
          {steps.map((s, k) => (
            <li key={s} className={k < i ? "done" : k === i ? "now" : ""}>
              {k < i ? "✓" : k === i ? <Spinner size={12} /> : "·"} {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="panel-loading" role="status">
      <Spinner /> {label}
    </div>
  );
}
