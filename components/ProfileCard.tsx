import type { ProfileStats } from "@/lib/launch/model";
import type { Profile } from "@/lib/launch/registry";
import { shortAddr } from "@/lib/game";
import { ago, fmtMcap, fmtSol } from "./CoinCard";

/** One pump user on the tokens page: who they are, what their coins have made, and their market cap. */
export default function ProfileCard({ p, i = 0 }: { p: ProfileStats<Profile>; i?: number }) {
  const { profile } = p;
  const name = profile.username ? `@${profile.username}` : shortAddr(profile.wallet);
  return (
    <div className="panel profile-card" style={{ ["--i" as string]: i }}>
      <div className="pump-profile big">
        {profile.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.image} alt="" width={56} height={56} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="pump-avatar">{name.replace("@", "").slice(0, 2)}</span>
        )}
        <span className="pump-who">
          <span className="pixel">{name}</span>
          <span className="dim">
            {profile.followers != null ? `${profile.followers.toLocaleString()} followers · ` : ""}last launch {ago(p.latest)}
          </span>
        </span>
      </div>
      <dl className="profile-stats">
        <div>
          <dt className="label">coins</dt>
          <dd className="pixel">{p.coins}</dd>
        </div>
        <div>
          <dt className="label">market cap</dt>
          <dd className="pixel">{fmtMcap(p.mcapUsd)}</dd>
        </div>
        <div>
          <dt className="label">creator fees</dt>
          <dd className="pixel">{fmtSol(p.feesSol)} SOL</dd>
        </div>
        <div>
          <dt className="label">their 80%</dt>
          <dd className="pixel green">{fmtSol(p.recipientSol)} SOL</dd>
        </div>
      </dl>
      {p.top && (
        <a className="dim profile-top" href={`/t/${p.top.mint}`}>
          top coin <span className="green">${p.top.ticker}</span> · {fmtMcap(p.top.mcapUsd)} mc
        </a>
      )}
      <div className="profile-actions">
        <a className="btn" href={`/u/${profile.wallet}`}>
          view profile
        </a>
        <a className="btn ghost" href={`/?w=${profile.wallet}#tower`}>
          tower
        </a>
      </div>
    </div>
  );
}
