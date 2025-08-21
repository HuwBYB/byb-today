import { useEffect, useRef, useState, type ReactNode, useMemo } from "react";
import { supabase } from "./lib/supabaseClient";

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
const FOCUS_ALFRED_SRC = publicPath("/alfred/imer_Alfred.png");

/* ---------- Tiny helpers ---------- */
function mmss(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
function todayStartISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfWeekMondayISO() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/* ---------- Presets ---------- */
type PresetKey = "pomodoro" | "swift" | "deep";
type Preset = {
  key: PresetKey;
  label: string;
  focusMin: number;
  shortMin: number;
  longMin: number;
  cyclesBeforeLong: number;
};

const PRESETS: Preset[] = [
  { key: "pomodoro", label: "25 / 5 (x4 → 15)", focusMin: 25, shortMin: 5, longMin: 15, cyclesBeforeLong: 4 },
  { key: "swift",    label: "20 / 5 (x4 → 15)", focusMin: 20, shortMin: 5, longMin: 15, cyclesBeforeLong: 4 },
  { key: "deep",     label: "50 / 10 (x2 → 20)", focusMin: 50, shortMin: 10, longMin: 20, cyclesBeforeLong: 2 },
];
function presetByKey(k: PresetKey): Preset { return PRESETS.find(p => p.key === k)!; }

/* ---------- Modal ---------- */
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
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 2000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, width: "100%", background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Help content ---------- */
function FocusHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Short, focused bursts with deliberate breaks — perfect for deep work and avoiding burnout.</em></p>
      <h4 style={{ margin: 0 }}>How this timer works</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Focus</b> for the set minutes (don’t switch tasks).</li>
        <li>Take a <b>Short break</b> after each focus cycle.</li>
        <li>After several cycles, enjoy a <b>Long break</b>.</li>
        <li>Use presets: <b>25/5</b> classic Pomodoro, <b>20/5</b> swift, or <b>50/10</b> deep focus.</li>
      </ul>
      <h4 style={{ margin: 0 }}>Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Type a task to anchor your session, then Start.</li>
        <li>Breaks are for movement/water — not doomscrolling.</li>
      </ul>
    </div>
  );
}

/* ---------- Persisted state ---------- */
type Phase = "focus" | "short" | "long";
type SavedState = {
  v: 2;
  presetKey: PresetKey;
  phase: Phase;
  running: boolean;
  cycle: number;
  targetAt: number | null; // epoch ms when current phase ends (if running)
  remaining: number;        // seconds remaining when last saved (used if paused)
  autoStartNext: boolean;
  taskTitle: string;
};
const LS_KEY = "byb:focus_timer_state:v2";

/* ---- utils: sound + notifications ---- */
function playBeep(times = 2) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let t = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.26);
      t += 0.32;
    }
  } catch {}
}

async function ensureNotifPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const res = await Notification.requestPermission();
  return res === "granted";
}
function sendNotification(title: string, body: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: FOCUS_ALFRED_SRC, badge: FOCUS_ALFRED_SRC });
  } catch {}
}

/* ---------- Confetti (light) ---------- */
function ConfettiBurst({ show }:{ show:boolean }) {
  if (!show) return null;
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden
      style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:3000 }}>
      {pieces.map((_, i) => (
        <span key={i}
          style={{
            position:"absolute",
            left: `${(i / pieces.length) * 100}%`,
            top: -10,
            width:6, height:10, borderRadius:1,
            background:"hsl(var(--pastel-hsl))",
            animation: `fall ${600 + i*20}ms ease-out forwards`,
          }}/>
      ))}
      <style>{`@keyframes fall{ to { transform: translateY(100vh) rotate(260deg); opacity:.2; } }`}</style>
    </div>
  );
}

/* ---------- Summary component ---------- */
function FocusSummary({ userId }:{ userId: string | null }) {
  const [todayMin, setTodayMin] = useState(0);
  const [weekMin, setWeekMin] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const sinceWeek = startOfWeekMondayISO();
      const { data, error } = await supabase
        .from("focus_sessions")
        .select("minutes, started_at")
        .eq("user_id", userId)
        .gte("started_at", sinceWeek)
        .order("started_at", { ascending: false });
      if (error || !data) { setTodayMin(0); setWeekMin(0); return; }
      const week = data.reduce((a, x) => a + (x.minutes || 0), 0);
      const today = data.filter(x => new Date(x.started_at) >= new Date(todayStartISO()))
                        .reduce((a, x) => a + (x.minutes || 0), 0);
      setWeekMin(week); setTodayMin(today);
    };
    load();
  }, [userId]);

  return (
    <div className="card" style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
      <div><strong>Today</strong>: {todayMin} min</div>
      <div><strong>This week</strong>: {weekMin} min</div>
    </div>
  );
}

