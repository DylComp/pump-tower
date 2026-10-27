"use client";

import { useEffect, useRef, useState } from "react";

const LINES = ["reading the squads", "watching member wallets", "counting the pot", "crowning the king"];
const CELLS = 12 * 8;
/** Never hold the page hostage: past this the intro finishes whatever is still loading. */
const MAX_MS = 6000;
const KEY = "kq:booted";
/** Runs before first paint on hard loads, so a returning visitor never sees a flash of it. */
const EARLY = `try{if(sessionStorage.getItem("${KEY}")==="1")document.documentElement.dataset.kqBooted="1"}catch(e){}`;

/**
 * King of the Hill intro: the crowned pill climbs the hill while the board, fonts and art
 * load, squad names drift past, then the crown flashes and the screen breaks away in pixel
 * blocks. Once per browser session, like the Pump Tower intro; `ready` is the page's data.
 */
export default function KingBoot({ ready, names = [] }: { ready: boolean; names?: string[] }) {
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState<"run" | "crown" | "out" | "done">("run");
  // The latest `ready` for the animation loop, without restarting it.
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    let seen = document.documentElement.dataset.kqBooted === "1";
    try {
      seen ||= sessionStorage.getItem(KEY) === "1";
    } catch {}
    if (seen) {
      document.documentElement.dataset.kqBooted = "1";
      setPhase("done");
    }
  }, []);

  useEffect(() => {
    if (phase !== "run") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const minMs = reduced ? 400 : 1900;
    const start = performance.now();
    let loaded = document.readyState === "complete";
    let fonts = !document.fonts;
    let art = false;
    const onLoad = () => (loaded = true);
    window.addEventListener("load", onLoad);
    document.fonts?.ready.then(() => (fonts = true)).catch(() => (fonts = true));
    const img = new Image();
    img.onload = img.onerror = () => (art = true);
    img.src = "/king-logo.png";

    let shown = 0;
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      const done = (loaded && fonts && art && readyRef.current && elapsed >= minMs) || elapsed >= MAX_MS;
      // Each finished piece unlocks more of the bar; time eases toward the cap.
      const cap = done ? 100 : 20 + (fonts ? 15 : 0) + (art ? 15 : 0) + (loaded ? 15 : 0) + (readyRef.current ? 25 : 0);
      const target = Math.min(cap, (elapsed / minMs) * 100);
      shown += (target - shown) * 0.1 + (target > shown ? 0.25 : 0);
      shown = Math.min(shown, target);
      setPct(Math.floor(shown));
      if (done && shown >= 99.5) {
        setPct(100);
        setPhase("crown");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("load", onLoad);
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "crown") {
      const t = setTimeout(() => setPhase("out"), 650);
      return () => clearTimeout(t);
    }
    if (phase === "out") {
      const t = setTimeout(() => {
        setPhase("done");
        // Remembered only once it has played, so the rest of the session skips it.
        document.documentElement.dataset.kqBooted = "1";
        try {
          sessionStorage.setItem(KEY, "1");
        } catch {}
      }, 760);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (phase === "done") return null;
  const step = Math.min(LINES.length - 1, Math.floor((pct / 100) * LINES.length));
  // Two drifting columns of real squad names either side of the hill, once the board is in.
  const cols = [0, 1].map((c) => names.filter((_, i) => i % 2 === c).slice(0, 14));
  return (
    <div className={`kqb ${phase === "crown" ? "crown" : ""} ${phase === "out" ? "out" : ""}`} aria-hidden>
      <script dangerouslySetInnerHTML={{ __html: EARLY }} />
      <div className="kqb-grid">
        {Array.from({ length: CELLS }, (_, i) => (
          <i key={i} style={{ animationDelay: `${((i * 37) % CELLS) * 4}ms` }} />
        ))}
      </div>
      <div className="kqb-sky">
        {cols.map((col, c) =>
          col.length ? (
            <div key={c} className={`kqb-col c${c}`}>
              {[...col, ...col].map((n, i) => (
                <span key={i} className="pixel">
                  {n.toLowerCase()}
                </span>
              ))}
            </div>
          ) : null,
        )}
      </div>
      <div className="kqb-core">
        <div className="kqb-stage">
          <div className="kqb-rays" />
          <div className="kqb-climb" style={{ transform: `translateY(${Math.round((1 - pct / 100) * 9) * 8}px)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pixelated" src="/king-logo.png" alt="" width={136} height={136} />
          </div>
          <svg className="kqb-hill" viewBox="0 0 64 20" shapeRendering="crispEdges" aria-hidden>
            <path d="M0 20V16h6v-2h6v-2h6v-2h6V8h16v2h6v2h6v2h6v2h6v4z" fill="#15803d" />
            <path d="M0 16h6v-2h6v-2h6v-2h6V8h16v2h6v2h6v2h6v2h6v1H0z" fill="#4ade80" />
            <path d="M24 8h16v1H24z" fill="#86efac" />
            <path d="M8 18h2v1H8zM20 15h2v1h-2zM44 16h2v1h-2zM54 18h2v1h-2zM31 12h2v1h-2z" fill="#0f5f2d" />
          </svg>
          {Array.from({ length: 10 }, (_, i) => (
            <b key={i} className="kqb-spark" style={{ ["--a" as string]: `${i * 36}deg`, animationDelay: `${(i % 5) * 40}ms` }} />
          ))}
        </div>
        <div className="pixel kqb-title">
          {"king of the hill".split("").map((ch, i) => (
            <span key={i} style={{ animationDelay: `${i * 45}ms` }}>
              {ch === " " ? " " : ch}
            </span>
          ))}
        </div>
        <div className="kqb-bar">
          {/* Whole 8px segments, like the bar is made of blocks. */}
          <span style={{ width: `${Math.round((pct / 100) * 30) * 8}px` }} />
          <svg className="kqb-crown" viewBox="0 0 7 5" shapeRendering="crispEdges" aria-hidden>
            <path d="M0 0h1v1h1v1h1V0h1v2h1V1h1V0h1v5H0z" fill="currentColor" />
          </svg>
        </div>
        <div className="kqb-meta">
          <span className="kqb-line">{phase === "run" ? LINES[step] : "long live the king"}</span>
          <span className="kqb-pct">{String(pct).padStart(3, " ")}%</span>
        </div>
      </div>
    </div>
  );
}

