import type { CoinView } from "@/lib/launch/registry";
import { FEE_TIER_NAMES } from "@/lib/launch/model";
import { shortAddr } from "@/lib/game";

export const fmtSol = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4));

export function fmtMcap(n: number | null | undefined) {
  if (n == null) return "–";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

export function ago(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** One launched coin in a grid: picture, ticker, who it pays, and its fee tier. */
export default function CoinCard({ c, i = 0 }: { c: CoinView; i?: number }) {
  const who = c.recipient.username ? `@${c.recipient.username}` : shortAddr(c.recipient.wallet);
  return (
    <a className="panel coin-card" href={`/t/${c.mint}`} style={{ ["--i" as string]: i }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="coin-img" src={`/i/${c.mint}`} alt="" width={72} height={72} loading="lazy" />
      <span className="coin-body">
        <span className="pixel">{c.name}</span>
        <span className="green pixel tiny-pixel">${c.ticker}</span>
        <span className="dim">for {who} · {ago(c.createdAt)}</span>
        <span className="coin-meta">
          <span className={`chip tier-${c.tier}`}>{FEE_TIER_NAMES[c.tier]}</span>
          <span className="dim">{fmtSol(c.feesSol)} SOL fees</span>
          <span className="dim">{fmtMcap(c.mcapUsd)} mc</span>
        </span>
      </span>
    </a>
  );
}
