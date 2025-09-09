// src/FocusAlfredScreen.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

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
function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
function parseIntSafe(s: string) {
  const m = (s ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

/* ---------- Notifications & sound (INLINE to fix build) ---------- */
function playBeep(times = 2, enabled = true) {
  if (!enabled) return;
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
function sendNotification(enabled: boolean, title: string, body: string) {
  if (!enabled) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {}
}

/* ---------- Presets ---------- */
type PresetKey = "pomodoro" | "swift" | "deep" | "custom";
type Preset = {
  key: PresetKey;
  label: string;
  focusMin: number;
  shortMin: number;
  longMin: number;
  cyclesBeforeLong: number;
};
const PRESETS_BASE: Omit<Preset, "label">[] = [
  { key: "pomodoro", focusMin: 25, shortMin: 5, longMin: 15, cyclesBeforeLong: 4 },
  { key: "swift", focusMin: 20, shortMin: 5, longMin: 15, cyclesBeforeLong: 4 },
  { key: "deep", focusMin: 50, shortMin: 10, longMin: 20, cyclesBeforeLong: 2 },
];

/* ---------- Modal ---------- */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 760,
          width: "100%",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.2)",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>
            ✕
          </button>
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
      <p>
        <em>Short, focused bursts with deliberate breaks — perfect for deep work without burnout.</em>
      </p>
      <h4 style={{ margin: 0 }}>How this timer works</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>
          <b>Focus</b> for the set minutes (no context-switching).
        </li>
        <li>
          Take a <b>Short break</b> after each focus cycle.
        </li>
        <li>
          After several cycles, enjoy a <b>Long break</b>.
        </li>
        <li>
          Use a preset or make a <b>Custom</b> one.
        </li>
      </ul>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Shortcuts: <b>Space</b> start/pause • <b>R</b> reset.
      </p>
    </div>
  );
}

/* ---------- Persisted state ---------- */
type Phase = "focus" | "short" | "long";
type SavedState = {
  v: 3;
  presetKey: PresetKey;
  custom: { focusMin: number; shortMin: number; longMin: number; cyclesBeforeLong: number };
  phase: Phase;
  running: boolean;
  cycle: number;
  targetAt: number | null;
  remaining: number;
  autoStartNext: boolean;
  taskTitle: string;
  soundOn: boolean;
  notifOn: boolean;
};
const LS_KEY = "byb:focus_timer_state:v3";

