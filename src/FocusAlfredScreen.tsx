import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* ------------ public path helper (Vite/CRA/Vercel/GH Pages) ------------ */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}
const FOCUS_ALFRED_SRC = publicPath("/alfred/imer_Alfred.png"); // provided path

/* ------------------------------ utilities ------------------------------ */
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const mmss = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

type Phase = "focus" | "break" | "long";
type PresetKey = "pomodoro" | "sprint" | "deep" | "custom";

type Preset = {
  key: PresetKey;
  label: string;
  focusMin: number;
  breakMin: number;
  longMin: number;
  cyclesBeforeLong: number;
};

const PRESETS: Preset[] = [
  { key: "pomodoro", label: "Pomodoro (25/5 · long 15)", focusMin: 25, breakMin: 5,  longMin: 15, cyclesBeforeLong: 4 },
  { key: "sprint",   label: "Sprint (15/3 · long 8)",    focusMin: 15, breakMin: 3,  longMin: 8,  cyclesBeforeLong: 4 },
  { key: "deep",     label: "Deep Work (50/10 · 20)",    focusMin: 50, breakMin: 10, longMin: 20, cyclesBeforeLong: 3 },
  { key: "custom",   label: "Custom",                    focusMin: 25, breakMin: 5,  longMin: 15, cyclesBeforeLong: 4 },
];

/* ------------------------------ modal shell ------------------------------ */
function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 2000, padding: 16 }}>
      <div onClick={(e)=>e.stopPropagation()}
        style={{ width: "min(760px, 96vw)", background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.2)", padding: 20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------ help content ------------------------------ */
function FocusHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Focus Alfred helps you work in short, high-energy sprints with proper breaks so you don’t burn out.</em></p>

      <h4 style={{ margin: 0 }}>Presets</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pomodoro</b>: 25 min focus, 5 min break, long break after 4 cycles.</li>
        <li><b>Sprint</b>: 15 / 3 — great for starting when motivation is low.</li>
        <li><b>Deep Work</b>: 50 / 10 with a 20-min long break after 3 cycles.</li>
        <li><b>Custom</b>: set your own focus/break/long-break minutes and cycle count.</li>
      </ul>

      <h4 style={{ margin: 0 }}>How to use</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Pick a preset (or choose Custom and set your times).</li>
        <li>Press <b>Start</b>. Work on one task only. Silence distractions.</li>
        <li>When the timer flips to Break, stand up, drink water, move around.</li>
        <li>After <b>n</b> focus blocks, you’ll get a longer break automatically.</li>
      </ol>

      <h4 style={{ margin: 0 }}>Options</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Auto-start next</b>: jump into the next phase automatically.</li>
        <li><b>Chime</b>: a short tone + subtle vibration (if available) on phase change.</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Tip: If an hour of hyperfocus suits you, switch to Deep Work or set Custom to 60 / 10.
      </p>
    </div>
  );
}

