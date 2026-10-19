"use client";
import { useEffect, useState } from "react";
import { ProfilePic } from "./Pics";
import type { CoinView, Profile } from "@/lib/launch/registry";
import { rewardCash, shortAddr } from "@/lib/game";
import CoinCard, { fmtSol } from "./CoinCard";
import SiteNav from "./SiteNav";
import { useMe } from "./useMe";

/** A pump user's page: their pump profile, the coins launched for them, and what they've earned. */
export default function UserPage({ wallet: addr }: { wallet: string }) {
  const wallet = useMe();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [coins, setCoins] = useState<CoinView[] | null>(null);

  useEffect(() => {
    fetch(`/api/pump/profile?q=${addr}`)
      .then((r) => r.json())
      .then((j: { profile?: Profile }) => setProfile(j.profile ?? null))
      .catch(() => {});
    fetch(`/api/tokens?for=${addr}`)
      .then((r) => r.json())
      .then((j: { coins?: CoinView[] }) => setCoins(j.coins ?? []))
      .catch(() => setCoins([]));
  }, [addr]);

  const name = profile?.username ? `@${profile.username}` : shortAddr(addr);
  const earned = (coins ?? []).reduce((n, c) => n + c.recipientSol, 0);
  const fees = (coins ?? []).reduce((n, c) => n + c.feesSol, 0);

  return (
    <>
      <SiteNav wallet={wallet} />
      <main className="page user-page">
        <section className="sec">
          <div className="user-hero">
            <ProfilePic profile={profile ?? { wallet: addr, username: null, image: null }} size={112} className="huge" />
            <div>
              <span className="kicker">pump profile</span>
              <h1 className="pixel display sm">{name}</h1>
              <p className="dim mono">{addr}</p>
              {profile?.followers != null && <p className="dim">{profile.followers.toLocaleString()} followers on pump</p>}
              <div className="coin-links">
                <a className="btn" href={`/?w=${addr}#tower`}>
                  visit tower
                </a>
                <a className="btn ghost" href={`https://pump.fun/profile/${addr}`} target="_blank" rel="noopener">
                  pump.fun profile
                </a>
                {profile?.x && (
                  <a className="btn ghost" href={`https://x.com/${profile.x}`} target="_blank" rel="noopener">
                    x
                  </a>
                )}
                <a className="btn ghost" href={`/launch?to=${addr}`}>
                  launch a coin for {name}
                </a>
              </div>
            </div>
          </div>
          <div className="token-stats">
            <div className="panel tile">
              <span className="label">coins launched for them</span>
              <span className="pixel big">{coins?.length ?? 0}</span>
            </div>
            <div className="panel tile">
              <span className="label">creator fees</span>
              <span className="pixel big">{fmtSol(fees)} SOL</span>
            </div>
            <div className="panel tile">
              <span className="label">their 80%</span>
              <span className="pixel big green">{fmtSol(earned)} SOL</span>
            </div>
            <div className="panel tile">
              <span className="label">tower cash from fees</span>
              <span className="pixel big">${rewardCash(earned).toLocaleString()}</span>
            </div>
          </div>
          {coins == null ? (
            <p className="pixel blink tiny-pixel">loading coins</p>
          ) : coins.length ? (
            <div className="coin-grid">
              {coins.map((c, i) => (
                <CoinCard key={c.mint} c={c} i={i} />
              ))}
            </div>
          ) : (
            <div className="panel empty-coins">
              <p className="pixel green">no coins yet</p>
              <p className="dim">Launch one for {name} and 80% of its creator fees go to this wallet.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