/* ---------- Page ---------- */
export default function FocusScreen() {
  const [presetKey, setPresetKey] = useState<PresetKey>("pomodoro");
  const [phase, setPhase] = useState<Phase>("focus");
  const [remaining, setRemaining] = useState(() => presetByKey("pomodoro").focusMin * 60);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(0); // completed focus blocks in the current set
  const [autoStartNext, setAutoStartNext] = useState(true);
  const [currentTaskTitle, setCurrentTaskTitle] = useState("");

  // deadline for current phase (epoch ms). Used to keep time while backgrounded.
  const [targetAt, setTargetAt] = useState<number | null>(null);

  // Help & image
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  const currentPreset = useMemo(() => presetByKey(presetKey), [presetKey]);

  // timers/handles
  const tickRef = useRef<number | null>(null);
  const notifTimeoutRef = useRef<number | null>(null);

  // wake lock & interruptions
  const wakeRef = useRef<any>(null);
  const interruptionsRef = useRef(0);

  // auth (for logging sessions)
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({data}) => setUserId(data.user?.id ?? null)); }, []);

  /* ====== persistence ====== */
  function saveState(toSave?: Partial<SavedState>) {
    const snapshot: SavedState = {
      v: 2,
      presetKey,
      phase,
      running,
      cycle,
      targetAt,
      remaining,
      autoStartNext,
      taskTitle: currentTaskTitle,
      ...toSave,
    } as SavedState;
    try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot)); } catch {}
  }
  function durationFor(ph: Phase, p: Preset) {
    return (ph === "focus" ? p.focusMin : ph === "short" ? p.shortMin : p.longMin) * 60;
  }

  // Restore on mount and catch up across missed boundaries
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedState;
      if (!parsed || parsed.v !== 2) return;

      setPresetKey(parsed.presetKey);
      setPhase(parsed.phase);
      setCycle(parsed.cycle);
      setRunning(parsed.running);
      setAutoStartNext(parsed.autoStartNext ?? true);
      setCurrentTaskTitle(parsed.taskTitle || "");

      const now = Date.now();
      if (parsed.running && parsed.targetAt) {
        let ph = parsed.phase;
        let cyc = parsed.cycle;
        let tgt = parsed.targetAt;

        let guard = 0;
        while (tgt <= now && guard < 20) {
          const next = computeNextPhase(ph, cyc, presetByKey(parsed.presetKey), tgt);
          ph = next.nextPhase; cyc = next.nextCycle; tgt = next.nextTargetAt; guard++;
        }

        setPhase(ph);
        setCycle(cyc);
        setTargetAt(tgt);
        const rem = Math.max(0, Math.ceil((tgt - now) / 1000));
        setRemaining(rem);
        scheduleBoundaryNotification(tgt, ph);
        setRunning(true);
      } else {
        setTargetAt(null);
        setRemaining(Math.max(0, parsed.remaining || durationFor(parsed.phase, presetByKey(parsed.presetKey))));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on changes
  useEffect(() => { saveState(); }, [presetKey, phase, running, cycle, targetAt, remaining, autoStartNext, currentTaskTitle]);

  /* ====== wake lock ====== */
  async function requestWakeLock() {
    try {
      // @ts-ignore
      if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
        // @ts-ignore
        wakeRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {}
  }
  function releaseWakeLock() { try { wakeRef.current?.release?.(); wakeRef.current = null; } catch {} }
  useEffect(() => { if (!running) releaseWakeLock(); }, [running]);

  /* ====== visibility interruptions ====== */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && phase === 'focus' && running) {
        interruptionsRef.current += 1;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, running]);

  /* ====== main tick ====== */
  useEffect(() => {
    if (!running || !targetAt) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    tickRef.current = window.setInterval(() => {
      const now = Date.now();
      const rem = Math.max(0, Math.ceil((targetAt - now) / 1000));
      setRemaining(rem);
      if (rem <= 0) onPhaseEnd();
    }, 1000) as unknown as number;
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, targetAt]);

  // Update title while running
  useEffect(() => {
    const label = phase === "focus" ? "Focus" : phase === "short" ? "Short break" : "Long break";
    document.title = running ? `${mmss(remaining)} • ${label}` : "Focus Timer";
  }, [running, remaining, phase]);

  // Reset when preset changes
  useEffect(() => {
    setRunning(false);
    setPhase("focus");
    setCycle(0);
    setTargetAt(null);
    setRemaining(currentPreset.focusMin * 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  /* ====== boundary notifications ====== */
  function clearBoundaryNotification() {
    if (notifTimeoutRef.current) { clearTimeout(notifTimeoutRef.current); notifTimeoutRef.current = null; }
  }
  function scheduleBoundaryNotification(tgt: number, phaseForLabel?: Phase) {
    clearBoundaryNotification();
    const ms = Math.max(0, tgt - Date.now());
    notifTimeoutRef.current = window.setTimeout(() => {
      const label = phaseForLabel || phase;
      const next = label === "focus" ? "Break time!" : "Back to focus!";
      sendNotification(next, label === "focus" ? "Focus block complete" : "Break finished");
      playBeep(2);
    }, ms) as unknown as number;
  }

  /* ====== phase transitions ====== */
  function computeNextPhase(ph: Phase, cyc: number, p: Preset, endedAtMs: number) {
    if (ph === "focus") {
      const nextCycle = cyc + 1;
      const useLong = nextCycle >= p.cyclesBeforeLong;
      const nextPhase: Phase = useLong ? "long" : "short";
      const dur = useLong ? p.longMin * 60 : p.shortMin * 60;
      const nextTargetAt = endedAtMs + dur * 1000;
      return { nextPhase, nextCycle: useLong ? 0 : nextCycle, nextTargetAt };
    }
    const nextPhase: Phase = "focus";
    const dur = p.focusMin * 60;
    const nextTargetAt = endedAtMs + dur * 1000;
    return { nextPhase, nextCycle: cyc, nextTargetAt };
  }

  const [celebrate, setCelebrate] = useState(false);

  async function onPhaseEnd() {
    const justEnded = phase;

    // Notify if not on page
    if (document.visibilityState !== "visible") {
      sendNotification(justEnded === "focus" ? "Break time!" : "Back to focus!", justEnded === "focus" ? "Focus block complete" : "Break finished");
    }
    playBeep(2);

    // Log focus session
    if (justEnded === "focus" && userId) {
      try {
        await supabase.from("focus_sessions").insert({
          user_id: userId,
          started_at: new Date(Date.now() - currentPreset.focusMin * 60 * 1000).toISOString(),
          ended_at: new Date().toISOString(),
          phase: "focus",
          preset: presetKey,
          minutes: currentPreset.focusMin,
          interruptions: interruptionsRef.current,
          task_title: currentTaskTitle || null,
        });
      } catch {}
      interruptionsRef.current = 0;
      setCelebrate(true);
      if ((navigator as any).vibrate) (navigator as any).vibrate(8);
      setTimeout(() => setCelebrate(false), 900);
    }

    const now = Date.now();
    const { nextPhase, nextCycle, nextTargetAt } = computeNextPhase(justEnded, cycle, currentPreset, now);

    setPhase(nextPhase);
    setCycle(nextCycle);

    if (autoStartNext) {
      setTargetAt(nextTargetAt);
      setRunning(true);
      setRemaining(Math.max(0, Math.ceil((nextTargetAt - now) / 1000)));
      scheduleBoundaryNotification(nextTargetAt, nextPhase);
    } else {
      setTargetAt(null);
      setRunning(false);
      setRemaining(durationFor(nextPhase, currentPreset));
      clearBoundaryNotification();
    }
  }

  /* ====== controls ====== */
  async function start() {
    await ensureNotifPermission().catch(()=>{});
    await requestWakeLock();
    const base = remaining > 0 ? remaining : durationFor(phase, currentPreset);
    const tgt = Date.now() + base * 1000;
    setTargetAt(tgt);
    setRunning(true);
    scheduleBoundaryNotification(tgt, phase);
  }
  function pause() {
    if (running && targetAt) {
      const rem = Math.max(0, Math.ceil((targetAt - Date.now()) / 1000));
      setRemaining(rem);
    }
    setRunning(false);
    setTargetAt(null);
    clearBoundaryNotification();
    releaseWakeLock();
  }
  function resetAll() {
    setRunning(false);
    setPhase("focus");
    setCycle(0);
    setTargetAt(null);
    setRemaining(currentPreset.focusMin * 60);
    clearBoundaryNotification();
    releaseWakeLock();
  }
  function progressPct(ph: Phase, rem: number, p: Preset) {
    const total = (ph === "focus" ? p.focusMin : ph === "short" ? p.shortMin : p.longMin) * 60;
    if (total <= 0) return 0;
    const done = Math.max(0, Math.min(1, 1 - rem / total));
    return Math.round(done * 100);
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e as any).isComposing) return;
      if (e.key === ' ') { e.preventDefault(); running ? pause() : start(); }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, phase, remaining, targetAt]);

  // Optional mini PiP
  async function openMiniTimer() {
    // @ts-ignore
    const dip = (window as any).documentPictureInPicture;
    if (!dip?.requestWindow) return;
    const pip = await dip.requestWindow({ width: 220, height: 120 });
    const el = pip.document.createElement('div');
    el.style.cssText = 'font: 700 28px system-ui; display:grid; place-items:center; height:100%;';
    pip.document.body.style.margin = "0";
    pip.document.body.appendChild(el);
    const i = setInterval(() => { el.textContent = mmss(remaining); }, 250);
    pip.addEventListener('pagehide', () => clearInterval(i));
  }

  return (
    <div className="page-focus">
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Title + Alfred button */}
        <div className="card" style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open Focus help"
            title="Need a hand? Ask Alfred"
            style={{ position: "absolute", top: 8, right: 8, border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10 }}
          >
            {imgOk ? (
              <img
                src={FOCUS_ALFRED_SRC}
                alt="Focus Alfred — open help"
                style={{ width: 48, height: 48 }}
                onError={() => setImgOk(false)}
              />
            ) : (
              <span
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700,
                }}
              >?</span>
            )}
          </button>

          <h1 style={{ margin: 0 }}>Focus Timer</h1>
          <div className="muted">Deep work intervals with smart breaks.</div>
        </div>

        {/* Controls row */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          {/* Preset & status */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="muted">Preset</span>
              <select value={presetKey} onChange={e => setPresetKey(e.target.value as PresetKey)}>
                {PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>

            <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <input type="checkbox" checked={autoStartNext} onChange={e => setAutoStartNext(e.target.checked)} />
              Auto-start next phase
            </label>

            <span className="badge" title="Completed focus cycles in this set">Cycles: {cycle}/{currentPreset.cyclesBeforeLong}</span>
            <span className="badge" style={{ background: "#eef2ff", border: "1px solid var(--border)" }}>
              {phase === "focus" ? "Focus" : phase === "short" ? "Short break" : "Long break"}
            </span>

            <div style={{ flex: 1 }} />

            <label style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span className="muted">Task</span>
              <input
                value={currentTaskTitle}
                onChange={e=>setCurrentTaskTitle(e.target.value)}
                placeholder="Optional: what are you focusing on?"
                style={{ minWidth: 220 }}
              />
            </label>
          </div>

          {/* Timer + actions */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: 1, minWidth: 110, textAlign: "right" }}>
              {mmss(remaining)}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!running ? (
                <button className="btn-primary" onClick={start} style={{ borderRadius: 8 }}>Start</button>
              ) : (
                <button onClick={pause}>Pause</button>
              )}
              <button onClick={resetAll}>Reset</button>
              {phase !== "focus" && <button onClick={() => onPhaseEnd()}>Skip break</button>}
              <button onClick={() => {
                const extra = 5 * 60;
                if (running && targetAt) setTargetAt(targetAt + extra * 1000);
                setRemaining(r => r + extra);
              }}>+5 min</button>
              <button onClick={openMiniTimer} title="Floating mini-timer (Chrome)">Mini</button>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ height: 10, borderRadius: 999, border: "1px solid var(--border)", background: "#f8fafc", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${progressPct(phase, remaining, currentPreset)}%`,
                    background: "hsl(var(--pastel-hsl, 210 95% 78%))",
                    transition: "width .35s linear",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <FocusSummary userId={userId} />

        {/* Guidance */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div className="section-title">How to use</div>
          <ul className="list" style={{ margin: 0 }}>
            <li>Pick a preset that matches your energy.</li>
            <li>Choose one task — close other tabs — hit Start.</li>
            <li>Breaks are for movement or water. After a few cycles, enjoy the longer break.</li>
          </ul>
        </div>

        {/* Help modal */}
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Focus — Help">
          <div style={{ display: "flex", gap: 16 }}>
            {imgOk && <img src={FOCUS_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
            <div style={{ flex: 1 }}>
              <FocusHelpContent />
            </div>
          </div>
        </Modal>
      </div>

      <ConfettiBurst show={celebrate} />
    </div>
  );
}