/* ---------- Confetti (light) ---------- */
function ConfettiBurst({ show }: { show: boolean }) {
  if (!show) return null;
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 3000 }}>
      {pieces.map((_, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${(i / pieces.length) * 100}%`,
            top: -10,
            width: 6,
            height: 10,
            borderRadius: 1,
            background: "hsl(var(--pastel-hsl))",
            animation: `fall ${600 + i * 20}ms ease-out forwards`,
          }}
        />
      ))}
      <style>{`@keyframes fall{ to { transform: translateY(100vh) rotate(260deg); opacity:.2; } }`}</style>
    </div>
  );
}

/* ---------- Summary ---------- */
function FocusSummary({ userId }: { userId: string | null }) {
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
      if (error || !data) {
        setTodayMin(0);
        setWeekMin(0);
        return;
      }
      const week = data.reduce((a, x) => a + (x.minutes || 0), 0);
      const today = data
        .filter((x) => new Date(x.started_at) >= new Date(todayStartISO()))
        .reduce((a, x) => a + (x.minutes || 0), 0);
      setWeekMin(week);
      setTodayMin(today);
    };
    load();
  }, [userId]);

  return (
    <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div>
        <strong>Today</strong>: {todayMin} min
      </div>
      <div>
        <strong>This week</strong>: {weekMin} min
      </div>
    </div>
  );
}

/* =========================================================
   Page
   ========================================================= */
export default function FocusAlfredScreen() {
  // preset state
  const [presetKey, setPresetKey] = useState<PresetKey>("pomodoro");
  const [custom, setCustom] = useState({ focusMin: 25, shortMin: 5, longMin: 15, cyclesBeforeLong: 4 });

  // free-typing buffers for custom inputs (allow blanks)
  const [focusStr, setFocusStr] = useState("");
  const [shortStr, setShortStr] = useState("");
  const [longStr, setLongStr] = useState("");
  const [cyclesStr, setCyclesStr] = useState("");

  useEffect(() => {
    if (presetKey === "custom") {
      setFocusStr("");
      setShortStr("");
      setLongStr("");
      setCyclesStr("");
    }
  }, [presetKey]);

  useEffect(() => {
    if (presetKey !== "custom") return;
    if (focusStr === "") setFocusStr(String(custom.focusMin));
    if (shortStr === "") setShortStr(String(custom.shortMin));
    if (longStr === "") setLongStr(String(custom.longMin));
    if (cyclesStr === "") setCyclesStr(String(custom.cyclesBeforeLong));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custom]);

  // commit handlers (focus max 240 min = 4h)
  function commitFocus() {
    const n = parseIntSafe(focusStr);
    if (isNaN(n)) {
      setFocusStr(String(custom.focusMin));
      return;
    }
    const v = clamp(n, 1, 240);
    setCustom((c) => ({ ...c, focusMin: v }));
    setFocusStr(String(v));
  }
  function commitShort() {
    const n = parseIntSafe(shortStr);
    if (isNaN(n)) {
      setShortStr(String(custom.shortMin));
      return;
    }
    const v = clamp(n, 1, 180);
    setCustom((c) => ({ ...c, shortMin: v }));
    setShortStr(String(v));
  }
  function commitLong() {
    const n = parseIntSafe(longStr);
    if (isNaN(n)) {
      setLongStr(String(custom.longMin));
      return;
    }
    const v = clamp(n, 1, 180);
    setCustom((c) => ({ ...c, longMin: v }));
    setLongStr(String(v));
  }
  function commitCycles() {
    const n = parseIntSafe(cyclesStr);
    if (isNaN(n)) {
      setCyclesStr(String(custom.cyclesBeforeLong));
      return;
    }
    const v = clamp(n, 1, 12);
    setCustom((c) => ({ ...c, cyclesBeforeLong: v }));
    setCyclesStr(String(v));
  }

  const presets: Preset[] = useMemo(() => {
    const base = PRESETS_BASE.map((p) => ({
      ...p,
      label: `${p.focusMin} / ${p.shortMin} (x${p.cyclesBeforeLong} → ${p.longMin})`,
    })) as Preset[];
    return [
      ...base,
      {
        key: "custom",
        label: "Custom…",
        focusMin: custom.focusMin,
        shortMin: custom.shortMin,
        longMin: custom.longMin,
        cyclesBeforeLong: custom.cyclesBeforeLong,
      },
    ];
  }, [custom]);

  const currentPreset = useMemo(() => presets.find((pp) => pp.key === presetKey)!, [presets, presetKey]);

  // phase / timing
  const [phase, setPhase] = useState<Phase>("focus");
  const [remaining, setRemaining] = useState(() => currentPreset.focusMin * 60);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [autoStartNext, setAutoStartNext] = useState(true);
  const [currentTaskTitle, setCurrentTaskTitle] = useState("");

  // audio / notifications
  const [soundOn, setSoundOn] = useState(true);
  const [notifOn, setNotifOn] = useState(true);

  // visibility interruption counter
  const [manualDistractions, setManualDistractions] = useState(0);
  const interruptionsRef = useRef(0);

  // absolute deadline for the current phase
  const [targetAt, setTargetAt] = useState<number | null>(null);

  // UI
  const [showHelp, setShowHelp] = useState(false);
  const tickRef = useRef<number | null>(null);
  const notifTimeoutRef = useRef<number | null>(null);

  // wake lock (keep screen awake on mobile)
  const wakeRef = useRef<any>(null);

  // auth (for logging sessions)
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  /* ===== persistence ===== */
  function saveState(toSave?: Partial<SavedState>) {
    const snapshot: SavedState = {
      v: 3,
      presetKey,
      custom,
      phase,
      running,
      cycle,
      targetAt,
      remaining,
      autoStartNext,
      taskTitle: currentTaskTitle,
      soundOn,
      notifOn,
      ...toSave,
    } as SavedState;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
    } catch {}
  }
  function durationFor(ph: Phase, p: Preset) {
    return (ph === "focus" ? p.focusMin : ph === "short" ? p.shortMin : p.longMin) * 60;
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedState;
      if (!parsed || parsed.v !== 3) return;

      setPresetKey(parsed.presetKey);
      setCustom(parsed.custom || custom);
      setPhase(parsed.phase);
      setCycle(parsed.cycle);
      setRunning(parsed.running);
      setAutoStartNext(parsed.autoStartNext ?? true);
      setCurrentTaskTitle(parsed.taskTitle || "");
      setSoundOn(parsed.soundOn ?? true);
      setNotifOn(parsed.notifOn ?? true);

      const now = Date.now();
      if (parsed.running && parsed.targetAt) {
        let ph = parsed.phase;
        let cyc = parsed.cycle;
        let tgt = parsed.targetAt;

        let guard = 0;
        while (tgt <= now && guard < 20) {
          const next = computeNextPhase(ph, cyc, presetByKey(parsed.presetKey, parsed.custom), tgt);
          ph = next.nextPhase;
          cyc = next.nextCycle;
          tgt = next.nextTargetAt;
          guard++;
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
        setRemaining(
          Math.max(0, parsed.remaining || durationFor(parsed.phase, presetByKey(parsed.presetKey, parsed.custom)))
        );
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveState();
  }, [
    presetKey,
    custom,
    phase,
    running,
    cycle,
    targetAt,
    remaining,
    autoStartNext,
    currentTaskTitle,
    soundOn,
    notifOn,
  ]);

  /* ===== wake lock ===== */
  async function requestWakeLock() {
    try {
      // @ts-ignore
      if ("wakeLock" in navigator && (navigator as any).wakeLock?.request) {
        // @ts-ignore
        wakeRef.current = await (navigator as any).wakeLock.request("screen");
      }
    } catch {}
  }
  function releaseWakeLock() {
    try {
      wakeRef.current?.release?.();
      wakeRef.current = null;
    } catch {}
  }
  useEffect(() => {
    if (!running) releaseWakeLock();
  }, [running]);

  /* ===== visibility interruptions ===== */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && phase === "focus" && running) {
        interruptionsRef.current += 1;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phase, running]);

  /* ===== main tick (deadline-based; doesn’t pause when tab changes) ===== */
  useEffect(() => {
    if (!running || !targetAt) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      const now = Date.now();
      const rem = Math.max(0, Math.ceil((targetAt - now) / 1000));
      setRemaining(rem);
      if (rem <= 0) onPhaseEnd();
    }, 1000) as unknown as number;
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, targetAt]);

  /* ===== document title ===== */
  useEffect(() => {
    const label = phase === "focus" ? "Focus" : phase === "short" ? "Short break" : "Long break";
    document.title = running ? `${mmss(remaining)} • ${label}` : "Focus Timer";
  }, [running, remaining, phase]);

  /* ===== reset when preset changes ===== */
  useEffect(() => {
    setRunning(false);
    setPhase("focus");
    setCycle(0);
    setTargetAt(null);
    setRemaining(currentPreset.focusMin * 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey, currentPreset.focusMin]);

  /* ===== boundary notifications ===== */
  function clearBoundaryNotification() {
    if (notifTimeoutRef.current) {
      clearTimeout(notifTimeoutRef.current);
      notifTimeoutRef.current = null;
    }
  }
  function scheduleBoundaryNotification(tgt: number, phaseForLabel?: Phase) {
    clearBoundaryNotification();
    const ms = Math.max(0, tgt - Date.now());
    notifTimeoutRef.current = window.setTimeout(() => {
      const label = phaseForLabel || phase;
      const next = label === "focus" ? "Break time!" : "Back to focus!";
      sendNotification(notifOn, next, label === "focus" ? "Focus block complete" : "Break finished");
      playBeep(2, soundOn);
    }, ms) as unknown as number;
  }

  /* ===== phase transitions ===== */
  function presetByKey(k: PresetKey, customVals?: SavedState["custom"]): Preset {
    if (k !== "custom") {
      const base = PRESETS_BASE.find((p) => p.key === k)!;
      return { ...base, label: "" } as Preset;
    }
    const c = customVals || custom;
    return { key: "custom", label: "Custom…", ...c };
  }
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
      sendNotification(
        notifOn,
        justEnded === "focus" ? "Break time!" : "Back to focus!",
        justEnded === "focus" ? "Focus block complete" : "Break finished"
      );
    }
    playBeep(2, soundOn);

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
          interruptions: interruptionsRef.current + manualDistractions,
          task_title: currentTaskTitle || null,
        });
      } catch {}
      interruptionsRef.current = 0;
      setManualDistractions(0);
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

  /* ===== controls ===== */
  async function start() {
    if (presetKey === "custom") {
      commitFocus();
      commitShort();
      commitLong();
      commitCycles();
    }
    if (notifOn) await ensureNotifPermission().catch(() => {});
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
      if (tag === "INPUT" || tag === "TEXTAREA" || (e as any).isComposing) return;
      if (e.key === " ") {
        e.preventDefault();
        running ? pause() : start();
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        resetAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, phase, remaining, targetAt]);

  return (
    <div className="page-focus">
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card" style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open Focus help"
            title="Help"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              border: "1px solid var(--border)",
              background: "#fff",
              padding: "6px 10px",
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            ?
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
              <select value={presetKey} onChange={(e) => setPresetKey(e.target.value as PresetKey)}>
                {presets.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {presetKey === "custom" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label>
                  Focus{" "}
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="min"
                    value={focusStr}
                    onChange={(e) => setFocusStr(e.target.value)}
                    onBlur={commitFocus}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    }}
                    style={{ width: 70 }}
                    aria-label="Custom focus minutes (max 240)"
                  />
                </label>
                <label>
                  Short{" "}
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="min"
                    value={shortStr}
                    onChange={(e) => setShortStr(e.target.value)}
                    onBlur={commitShort}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    }}
                    style={{ width: 70 }}
                    aria-label="Custom short break minutes"
                  />
                </label>
                <label>
                  Long{" "}
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="min"
                    value={longStr}
                    onChange={(e) => setLongStr(e.target.value)}
                    onBlur={commitLong}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    }}
                    style={{ width: 70 }}
                    aria-label="Custom long break minutes"
                  />
                </label>
                <label>
                  Cycles{" "}
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="x"
                    value={cyclesStr}
                    onChange={(e) => setCyclesStr(e.target.value)}
                    onBlur={commitCycles}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    }}
                    style={{ width: 70 }}
                    aria-label="Cycles before long break"
                  />
                </label>
                <span className="muted" style={{ fontSize: 12 }}>
                  Focus max 240 min (4h)
                </span>
              </div>
            )}

            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={autoStartNext} onChange={(e) => setAutoStartNext(e.target.checked)} />
              Auto-start next
            </label>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
              Sound
            </label>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={notifOn} onChange={(e) => setNotifOn(e.target.checked)} />
              Notifications
            </label>

            <span className="badge" title="Completed focus cycles in this set">
              Cycles: {cycle}/{currentPreset.cyclesBeforeLong}
            </span>
            <span className="badge" style={{ background: "#eef2ff", border: "1px solid var(--border)" }}>
              {phase === "focus" ? "Focus" : phase === "short" ? "Short break" : "Long break"}
            </span>

            <div style={{ flex: 1 }} />

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted">Task</span>
              <input
                value={currentTaskTitle}
                onChange={(e) => setCurrentTaskTitle(e.target.value)}
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
                <button className="btn-primary" onClick={start} style={{ borderRadius: 8 }}>
                  Start
                </button>
              ) : (
                <button onClick={pause}>Pause</button>
              )}
              <button onClick={resetAll}>Reset</button>
              {phase !== "focus" && <button onClick={() => onPhaseEnd()}>Skip break</button>}
              <button
                onClick={() => {
                  const extra = 5 * 60;
                  if (running && targetAt) setTargetAt(targetAt + extra * 1000);
                  setRemaining((r) => r + extra);
                }}
              >
                +5 min
              </button>
              <button onClick={() => setManualDistractions((n) => n + 1)} title="Log a distraction">
                Distraction +
              </button>
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

          {/* Distraction count display */}
          <div className="muted" style={{ fontSize: 12 }}>
            Logged distractions this focus block: {manualDistractions + (phase === "focus" ? interruptionsRef.current : 0)}
          </div>
        </div>

        {/* Summary */}
        <FocusSummary userId={userId} />

        {/* Help modal */}
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Focus — Help">
          <FocusHelpContent />
        </Modal>
      </div>

      <ConfettiBurst show={celebrate} />
    </div>
  );
}
