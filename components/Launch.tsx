"use client";
// The launchpad: pick a pump.fun user, design the coin, launch it in one wallet approval.
// 80% of its creator fees go to that user and 20% to the Pump Tower treasury for $PTWR
// buybacks, locked on chain in the same transaction that creates the coin.
import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FEE_TIERS, FEE_TIER_NAMES, SPLIT, MAX_IMAGE_BYTES, cleanDraft, emptyDraft, initialBuyLamports, type Draft } from "@/lib/launch/model";
import type { Profile } from "@/lib/launch/registry";
import { shortAddr } from "@/lib/game";
import { SITE_HOST } from "@/lib/site";
import SiteNav from "./SiteNav";
import { useMe } from "./useMe";
import { fromB64, post, provider, rejected, toB64 } from "./wallet";

type Status = { open: boolean; reason: string | null; treasury: string | null };
type Prepared = { tx: string; mint: string; recipient: Profile };

// Programs a launch may call. Anything else in the transaction means it was tampered with.
const ALLOWED_PROGRAMS = new Set([
  "ComputeBudget111111111111111111111111111111",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "11111111111111111111111111111111",
]);

const STEPS = ["saving the image", "building the launch", "approve in your wallet", "sending to Solana", "locking the fee split"] as const;

/** Squares and shrinks the picture in the browser so uploads stay small. GIFs stay animated. */
async function toImage(file: File): Promise<string> {
  const read = (f: Blob) =>
    new Promise<string>((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(r.result as string);
      r.onerror = () => no(new Error("could not read that file"));
      r.readAsDataURL(f);
    });
  if (file.type === "image/gif") {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("GIFs must be 400 KB or smaller.");
    return read(file);
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPG, GIF or WebP image.");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(512, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  for (const q of [0.92, 0.8, 0.6]) {
    const url = canvas.toDataURL("image/webp", q);
    const out = url.startsWith("data:image/webp") ? url : canvas.toDataURL("image/png");
    if ((out.length * 3) / 4 <= MAX_IMAGE_BYTES) return out;
  }
  throw new Error("That image is too detailed, try a simpler one.");
}

function ProfileCard({ p, big = false }: { p: Profile; big?: boolean }) {
  return (
    <div className={`pump-profile${big ? " big" : ""}`}>
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" width={big ? 56 : 40} height={big ? 56 : 40} referrerPolicy="no-referrer" />
      ) : (
        <span className="pump-avatar" aria-hidden>
          {(p.username ?? p.wallet).slice(0, 2)}
        </span>
      )}
      <span className="pump-who">
        <span className="pixel">{p.username ? `@${p.username}` : shortAddr(p.wallet)}</span>
        <span className="dim mono">{shortAddr(p.wallet)}</span>
        {p.followers != null && <span className="dim">{p.followers.toLocaleString()} followers on pump</span>}
      </span>
    </div>
  );
}

