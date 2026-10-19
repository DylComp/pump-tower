"use client";
// Profile pictures and coin logos with on-brand fallbacks, so a missing or broken image
// never shows the browser's broken-image icon.
import { useState } from "react";
import type { Profile } from "@/lib/launch/registry";
import { shortAddr } from "@/lib/game";

const initials = (p: Pick<Profile, "username" | "wallet">) => (p.username ?? p.wallet).replace(/^@/, "").slice(0, 2);

export const profileName = (p: Pick<Profile, "username" | "wallet">) => (p.username ? `@${p.username}` : shortAddr(p.wallet));

export function ProfilePic({ profile, size = 48, className = "" }: { profile: Pick<Profile, "username" | "wallet" | "image">; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (!profile.image || broken)
    return (
      <span className={`pump-avatar pic-fallback ${className}`} style={{ ...style, fontSize: Math.max(8, Math.round(size / 4.5)) }} aria-hidden>
        {initials(profile)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`pump-avatar ${className}`}
      src={profile.image}
      alt=""
      width={size}
      height={size}
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

export function CoinLogo({ mint, ticker, size = 72, className = "coin-img" }: { mint: string; ticker: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (broken)
    return (
      <span className={`${className} logo-fallback`} style={{ ...style, fontSize: Math.max(7, Math.round(size / 6)) }} aria-hidden>
        {size < 40 ? ticker.slice(0, 1) : `$${ticker.slice(0, 4)}`}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={`/i/${mint}`} alt="" width={size} height={size} style={style} loading="lazy" onError={() => setBroken(true)} />;
}
