"use client";
// King of the Hill: every squad in pump.fun's Squad Invitational has a fan coin. Each hour the
// squad whose members bank the most SOL (read on chain) is King, and its holders split the pot.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Reign, Squad } from "@/lib/king/model";
import { HOLDERS_BPS, POT_BPS, squadSlug } from "@/lib/king/model";
import { ago, fmtSol, fmtUsd } from "./CoinCard";
import KingBoot from "./KingBoot";
import SiteNav, { type Brand } from "./SiteNav";
import { useMe } from "./useMe";

export type BoardSquad = Squad & { coin: { mint: string; ticker: string; image: string | null; members: number; mcapUsd?: number | null; volUsd?: number | null } | null };
export type KingData = {
  board: { takenAt: number; wallets: number };
  squads: BoardSquad[];
  coins: number;
  pot: { lamports: string; hourStart: number; nextCrown: number };
  endsAt: number;
  reigns: (Omit<Reign, "payouts"> & { payouts: number })[];
};

export const KING_BRAND: Brand = { name: "king of the hill", href: "/king", logo: "/king-logo.png" };

export const sol = (lamports: string | number | bigint) => Number(lamports) / 1e9;
export const pumpCoin = (mint: string) => `https://pump.fun/coin/${mint}`;
export const signed = (n: number) => `${n < 0 ? "-" : "+"}${fmtUsd(Math.abs(n))}`;
/** SOL with a sign, or a dash for squads that aren't tracked. */
export const solSigned = (n: number | null | undefined) => (n == null ? "--" : `${n < 0 ? "-" : "+"}${fmtSol(Math.abs(n))}`);

export function useKing<T>(url: string, every = 10_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(url, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw Error(j.error ?? "couldn't load");
        if (on) (setData(j), setError(null));
      } catch (e) {
        if (on) setError((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, every);
    return () => ((on = false), clearInterval(id));
  }, [url, every]);
  return { data, error };
}

