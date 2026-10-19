import type { CoinView } from "@/lib/launch/registry";
import { FEE_TIER_NAMES } from "@/lib/launch/model";
import { CoinLogo, profileName } from "./Pics";

export const fmtSol = (n: number) => (n <= 0 ? "0" : n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4));

export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "--" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

export function ago(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** One launched coin in a grid: picture, ticker, who it pays, and its fee tier. */
export default function CoinCard({ c, i = 0 }: { c: CoinView; i?: number }) {
  const who = profileName(c.recipient);
  return (
    <a className="panel coin-card" href={`/t/${c.mint}`} style={{ ["--i" as string]: i }}>
      <CoinLogo mint={c.mint} ticker={c.ticker} />
      <span className="coin-body">
        <span className="pixel">{c.name}</span>
        <span className="green pixel tiny-pixel">${c.ticker}</span>
        <span className="dim">for {who} · {ago(c.createdAt)}</span>
        <span className="coin-meta">
          <span className={`chip tier-${c.tier}`}>{FEE_TIER_NAMES[c.tier]}</span>
          <span className="dim">{fmtSol(c.feesSol)} SOL fees</span>
          {c.mcapUsd != null && <span className="dim">{fmtUsd(c.mcapUsd)} mc</span>}
        </span>
      </span>
    </a>
  );
}