export default function Launch() {
  const wallet = useMe();
  const { me, connect } = wallet;
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [recipient, setRecipient] = useState<Profile | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/launch/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ open: false, reason: "Couldn't reach the launchpad, refresh to try again.", treasury: null }));
    const to = new URL(window.location.href).searchParams.get("to");
    if (to) {
      setQuery(to);
      void find(to);
    }
  }, []);

  const problem = useMemo(() => {
    try {
      cleanDraft(draft);
      return image ? null : "Add a picture.";
    } catch (e) {
      return (e as Error).message;
    }
  }, [draft, image]);
  const buySol = useMemo(() => {
    try {
      return Number(initialBuyLamports(draft.initialBuy)) / 1e9;
    } catch {
      return null;
    }
  }, [draft.initialBuy]);

  async function find(q = query) {
    if (!q.trim()) return;
    setFinding(true);
    setFindError(null);
    try {
      const res = await fetch(`/api/pump/profile?q=${encodeURIComponent(q.trim())}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "not found");
      setRecipient(j.profile);
    } catch (e) {
      setRecipient(null);
      setFindError((e as Error).message);
    } finally {
      setFinding(false);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    try {
      setImage(await toImage(file));
    } catch (err) {
      setImage(null);
      setImageError((err as Error).message);
    }
  }
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    void loadFile(e.target.files?.[0]);
    e.target.value = "";
  };
  const drop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    void loadFile(e.dataTransfer.files?.[0]);
  };

  const set = (k: keyof Draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function launch(e: FormEvent) {
    e.preventDefault();
    if (step != null || !recipient || problem || !image || !status?.open) return;
    setError(null);
    let addr = me;
    if (!addr) addr = await connect();
    if (!addr) return;
    const p = provider();
    if (!p?.signTransaction) return setError("This wallet can't sign transactions. Try Phantom, Solflare or Backpack.");
    const { Keypair, VersionedTransaction } = await import("@solana/web3.js");
    // The mint key is made here and never leaves this tab. It signs once, then it's gone.
    const mint = Keypair.generate();
    const mintAddr = mint.publicKey.toBase58();
    try {
      setStep(0);
      await post("/api/launch/asset", { mint: mintAddr, image });
      setStep(1);
      const prepared = await post<Prepared>("/api/launch/prepare", { mint: mintAddr, draft, recipient: recipient.wallet });
      const tx = VersionedTransaction.deserialize(fromB64(prepared.tx));
      const keys = tx.message.staticAccountKeys;
      const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex].toBase58());
      if (!keys[0].equals(new (await import("@solana/web3.js")).PublicKey(addr)) || !keys.some((k) => k.equals(mint.publicKey)) || programs.some((id) => !ALLOWED_PROGRAMS.has(id)))
        throw new Error("The launch didn't match what was asked for, so it wasn't signed.");
      setStep(2);
      const signed = await p.signTransaction(tx);
      signed.sign([mint]);
      setStep(3);
      await post("/api/launch/send", { mint: mintAddr, tx: toB64(signed.serialize()) });
      setStep(4);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const res = await fetch("/api/launch/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint: mintAddr }) });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.coin) {
          window.location.href = `/t/${mintAddr}?new=1`;
          return;
        }
        if (res.status !== 202) throw new Error(j.error ?? "Couldn't confirm the launch.");
      }
      throw new Error(`Still waiting on Solana. Your coin will show up at ${SITE_HOST}/t/${mintAddr} once it lands.`);
    } catch (err) {
      setError(rejected(err) ? "You cancelled in the wallet. Nothing was spent." : (err as Error).message);
      setStep(null);
    }
  }

  const closed = status && !status.open;
  const tickerShown = draft.ticker.trim().replace(/^\$/, "").toUpperCase() || "TICKER";
  const who = recipient ? (recipient.username ? `@${recipient.username}` : shortAddr(recipient.wallet)) : "the pump user";
  const pct = (bps: number) => `${bps / 100}%`;

  return (
    <>
      <SiteNav wallet={wallet} active="/launch" />
      <main className="page launch-page">
        <section className="sec launchpad">
          <header className="lp-head">
            <div>
              <span className="kicker">launchpad</span>
              <h1 className="pixel display sm">launch a coin for any pump user</h1>
              <p className="lede">
                They get {pct(SPLIT.recipientBps)} of its creator fees forever and their own tower in the city, with the coin as a floor that climbs as fees come in.{" "}
                {pct(SPLIT.treasuryBps)} buys back $PTWR.
              </p>
            </div>
            <ol className="lp-steps">
              {[
                ["pick a pump user", "username, link or wallet"],
                ["design the coin", "name, ticker, picture"],
                ["approve once", "coin, split and dev buy in one tx"],
                ["they get a tower", `${pct(SPLIT.recipientBps)} of fees and a floor that climbs`],
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

          <form className="launch-grid" onSubmit={launch}>
            <div className="launch-form">
              <section className="panel lp-box">
                <h2 className="lp-title pixel">
                  <span>01</span> who gets the fees and the tower
                </h2>
                <div className="find-row">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void find();
                      }
                    }}
                    placeholder="pump username, profile link or wallet"
                    aria-label="pump.fun user"
                    maxLength={120}
                  />
                  <button type="button" className="btn small" onClick={() => void find()} disabled={finding}>
                    {finding ? "finding" : "find"}
                  </button>
                </div>
                {me && !recipient && (
                  <button type="button" className="link lp-self" onClick={() => (setQuery(me), void find(me))}>
                    launch for my own wallet
                  </button>
                )}
                {findError && <p className="red">{findError}</p>}
                {recipient && (
                  <div className="found swap" key={recipient.wallet}>
                    <ProfileCard p={recipient} big />
                    <span className="dim">
                      Gets {pct(SPLIT.recipientBps)} of creator fees and a tower at {SITE_HOST}/?w={shortAddr(recipient.wallet)}. They never have to sign anything.
                    </span>
                  </div>
                )}
              </section>

              <section className="panel lp-box">
                <h2 className="lp-title pixel">
                  <span>02</span> the coin
                </h2>
                <div className="lp-coin">
                  <div
                    className={`drop${image ? " has" : ""}${dragging ? " over" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={image ? "change the coin picture" : "add a coin picture"}
                    onClick={() => fileInput.current?.click()}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileInput.current?.click())}
                    onDragOver={(e) => (e.preventDefault(), setDragging(true))}
                    onDragLeave={() => setDragging(false)}
                    onDrop={drop}
                  >
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt="" />
                    ) : (
                      <span className="drop-empty">
                        <svg viewBox="0 0 16 16" width="32" height="32" aria-hidden shapeRendering="crispEdges">
                          <path d="M7 2h2v2h2v2H9v4H7V6H5V4h2z M2 10h2v2h8v-2h2v4H2z" fill="currentColor" />
                        </svg>
                        <b className="pixel">add picture</b>
                        <span>drop or click</span>
                      </span>
                    )}
                    {image && <span className="drop-swap pixel">change</span>}
                    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pick} hidden />
                  </div>
                  <div className="lp-fields">
                    <div className="two">
                      <label>
                        <span className="label">name</span>
                        <input value={draft.name} onChange={set("name")} maxLength={32} placeholder="Tower Cat" required />
                      </label>
                      <label>
                        <span className="label">ticker</span>
                        <input value={draft.ticker} onChange={set("ticker")} maxLength={11} placeholder="TCAT" required />
                      </label>
                    </div>
                    <label>
                      <span className="label">description</span>
                      <textarea value={draft.description} onChange={set("description")} maxLength={1000} rows={2} placeholder="what is this coin about" />
                    </label>
                  </div>
                </div>
                <span className={imageError ? "red" : "dim"}>{imageError ?? "PNG, JPG, WebP or GIF. Cropped square and sized to 512px for you."}</span>
              </section>

              <section className="panel lp-box">
                <h2 className="lp-title pixel">
                  <span>03</span> links and dev buy
                </h2>
                <div className="two">
                  <label>
                    <span className="label">x link</span>
                    <input value={draft.twitter} onChange={set("twitter")} placeholder="https://x.com/..." inputMode="url" />
                  </label>
                  <label>
                    <span className="label">telegram link</span>
                    <input value={draft.telegram} onChange={set("telegram")} placeholder="https://t.me/..." inputMode="url" />
                  </label>
                </div>
                <div className="two">
                  <label>
                    <span className="label">dev buy in SOL, optional</span>
                    <input value={draft.initialBuy} onChange={set("initialBuy")} placeholder="0" inputMode="decimal" />
                  </label>
                  <div className="lp-site">
                    <span className="label">website, locked</span>
                    <span className="mono">{SITE_HOST}/t/your-coin</span>
                  </div>
                </div>
                <span className="dim">The dev buy lands in the launch transaction, so nobody buys before you. The website is always the coin&apos;s page here.</span>
              </section>
            </div>

            <aside className="launch-side">
              <div className="panel lp-card">
                <div className="preview-card">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="" width={72} height={72} />
                  ) : (
                    <span className="preview-blank pixel">?</span>
                  )}
                  <div>
                    <p className="pixel">{draft.name.trim() || "coin name"}</p>
                    <p className="green pixel tiny-pixel">${tickerShown}</p>
                    <p className="dim clamp">{draft.description.trim() || "description"}</p>
                  </div>
                </div>

                <div className="mini-tower" aria-label={`${who}'s tower`}>
                  <div className="mt-sign pixel">
                    {recipient?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={recipient.image} alt="" width={14} height={14} referrerPolicy="no-referrer" />
                    ) : null}
                    {who}&apos;s tower
                  </div>
                  {FEE_TIER_NAMES.map((_, i) => FEE_TIER_NAMES.length - 1 - i)
                    .map((t) => (
                      <div key={t} className={`mt-floor${t === 0 ? " now" : ""}`} style={{ ["--t" as string]: t }}>
                        <span className="pixel">{t === 0 ? `$${tickerShown}` : FEE_TIER_NAMES[t]}</span>
                        <span>{t === 0 ? "new floor" : `${FEE_TIERS[t]} SOL fees`}</span>
                      </div>
                    ))}
                  <div className="mt-street" />
                </div>

                <div className="split-bar" aria-hidden>
                  <span style={{ flex: SPLIT.recipientBps }}>{pct(SPLIT.recipientBps)}</span>
                  <span style={{ flex: SPLIT.treasuryBps }}>{pct(SPLIT.treasuryBps)}</span>
                </div>
                <div className="split-legend">
                  <span>
                    <i className="dot g" /> {who}
                  </span>
                  <span>
                    <i className="dot w" /> $PTWR buyback
                  </span>
                </div>

                <div className="lp-cost">
                  <span className="label">you pay</span>
                  <b className="pixel">{buySol == null ? "check dev buy" : `~${(0.025 + buySol).toFixed(3)} SOL`}</b>
                </div>

                <button className="btn launch-go" type="submit" disabled={step != null || !recipient || !!problem || !status?.open}>
                  {step != null ? STEPS[step] : !recipient ? "pick who gets the fees" : problem ? problem : closed ? "launches open soon" : me ? "launch on pump.fun" : "connect and launch"}
                </button>
                {step != null && (
                  <ol className="launch-steps">
                    {STEPS.map((st, i) => (
                      <li key={st} className={i < step ? "done" : i === step ? "now" : ""}>
                        {st}
                      </li>
                    ))}
                  </ol>
                )}
                {error && <p className="red">{error}</p>}
                <span className="dim lp-fine">
                  The split is locked and its admin removed in the launch itself. About 0.025 SOL covers pump.fun and network costs; your wallet shows the exact amount.
                </span>
              </div>

              <details className="panel kept">
                <summary className="pixel tiny-pixel">what&apos;s kept from pump.fun</summary>
                <p className="dim">
                  Kept: the bonding curve, graduation to PumpSwap, the dev buy, name, ticker, picture, description, X and Telegram links, and creator fees. Turned off:
                  custom websites (always this site), and mayhem mode, cashback and holder rewards mode, because each of those would take the creator fees away from the
                  80/20 split.
                </p>
              </details>
            </aside>
          </form>
        </section>
      </main>
    </>
  );
}
