import { useEffect, useState, type ReactNode } from "react";

/* ---------- Public path helper ---------- */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}
const ALFRED_CANDIDATES = [
  "/alfred/imer_Alfred.png",         // as provided
  "/alfred/IMER_Alfred.png",         // case variants just in case
  "/alfred/timer_Alfred.png",
  "/alfred/Timer_Alfred.png",
].map(publicPath);

/* ---------- Types & helpers ---------- */
type Phase = "focus" | "short" | "long";
type PresetKey = "pomodoro" | "flow" | "hyper" | "custom";

type Preset = {
  key: PresetKey;
  label: string;
  focusMin: number;
  shortMin: number;
  longMin: number;
  cycles: number; // focus blocks before a long break
};

const PRESETS: Preset[] = [
  { key: "pomodoro", label: "Pomodoro 25/5", focusMin: 25, shortMin: 5, longMin: 15, cycles: 4 },
  { key: "flow",     label: "Flow 50/10",    focusMin: 50, shortMin: 10, longMin: 15, cycles: 3 },
  { key: "hyper",    label: "Hyperfocus 60", focusMin: 60, shortMin: 0,  longMin: 0,  cycles: 1 },
];

function mmss(total: number) {
  const m = Math.floor(Math.max(0, total) / 60);
  const s = Math.max(0, total) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/* ---------- Tiny modal ---------- */
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 2000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(760px, 92vw)", background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Inline help ---------- */
function FocusHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Focus Alfred is a simple Pomodoro-style timer with options for deeper work.</em></p>

      <h4 style={{ margin: 0 }}>Presets</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pomodoro 25/5</b> — four 25-min focus blocks with 5-min breaks, then a longer 15-min break.</li>
        <li><b>Flow 50/10</b> — longer 50-min focus sprints with 10-min breaks.</li>
        <li><b>Hyperfocus 60</b> — one uninterrupted 60-minute block (no automatic breaks).</li>
      </ul>

      <h4 style={{ margin: 0 }}>Controls</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Start</b>, <b>Pause</b>, <b>Reset</b>, or <b>Skip</b> the current segment.</li>
        <li>Toggle <b>Auto-start next</b> to flow between focus/breaks without clicking.</li>
        <li><b>Chime</b> plays a gentle beep when a segment ends. <b>Desktop notifications</b> are optional.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Have a single clear task before you press Start.</li>
        <li>During breaks: stand up, breathe, water, no scrolling.</li>
        <li>If you get interrupted, hit Pause (don’t punish yourself—just resume).</li>
      </ul>
    </div>
  );
}

/* ===================================================================== */