export function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export const countdown = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function SquadPic({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className="kq-pic fallback" style={{ width: size, height: size }} aria-hidden>{name.slice(0, 1).toUpperCase()}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="kq-pic" src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
}

export function Crown({ size = 16 }: { size?: number }) {
  return (
    <svg className="kq-crown" width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      <path d="M0 2h1v1h1v1h1V2h2v2h1V3h1V2h1v5H0z" fill="currentColor" />
      <path d="M0 6h8v1H0z" fill="#03100a" opacity=".35" />
    </svg>
  );
}

export default function King() {
  const wallet = useMe();
  const { data, error } = useKing<KingData>("/api/king");
  const now = useClock();
  const [q, setQ] = useState("");
  const [onlyCoins, setOnlyCoins] = useState(false);
  const last = data?.reigns.find((r) => r.king);
  const crowns = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of data?.reigns ?? []) if (r.king) n.set(r.king.groupId, (n.get(r.king.groupId) ?? 0) + 1);
    return n;
  }, [data]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.squads ?? []).filter((s) => (!onlyCoins || s.coin) && (!term || s.name.toLowerCase().includes(term) || s.coin?.ticker.toLowerCase().includes(term)));
  }, [data, q, onlyCoins]);

  return (
    <>
      <KingBoot ready={!!data || !!error} names={data?.squads.map((s) => s.name)} />
      <SiteNav wallet={wallet} active="/king" brand={KING_BRAND} />
      <main className="page king-page">
        <section className="sec king">
          <header className="kq-hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="kq-mascot pixelated" src="/king-logo.png" alt="" aria-hidden width={168} height={168} />
            <div>
              <span className="kicker">king of the hill · squad invitational</span>
              <h1 className="pixel display sm">every squad has a coin. every hour, one squad is king.</h1>
              <p className="lede">
                Buy the coin of the squad you think banks the most SOL this hour, read straight from its members&apos; wallets on chain. When it&apos;s crowned, holders split{" "}
                {HOLDERS_BPS / 100}% of the pot in SOL. The pot is {POT_BPS / 100}% of every squad coin&apos;s creator fees; the other {100 - POT_BPS / 100}% goes to that squad&apos;s members.
              </p>
            </div>
            <ol className="kq-steps">
              {[
                ["pick a squad", "buy its coin on pump"],
                ["they bank SOL", "most SOL taken off the table this hour"],
                ["you get SOL", "pro rata to your bag"],
              ].map(([t, b], i) => (
                <li key={t}>
                  <span className="lp-num pixel">{i + 1}</span>
                  <span>
                    <b className="pixel">{t}</b>
                    <span className="dim">{b}</span>
                  </span>
                </li>
              ))}
            </ol>
          </header>

          <div className="kq-stats">
            <div className="panel tile kq-pot">
              <span className="label">pot this hour</span>
              <span className="pixel big green">{data ? `${fmtSol(sol(data.pot.lamports))} SOL` : "--"}</span>
              <span className="dim">{HOLDERS_BPS / 100}% to holders · {100 - HOLDERS_BPS / 100}% buy-and-burn</span>
            </div>
            <div className="panel tile">
              <span className="label">next crown in</span>
              <span className="pixel big">{data ? countdown(data.pot.nextCrown - now) : "--:--:--"}</span>
              <span className="dim">holders counted at a secret minute</span>
            </div>
            <div className="panel tile">
              <span className="label">reigning king</span>
              {last?.king ? (
                <Link className="pixel big kq-reigning" href={`/king/${squadSlug(last.king.squad)}`}>
                  <Crown size={14} /> {last.king.squad}
                </Link>
              ) : (
                <span className="pixel big dim">none yet</span>
              )}
              <span className="dim">{last?.king ? `${solSigned(last.king.gainSol)} SOL banked in ${last.hour.slice(11, 13)}:00 UTC` : "first crown at the top of the hour"}</span>
            </div>
            <div className="panel tile">
              <span className="label">squad coins</span>
              <span className="pixel big">{data?.coins ?? "--"}</span>
              <span className="dim">{data ? `${data.board.wallets} member wallets watched` : ""}</span>
            </div>
            <div className="panel tile">
              <span className="label">cup ends in</span>
              <span className="pixel big">{data ? countdown(data.endsAt - now) : "--"}</span>
              <span className="dim">nov 9, 14:00 UTC</span>
            </div>
          </div>

          <div className="token-tools">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search squad or ticker" aria-label="search squads" />
            <div className="tabs">
              <button className={`tab${!onlyCoins ? " on" : ""}`} onClick={() => setOnlyCoins(false)}>all squads</button>
              <button className={`tab${onlyCoins ? " on" : ""}`} onClick={() => setOnlyCoins(true)}>with coins</button>
            </div>
          </div>

          <div className="kq-layout">
            <div className="panel kq-board">
              <div className="kq-row kq-headrow pixel">
                <span>#</span>
                <span>squad</span>
                <span className="r">this hour</span>
                <span className="r hide-sm">last hour</span>
                <span className="r hide-sm">cup so far</span>
                <span className="r">coin</span>
              </div>
              {!data && <p className="pixel blink tiny-pixel kq-pad">{error ?? "loading the board"}</p>}
              {shown.map((s, i) => {
                const king = last?.king?.groupId === s.groupId;
                return (
                  <div key={s.groupId} className={`kq-row${king ? " king" : ""}${s.struck ? " struck" : ""}`} style={{ ["--i" as string]: i }}>
                    <span className="pixel dim">{s.rank}</span>
                    <Link className="kq-name" href={`/king/${squadSlug(s.name)}`}>
                      <SquadPic src={s.image} name={s.name} size={30} />
                      <span>
                        <b>{king && <Crown size={11} />} {s.name}</b>
                        <span className="dim">
                          {s.members} members{crowns.get(s.groupId) ? ` · ${crowns.get(s.groupId)}× king` : ""}
                          {s.coin?.mcapUsd ? ` · ${fmtUsd(s.coin.mcapUsd)} mcap` : ""}
                        </span>
                      </span>
                    </Link>
                    <span className={`r mono ${s.bankedHour == null ? "dim" : s.bankedHour >= 0 ? "green" : "red"}`}>{solSigned(s.bankedHour)}</span>
                    <span className="r mono dim hide-sm">{solSigned(s.bankedLast)}</span>
                    <span className="r mono hide-sm">{solSigned(s.bankedTotal)}</span>
                    <span className="r">
                      {s.coin ? (
                        <a className="btn small" href={pumpCoin(s.coin.mint)} target="_blank" rel="noopener" title={`buy $${s.coin.ticker} on pump.fun`}>
                          ${s.coin.ticker}
                        </a>
                      ) : (
                        <span className="dim tiny">soon</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {data && !shown.length && <p className="dim kq-pad">No squads match.</p>}
            </div>

            <aside className="panel kq-log">
              <h2 className="pixel lp-title">
                <span>log</span> past kings
              </h2>
              {!data?.reigns.length && <p className="dim">The first King is crowned at the top of the next hour.</p>}
              <ol>
                {data?.reigns.map((r) => (
                  <li key={r.hour}>
                    <span className="pixel tiny">{r.hour.slice(5, 10)} {r.hour.slice(11, 13)}:00</span>
                    {r.king ? (
                      <Link href={`/king/${squadSlug(r.king.squad)}`}>
                        <Crown size={10} /> {r.king.squad} <span className="green">{solSigned(r.king.gainSol)} SOL</span>
                      </Link>
                    ) : (
                      <span className="dim">no king · pot rolls over</span>
                    )}
                    <span className="dim">
                      {fmtSol(sol(r.potLamports))} SOL pot{r.king ? ` · ${r.payouts} paid` : ""} ·{" "}
                      <a href={`/api/king/payouts?hour=${r.hour}`} target="_blank" rel="noopener">{r.status === "paid" ? "paid" : "list"}</a>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="dim tiny kq-fine">
                Unofficial. Not affiliated with pump.fun or any squad. Squads and members are pump.fun&apos;s top 100 as the cup locked
                {data ? ` (read ${ago(data.board.takenAt)})` : ""}; SOL banked is read from each member&apos;s wallet on chain, in SOL. Coins can go to zero.
              </p>
            </aside>
          </div>
        </section>
      </main>
    </>
  );
}