/* ================================ PAGE ================================= */
export default function FocusAlfredScreen() {
  // image + help
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  // preset + settings
  const [preset, setPreset] = useState<PresetKey>(() => (localStorage.getItem("focus_preset") as PresetKey) || "pomodoro");
  const [focusMin, setFocusMin] = useState<number>(() => Number(localStorage.getItem("focus_focus")) || PRESETS[0].focusMin);
  const [breakMin, setBreakMin] = useState<number>(() => Number(localStorage.getItem("focus_break")) || PRESETS[0].breakMin);
  const [longMin, setLongMin]   = useState<number>(() => Number(localStorage.getItem("focus_long"))  || PRESETS[0].longMin);
  const [cyclesBeforeLong, setCyclesBeforeLong] = useState<number>(() => Number(localStorage.getItem("focus_cycles")) || PRESETS[0].cyclesBeforeLong);

  // runtime
  const [phase, setPhase] = useState<Phase>("focus");
  const [secondsLeft, setSecondsLeft] = useState<number>(focusMin * 60);
  const [running, setRunning] = useState(false);
  const [completedFocus, setCompletedFocus] = useState<number>(() => Number(localStorage.getItem("focus_done")) || 0);

  // options
  const [autoNext, setAutoNext] = useState<boolean>(() => localStorage.getItem("focus_auto") === "1");
  const [chime, setChime] = useState<boolean>(() => localStorage.getItem("focus_chime") !== "0");

  // persist prefs
  useEffect(() => { localStorage.setItem("focus_preset", preset); }, [preset]);
  useEffect(() => {
    localStorage.setItem("focus_focus", String(focusMin));
    localStorage.setItem("focus_break", String(breakMin));
    localStorage.setItem("focus_long",  String(longMin));
    localStorage.setItem("focus_cycles", String(cyclesBeforeLong));
  }, [focusMin, breakMin, longMin, cyclesBeforeLong]);
  useEffect(() => { localStorage.setItem("focus_auto", autoNext ? "1" : "0"); }, [autoNext]);
  useEffect(() => { localStorage.setItem("focus_chime", chime ? "1" : "0"); }, [chime]);
  useEffect(() => { localStorage.setItem("focus_done", String(completedFocus)); }, [completedFocus]);

  // adjust timer when switching preset or editing custom
  useEffect(() => {
    const p = PRESETS.find(p => p.key === preset)!;
    if (preset !== "custom") {
      setFocusMin(p.focusMin);
      setBreakMin(p.breakMin);
      setLongMin(p.longMin);
      setCyclesBeforeLong(p.cyclesBeforeLong);
    }
  }, [preset]);
  useEffect(() => {
    // reset current phase length on config change (only if not running to avoid surprises)
    if (!running) {
      const len = (phase === "focus" ? focusMin : phase === "break" ? breakMin : longMin) * 60;
      setSecondsLeft(len);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMin, breakMin, longMin, phase, running]);

  // timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft(s => {
        if (s > 1) return s - 1;
        // phase finished
        setRunning(false);
        phaseChange();
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  function start() { setRunning(true); }
  function pause() { setRunning(false); }
  function reset() {
    setRunning(false);
    setPhase("focus");
    setSecondsLeft(focusMin * 60);
  }

  function nextPhaseType(after: Phase, nextCycleCount: number): Phase {
    if (after === "focus") {
      if (nextCycleCount > 0 && nextCycleCount % cyclesBeforeLong === 0) return "long";
      return "break";
    }
    // after any break -> back to focus
    return "focus";
  }

  function phaseChange() {
    if (chime) ding();
    if (navigator?.vibrate) { try { navigator.vibrate(120); } catch {} }

    let next: Phase;
    let nextLeft: number;

    if (phase === "focus") {
      const newCount = completedFocus + 1;
      setCompletedFocus(newCount);
      next = nextPhaseType("focus", newCount);
    } else {
      next = "focus";
    }

    nextLeft = (next === "focus" ? focusMin : next === "break" ? breakMin : longMin) * 60;
    setPhase(next);
    setSecondsLeft(nextLeft);

    if (autoNext) setRunning(true);
  }

  function ding() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const beep = (freq: number, t: number) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine"; o.frequency.value = freq;
        o.connect(g); g.connect(ctx.destination);
        o.start();
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t);
        o.stop(ctx.currentTime + t);
      };
      beep(880, 0.12); setTimeout(() => beep(660, 0.14), 140); setTimeout(() => beep(990, 0.16), 320);
    } catch { /* noop */ }
  }

  const currentTotal = (phase === "focus" ? focusMin : phase === "break" ? breakMin : longMin) * 60;
  const progress = 1 - secondsLeft / Math.max(1, currentTotal); // 0..1
  const deg = Math.round(360 * progress);

  return (
    <div className="page-focus">
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Title card with Alfred button */}
        <div className="card" style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open Focus help"
            title="Need a hand? Ask Alfred"
            style={{ position: "absolute", top: 8, right: 8, border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0 }}
          >
            {imgOk ? (
              <img src={FOCUS_ALFRED_SRC} alt="Focus Alfred — open help" style={{ width: 48, height: 48 }} onError={() => setImgOk(false)} />
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700 }}>?</span>
            )}
          </button>

          <h1 style={{ margin: 0 }}>Focus Alfred</h1>
          <div className="muted">Short sprints, proper breaks, consistent wins.</div>
        </div>

        {/* Controls bar (separate card under title) */}
        <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={start} disabled={running} style={{ borderRadius: 8 }}>Start</button>
            <button onClick={pause} disabled={!running}>Pause</button>
            <button onClick={reset}>Reset</button>
          </div>
          <div className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
            {phase === "focus" ? "Focus" : phase === "break" ? "Break" : "Long break"} · {mmss(secondsLeft)}
          </div>
        </div>

        {/* Timer + presets */}
        <div className="card" style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: 16, alignItems: "center" }}>
          {/* Donut timer */}
          <div style={{ display: "grid", placeItems: "center" }}>
            <div
              aria-label="Timer"
              style={{
                width: 220, height: 220, borderRadius: "50%",
                background: `conic-gradient(hsl(var(--pastel-hsl, 210 95% 78%)) ${deg}deg, #e5e7eb 0deg)`,
                position: "relative",
              }}
            >
              <div style={{
                position: "absolute", inset: 10, borderRadius: "50%", background: "#fff",
                display: "grid", placeItems: "center", border: "1px solid #e5e7eb"
              }}>
                <div style={{ textAlign: "center" }}>
                  <div className="muted" style={{ textTransform: "capitalize" }}>{phase === "focus" ? "Focus" : phase === "break" ? "Break" : "Long break"}</div>
                  <div style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mmss(secondsLeft)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Completed: {completedFocus}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Settings */}
          <div style={{ display: "grid", gap: 10 }}>
            <div className="section-title">Preset</div>
            <div style={{ display: "grid", gap: 6 }}>
              {PRESETS.map(p => (
                <label key={p.key} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="radio"
                    name="preset"
                    checked={preset === p.key}
                    onChange={() => setPreset(p.key)}
                  />
                  {p.label}
                </label>
              ))}
            </div>

            {/* Custom inputs */}
            {preset === "custom" && (
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <div className="muted">Focus (min)</div>
                  <input type="number" min={1} max={180} value={focusMin} onChange={e => setFocusMin(clamp(Number(e.target.value) || 1, 1, 180))} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div className="muted">Break (min)</div>
                  <input type="number" min={1} max={60} value={breakMin} onChange={e => setBreakMin(clamp(Number(e.target.value) || 1, 1, 60))} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div className="muted">Long break (min)</div>
                  <input type="number" min={1} max={120} value={longMin} onChange={e => setLongMin(clamp(Number(e.target.value) || 1, 1, 120))} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div className="muted">Long break every</div>
                  <input type="number" min={2} max={12} value={cyclesBeforeLong} onChange={e => setCyclesBeforeLong(clamp(Number(e.target.value) || 2, 2, 12))} />
                </label>
              </div>
            )}

            {/* Options */}
            <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={autoNext} onChange={e => setAutoNext(e.target.checked)} /> Auto-start next phase
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={chime} onChange={e => setChime(e.target.checked)} /> Chime on phase change
              </label>
            </div>
          </div>
        </div>

        {/* Help modal */}
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Focus Alfred — Help">
          <div style={{ display: "flex", gap: 16 }}>
            {imgOk && <img src={FOCUS_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
            <div style={{ flex: 1 }}><FocusHelpContent /></div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
