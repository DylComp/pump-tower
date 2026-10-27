"use client";
// One squad's page: where it stands, its fan coin and who that coin pays, and its crowns.
import Link from "next/link";
import type { Reign, SquadCoin } from "@/lib/king/model";
import type { Market } from "@/lib/launch/market";
import { shortAddr } from "@/lib/game";
import { CopyText } from "./CopyCA";
import { fmtSol, fmtUsd } from "./CoinCard";
import { Crown, KING_BRAND, SquadPic, pumpCoin, sol, solSigned, useKing, type BoardSquad } from "./King";
import KingBoot from "./KingBoot";
import SiteNav from "./SiteNav";
import { useMe } from "./useMe";

type Data = { squad: BoardSquad | null; coin: SquadCoin | null; market: Market | null; reigns: (Omit<Reign, "payouts"> & { payouts: number })[] };

export default function KingSquad({ name }: { name: string }) {
  const wallet = useMe();
  const { data, error } = useKing<Data>(`/api/king/squad?name=${encodeURIComponent(name)}`);
  const s = data?.squad;
  const c = data?.coin;
  const title = s?.name ?? c?.squad ?? name;
  const won = (data?.reigns ?? []).reduce((n, r) => n + sol(r.holdersLamports), 0);

  return (
    <>
      <KingBoot ready={!!data || !!error} />
      <SiteNav wallet={wallet} active="/king" brand={KING_BRAND} />
      <main className="page king-page">
        <section className="sec king">
          <Link href="/king" className="back-link">
            <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden>
              <path fill="currentColor" d="M2 0h1v1H2zM1 1h1v1H1zM0 2h6v1H0zM1 3h1v1H1zM2 4h1v1H2z" />
            </svg>
            all squads
          </Link>
          {!data && <p className="pixel blink tiny-pixel">{error ?? "loading squad"}</p>}
          {data && (
            <>
              <header className="kq-squad-head">
                <SquadPic src={s?.image ?? c?.image ?? null} name={title} size={72} />
                <div>
                  <span className="kicker">squad #{s?.rank ?? "--"} · {s?.members ?? c?.members.length ?? 0} members</span>
                  <h1 className="pixel display sm">
                    {data.reigns.length > 0 && <Crown size={22} />} {title}
                  </h1>
                  <p className="lede">
                    {data.reigns.length ? `King ${data.reigns.length}× so far, paying holders ${fmtSol(won)} SOL.` : "Not crowned yet."} The crown goes to the squad whose members bank the most SOL in the hour, read from their wallets on chain.
                  </p>
                </div>
                {c && (
                  <a className="btn" href={pumpCoin(c.mint)} target="_blank" rel="noopener">
                    buy ${c.ticker} on pump
                  </a>
                )}
              </header>

              <div className="kq-stats">
                <div className="panel tile">
                  <span className="label">this hour</span>
                  <span className={`pixel big ${(s?.bankedHour ?? 0) >= 0 ? "green" : "red"}`}>{solSigned(s?.bankedHour)} SOL</span>
                  <span className="dim">{s?.bankedHour == null ? "tracked once its coin launches" : "banked on chain, counts for king"}</span>
                </div>
                <div className="panel tile">
                  <span className="label">last hour</span>
                  <span className="pixel big">{solSigned(s?.bankedLast)} SOL</span>
                  <span className="dim">{s?.members ?? 0} member wallets</span>
                </div>
                <div className="panel tile">
                  <span className="label">cup so far</span>
                  <span className="pixel big">{solSigned(s?.bankedTotal)} SOL</span>
                  <span className="dim">{s?.struck ? "struck by pump" : `pump rank #${s?.rank ?? "--"} at the lock`}</span>
                </div>
                <div className="panel tile">
                  <span className="label">coin market cap</span>
                  <span className="pixel big">{fmtUsd(data.market?.mcapUsd)}</span>
                  <span className="dim">{data.market?.volUsd != null ? `${fmtUsd(data.market.volUsd)} 24h volume` : c ? `$${c.ticker}` : "no coin yet"}</span>
                </div>
              </div>

              <div className="kq-layout">
                <div className="panel kq-board">
                  <h2 className="pixel lp-title">
                    <span>fees</span> who ${c?.ticker ?? "the coin"} pays
                  </h2>
                  {c ? (
                    <>
                      <p className="dim">Locked on chain at launch, admin revoked. Nobody can change it.</p>
                      {c.shares.map((sh, i) => {
                        const m = c.members.find((x) => x.wallet === sh.address);
                        return (
                          <div className="kq-row kq-share" key={sh.address}>
                            <span className="pixel dim">{i === 0 ? "pot" : i}</span>
                            <span>
                              {i === 0 ? <b>King pot (treasury)</b> : <b>{m?.username ? `@${m.username}` : shortAddr(sh.address)}</b>}
                              <span className="dim mono"> {shortAddr(sh.address)}</span>
                            </span>
                            <span className="r pixel green">{sh.shareBps / 100}%</span>
                          </div>
                        );
                      })}
                      <div className="kq-ca">
                        <span className="label">contract</span>
                        <CopyText text={c.mint} />
                      </div>
                    </>
                  ) : (
                    <p className="dim">This squad&apos;s coin hasn&apos;t launched yet.</p>
                  )}
                </div>
                <aside className="panel kq-log">
                  <h2 className="pixel lp-title">
                    <span>log</span> crowns
                  </h2>
                  {!data.reigns.length && <p className="dim">No crowns yet.</p>}
                  <ol>
                    {data.reigns.map((r) => (
                      <li key={r.hour}>
                        <span className="pixel tiny">{r.hour.slice(5, 10)} {r.hour.slice(11, 13)}:00</span>
                        <span className="green">{solSigned(r.king!.gainSol)} SOL banked</span>
                        <span className="dim">
                          {fmtSol(sol(r.holdersLamports))} SOL to {r.payouts} holders ·{" "}
                          <a href={`/api/king/payouts?hour=${r.hour}`} target="_blank" rel="noopener">list</a>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="dim tiny kq-fine">Unofficial fan coin. Not affiliated with {title} or pump.fun.</p>
                </aside>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