export default function FocusAlfredScreen() {
  // Alfred image
  const [imgIdx, setImgIdx] = useState(0);

  // Timer state
  const [presetKey, setPresetKey] = useState<PresetKey>(() => {
    return (localStorage.getItem("byb_focus_preset") as PresetKey) || "pomodoro";
  });
  const currentPreset = PRESETS.find(p => p.key === presetKey) || PRESETS[0];

  const [phase, setPhase] = useState<Phase>("focus");
  const [cycle, setCycle] = useState(1); // 1..preset.cycles
  const [remaining, setRemaining] = useState(currentPreset.focusMin * 60);
  const [running, setRunning] = useState(false);

  // Options
  const [autoNext, setAutoNext] = useState<boolean>(() => localStorage.getItem("byb_focus_autonext") === "1");
  const [chime, setChime] = useState<boolean>(() => localStorage.getItem("byb_focus_chime") !== "0");
  const [notify, setNotify] = useState<boolean>(() => localStorage.getItem("byb_focus_notify") === "1");

  // Help modal
  const [showHelp, setShowHelp] = useState(false);

  // persist a few things
  useEffect(() => { localStorage.setItem("byb_focus_preset", presetKey); }, [presetKey]);
  useEffect(() => { localStorage.setItem("byb_focus_autonext", autoNext ? "1" : "0"); }, [autoNext]);
  useEffect(() => { localStorage.setItem("byb_focus_chime", chime ? "1" : "0"); }, [chime]);
  useEffect(() => { localStorage.setItem("byb_focus_notify", notify ? "1" : "0"); }, [notify]);

  // Tick
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setRemaining((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Phase change on zero
  useEffect(() => {
    if (remaining > 0) return;
    // chime + notify
    if (chime) beep();
    if (notify) maybeNotify(phase === "focus" ? "Focus complete" : "Break complete");

    // decide next
    const next = nextPhase(phase, cycle, currentPreset);
    setPhase(next.phase);
    setCycle(next.cycle);
    setRemaining(next.seconds);

    if (!autoNext) setRunning(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  // when preset changes, reset to start of flow
  useEffect(() => {
    setPhase("focus");
    setCycle(1);
    setRemaining(currentPreset.focusMin * 60);
    setRunning(false);
  }, [presetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() { setRunning(true); }
  function pause() { setRunning(false); }
  function reset() {
    setRunning(false);
    setPhase("focus");
    setCycle(1);
    setRemaining(currentPreset.focusMin * 60);
  }
  function skip() {
    setRemaining(0); // will trigger next phase effect
  }

  return (
    <div className="page-focus-alfred" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header with Alfred help button */}
        <div className="card" style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open Focus help"
            title="Need a hand? Ask Alfred"
            style={{
              position: "absolute", top: 8, right: 8,
              border: "none", background: "transparent", padding: 0,
              cursor: "pointer", lineHeight: 0, zIndex: 10,
            }}
          >
            <img
              src={ALFRED_CANDIDATES[Math.min(imgIdx, ALFRED_CANDIDATES.length - 1)]}
              alt="Focus Alfred — open help"
              style={{ width: 48, height: 48 }}
              onError={() => { if (imgIdx < ALFRED_CANDIDATES.length - 1) setImgIdx(imgIdx + 1); }}
            />
          </button>

          <h1 style={{ margin: 0 }}>Focus Alfred</h1>
          <div className="muted">Structured sprints to get important work done.</div>
        </div>

        {/* Presets */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="section-title">Presets</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRESETS.map(p => {
              const active = presetKey === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setPresetKey(p.key)}
                  aria-pressed={active}
                  className="card"
                  style={{
                    padding: 10,
                    borderColor: active ? "hsl(var(--pastel-hsl))" : "var(--border)",
                    background: active ? "hsl(var(--pastel-hsl) / .45)" : "var(--card)",
                    color: active ? "var(--on-pastel)" : "var(--text)",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.label}</div>
                  <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>
                    {p.focusMin}m focus · {p.shortMin}m break · {p.cycles} cycle{p.cycles>1?"s":""}
                    {p.longMin ? ` · ${p.longMin}m long break` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Timer panel */}
        <div className="card" style={{ display: "grid", gap: 12 }}>
          {/* Big timer */}
          <div style={{ display: "grid", placeItems: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1 }}>{mmss(remaining)}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              {phase === "focus" ? `Focus ${cycle}/${currentPreset.cycles}` :
               phase === "short" ? "Short break" : "Long break"}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 8, background: "#eef2f7", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progressPct(phase, remaining, currentPreset, cycle)}%`,
                background: "hsl(var(--pastel-hsl, 210 95% 78%))",
                transition: "width .35s linear",
              }}
            />
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!running ? (
              <button className="btn-primary" onClick={start} style={{ borderRadius: 8 }}>Start</button>
            ) : (
              <button onClick={pause}>Pause</button>
            )}
            <button onClick={reset}>Reset</button>
            <button onClick={skip} title="Skip current segment">Skip</button>

            <div style={{ marginLeft: "auto", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={autoNext} onChange={e => setAutoNext(e.target.checked)} />
                Auto-start next
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={chime} onChange={e => setChime(e.target.checked)} />
                Chime
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={async e => {
                    const v = e.target.checked;
                    if (v && "Notification" in window) {
                      try { if (Notification.permission === "default") await Notification.requestPermission(); } catch {}
                    }
                    setNotify(v);
                  }}
                />
                Desktop notifications
              </label>
            </div>
          </div>
        </div>

        {/* Help modal */}
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Focus Alfred — Help">
          <div style={{ display: "flex", gap: 16 }}>
            <img
              src={ALFRED_CANDIDATES[0]}
              alt=""
              aria-hidden="true"
              style={{ width: 72, height: 72, flex: "0 0 auto" }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <FocusHelpContent />
          </div>
        </Modal>
      </div>
    </div>
  );
}

/* ---------- Flow engine ---------- */
function nextPhase(cur: Phase, cycle: number, p: Preset) {
  // returns { phase, cycle, seconds }
  const mins = (m: number) => clamp(m, 0, 600) * 60;

  if (cur === "focus") {
    // finished a focus block
    // if more cycles remain → short break; if not → long break (if any) then wrap
    if (cycle < p.cycles && p.shortMin > 0) {
      return { phase: "short" as Phase, cycle, seconds: mins(p.shortMin) };
    }
    if (cycle >= p.cycles && p.longMin > 0) {
      return { phase: "long" as Phase, cycle, seconds: mins(p.longMin) };
    }
    // otherwise, go straight to next focus
    return { phase: "focus" as Phase, cycle: Math.min(p.cycles, cycle + 1), seconds: mins(p.focusMin) };
  }

  if (cur === "short") {
    // come back to next focus (increment cycle)
    const nextCycle = clamp(cycle + 1, 1, p.cycles);
    return { phase: "focus" as Phase, cycle: nextCycle, seconds: mins(p.focusMin) };
  }

  // cur === "long"
  return { phase: "focus" as Phase, cycle: 1, seconds: mins(p.focusMin) };
}

function progressPct(phase: Phase, remaining: number, p: Preset, cycle: number) {
  const total =
    phase === "focus" ? p.focusMin * 60 :
    phase === "short" ? p.shortMin * 60 :
    p.longMin * 60;
  if (total <= 0) return 0;
  const done = clamp(1 - remaining / total, 0, 1);
  return Math.round(done * 100);
}

/* ---------- Beep & notifications ---------- */
function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start(); o.stop(ctx.currentTime + 0.26);
  } catch {}
}
function maybeNotify(title: string) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") new Notification(title);
  } catch {}
}
