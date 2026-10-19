"use client";
import { useCallback, useEffect, useState } from "react";
import { CoinLogo, ProfilePic } from "./Pics";
import type { CoinView } from "@/lib/launch/registry";
import { FEE_TIERS, FEE_TIER_NAMES } from "@/lib/launch/model";
import { shortAddr } from "@/lib/game";
import { SITE_URL } from "@/lib/site";
import { ago, fmtSol } from "./CoinCard";
import SiteNav from "./SiteNav";
import { useMe } from "./useMe";
import { fromB64, post, provider, questEvent, rejected } from "./wallet";

export default function CoinPage({ mint }: { mint: string }) {
  const wallet = useMe();
  const [c, setC] = useState<CoinView | null>(null);
  const [missing, setMissing] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/token/${mint}`)
      .then(async (r) => {
        if (r.status === 404) return setMissing(true);
        const j = await r.json();
        if (j.coin) setC(j.coin);
      })
      .catch(() => {});
  }, [mint]);

  useEffect(() => {
    if (wallet.me) void questEvent("coin");
  }, [wallet.me]);

  useEffect(() => {
    load();
    setFresh(new URL(window.location.href).searchParams.has("new"));
  }, [load]);

  async function payOut() {
    if (paying) return;
    setNote(null);
    const me = wallet.me ?? (await wallet.connect());
    if (!me) return;
    const p = provider();
    if (!p?.signAndSendTransaction) return setNote("This wallet can't send transactions. Try Phantom, Solflare or Backpack.");
    setPaying(true);
    try {
      const { tx } = await post<{ tx: string }>(`/api/token/${mint}/collect`);
      const { VersionedTransaction } = await import("@solana/web3.js");
      await p.signAndSendTransaction(VersionedTransaction.deserialize(fromB64(tx)));
      setNote("Paid out. It shows up in a few seconds.");
      setTimeout(load, 8000);
    } catch (e) {
      setNote(rejected(e) ? "Cancelled." : (e as Error).message);
    } finally {
      setPaying(false);
    }
  }

  if (missing)
    return (
      <>
        <SiteNav wallet={wallet} active="/tokens" />
        <main className="page">
          <section className="sec">
            <div className="panel empty-coins">
              <p className="pixel green">not launched here</p>
              <p className="dim">This coin wasn&apos;t launched on Pump Tower, or it is still landing. Give it a minute and refresh.</p>
              <a className="btn" href="/tokens">
                see all coins
              </a>
            </div>
          </section>
        </main>
      </>
    );

  const next = c ? FEE_TIERS[c.tier + 1] : undefined;
  const prev = c ? FEE_TIERS[c.tier] : 0;
  const progress = c && next != null ? Math.min(1, (c.feesSol - prev) / (next - prev)) : 1;
  const who = c ? (c.recipient.username ? `@${c.recipient.username}` : shortAddr(c.recipient.wallet)) : "";
  const share = c
    ? `https://x.com/intent/post?text=${encodeURIComponent(`$${c.ticker} is live on pump.fun, launched for ${who} on Pump Tower. 80% of fees to them, 20% buys back $PTWR.`)}&url=${encodeURIComponent(`${SITE_URL}/t/${mint}`)}`
    : "#";

  return (
    <>
      <SiteNav wallet={wallet} active="/tokens" />
      <main className="page coin-page">
        {!c ? (
          <section className="sec">
            <p className="pixel blink tiny-pixel">loading coin</p>
          </section>
        ) : (
          <section className="sec coin-detail">
            {fresh && (
              <div className="panel live-banner">
                <span className="pixel green">your coin is live</span>
                <a className="btn small" href={share} target="_blank" rel="noopener">
                  share on x
                </a>
              </div>
            )}
            <div className="coin-hero">
              <CoinLogo mint={mint} ticker={c.ticker} size={128} className="hero-logo" />
              <div>
                <span className="kicker">{ago(c.createdAt)}</span>
                <h1 className="pixel display sm">{c.name}</h1>
                <p className="green pixel">${c.ticker}</p>
                <button
                  className="link mono"
                  onClick={() => {
                    void navigator.clipboard?.writeText(mint);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "copied" : `${shortAddr(mint)} copy`}
                </button>
                {c.description && <p className="lede">{c.description}</p>}
                <div className="coin-links">
                  <a className="btn" href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noopener">
                    trade on pump.fun
                  </a>
                  <a className="btn ghost" href={`https://dexscreener.com/solana/${mint}`} target="_blank" rel="noopener">
                    dexscreener
                  </a>
                  <a className="btn ghost" href={`https://solscan.io/token/${mint}`} target="_blank" rel="noopener">
                    solscan
                  </a>
                  {c.twitter && (
                    <a className="btn ghost" href={c.twitter} target="_blank" rel="noopener nofollow">
                      x
                    </a>
                  )}
                  {c.telegram && (
                    <a className="btn ghost" href={c.telegram} target="_blank" rel="noopener nofollow">
                      telegram
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="coin-cols">
              <div className="panel chart">
                <iframe title={`${c.ticker} chart`} src={`https://dexscreener.com/solana/${mint}?embed=1&theme=dark&trades=0&info=0`} loading="lazy" />
              </div>
              <aside className="coin-side">
                <a className="panel recipient" href={`/u/${c.recipient.wallet}`}>
                  <span className="label">launched for</span>
                  <span className="pump-profile big">
                    <ProfilePic profile={c.recipient} size={56} />
                    <span className="pump-who">
                      <span className="pixel">{who}</span>
                      <span className="dim">gets 80% of creator fees</span>
                    </span>
                  </span>
                </a>
                <div className="panel fees">
                  <span className="label">creator fees so far</span>
                  <span className="pixel big green">{fmtSol(c.feesSol)} SOL</span>
                  <div className="fee-split">
                    <span>
                      {who} <b>{fmtSol(c.recipientSol)}</b>
                    </span>
                    <span>
                      $PTWR buybacks <b>{fmtSol(c.feesSol - c.recipientSol)}</b>
                    </span>
                  </div>
                  {(c.pendingSol ?? 0) > 0 && (
                    <>
                      <span className="dim">{fmtSol(c.pendingSol!)} SOL waiting to be paid out. Anyone can trigger it; you only pay the network fee.</span>
                      <button className="btn small" onClick={payOut} disabled={paying}>
                        {paying ? "paying out" : "pay out fees"}
                      </button>
                    </>
                  )}
                  {note && <span className="dim">{note}</span>}
                </div>
                <div className="panel tier-progress">
                  <span className="label">floor in {who}&apos;s tower</span>
                  <span className={`chip tier-${c.tier}`}>{FEE_TIER_NAMES[c.tier]}</span>
                  <div className="bar">
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                  <span className="dim">{next == null ? "Top milestone reached." : `${fmtSol(next - c.feesSol)} SOL more in fees reaches ${FEE_TIER_NAMES[c.tier + 1]}.`}</span>
                  <a className="link" href={`/?w=${c.recipient.wallet}#tower`}>
                    visit the tower
                  </a>
                </div>
              </aside>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
