"use client";
// The fees-routed tracker on /tokens: every creator fee from coins launched here, split
// 80/20 between pump users and the treasury, and the treasury share turned into $PTWR
// buybacks that are burned. Numbers come from /api/fees and refresh every minute.
import { useEffect, useState } from "react";
import type { FeesRouted } from "@/lib/launch/routed";
import { HOUSE_SYMBOL } from "@/lib/game";
import { SPLIT } from "@/lib/launch/model";
import { ago, fmtSol } from "./CoinCard";

const fmtTokens = (n: number) =>
  n <= 0 ? "0" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;

export default function FeeTracker() {
  const [f, setF] = useState<FeesRouted | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/fees")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: FeesRouted | null) => j && setF(j))
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const live = !!f?.houseMint;
  const steps: { label: string; value: string; note: string; tone?: string }[] = [
    { label: "creator fees", value: `${fmtSol(f?.creatorSol ?? 0)} SOL`, note: `from ${f?.coins ?? 0} coin${f?.coins === 1 ? "" : "s"} launched here` },
    { label: `${SPLIT.recipientBps / 100}% to pump users`, value: `${fmtSol(f?.toUsersSol ?? 0)} SOL`, note: "straight to their wallets", tone: "green" },
    { label: `${SPLIT.treasuryBps / 100}% to treasury`, value: `${fmtSol(f?.toTreasurySol ?? 0)} SOL`, note: `${fmtSol(f?.buybackEligibleSol ?? 0)} SOL verified for buybacks` },
    { label: `bought back $${HOUSE_SYMBOL}`, value: `${fmtSol(f?.buybackSpentSol ?? 0)} SOL`, note: live ? "market buys by the worker" : `starts when $${HOUSE_SYMBOL} launches`, tone: "gold" },
    { label: `$${HOUSE_SYMBOL} burned forever`, value: fmtTokens(f?.burnedPtwr ?? 0), note: "bought and burned in one transaction", tone: "fire" },
  ];

  return (
    <section className="panel fee-tracker" id="fees" aria-label="fees routed">
      <header className="ft-head">
        <span className="pixel green tiny-pixel">
          <span className={`ft-dot${live ? " on" : ""}`} aria-hidden /> fees routed
        </span>
        <span className="dim">{f?.updatedAt ? `worker updated ${ago(f.updatedAt)}` : f ? "live totals, refreshed every minute" : "loading"}</span>
      </header>
      <ol className="ft-flow">
        {steps.map((s, i) => (
          <li key={s.label} className={`ft-step${s.tone ? ` ${s.tone}` : ""}`} style={{ ["--i" as string]: i }}>
            <span className="label">{s.label}</span>
            <span className="pixel ft-value">{f ? s.value : "…"}</span>
            <span className="dim ft-note">{s.note}</span>
          </li>
        ))}
      </ol>
      <div className="ft-split" aria-hidden>
        <span style={{ flex: SPLIT.recipientBps }}>{SPLIT.recipientBps / 100}% pump users</span>
        <span style={{ flex: SPLIT.treasuryBps }}>{SPLIT.treasuryBps / 100}%</span>
      </div>
      <footer className="ft-foot">
        <span>
          <span className="label">${HOUSE_SYMBOL} creator fees collected</span> <span className="pixel">{fmtSol(f?.houseFeesSol ?? 0)} SOL</span>
          {f?.lastHouseCollect && (
            <a className="ft-tx" href={solscan(f.lastHouseCollect)} target="_blank" rel="noopener">
              last collect ↗
            </a>
          )}
        </span>
        <span>
          {f?.lastBuyback ? (
            <a className="ft-tx" href={solscan(f.lastBuyback.signature)} target="_blank" rel="noopener">
              last buyback: {fmtSol(f.lastBuyback.sol)} SOL → {fmtTokens(f.lastBuyback.burned)} ${HOUSE_SYMBOL} burned ↗
            </a>
          ) : (
            <span className="dim">no buybacks yet</span>
          )}
        </span>
      </footer>
    </section>
  );
}
