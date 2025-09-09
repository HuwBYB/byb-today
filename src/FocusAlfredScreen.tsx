// src/FocusScreen.tsx
import { useEffect, useRef, useState, type ReactNode, useMemo } from "react";
import { supabase } from "./lib/supabaseClient";

/* =========================================================
   Small, app-wide Focus Service (singleton on window)
   Keeps ticking even when this screen unmounts (mobile-friendly)
   ========================================================= */
type Phase = "focus" | "short" | "long";
type PresetKey = "pomodoro" | "swift" | "deep" | "custom";
type PresetVals = { focusMin: number; shortMin: number; longMin: number; cyclesBeforeLong: number };

type ServiceSnapshot = {
  v: 1;
  running: boolean;
  phase: Phase;
  cycle: number;
  targetAt: number | null;       // epoch ms
  remaining: number;             // seconds
  presetKey: PresetKey;
  custom: PresetVals;
  autoStartNext: boolean;
  taskTitle: string;
};

type Service = {
  get(): ServiceSnapshot;
  start(): void;
  pause(): void;
  resetToPreset(presetKey: PresetKey, custom: PresetVals): void;
  setAutoStartNext(v: boolean): void;
  setTaskTitle(t: string): void;
  applyCustom(custom: PresetVals): void;
  setPresetKey(k: PresetKey): void;
  // lifecycle (internal)
};

const PRESETS_BASE: { key: Exclude<PresetKey, "custom">; focusMin: number; shortMin: number; longMin: number; cyclesBeforeLong: number }[] = [
  { key: "pomodoro", focusMin: 25, shortMin: 5,  longMin: 15, cyclesBeforeLong: 4 },
  { key: "swift",    focusMin: 20, shortMin: 5,  longMin: 15, cyclesBeforeLong: 4 },
  { key: "deep",     focusMin: 50, shortMin: 10, longMin: 20, cyclesBeforeLong: 2 },
];

const LS_SERVICE_KEY = "byb:focus_service_state:v1";

function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }
function nowSecToTarget(targetAt: number) { return Math.max(0, Math.ceil((targetAt - Date.now()) / 1000)); }
function durationFor(ph: Phase, p: PresetVals) {
  return (ph === "focus" ? p.focusMin : ph === "short" ? p.shortMin : p.longMin) * 60;
}
function presetByKey(key: PresetKey, custom: PresetVals): PresetVals {
  if (key === "custom") return custom;
  const base = PRESETS_BASE.find(b => b.key === key)!;
  return { focusMin: base.focusMin, shortMin: base.shortMin, longMin: base.longMin, cyclesBeforeLong: base.cyclesBeforeLong };
}
function computeNext(ph: Phase, cycle: number, p: PresetVals, endedAtMs: number) {
  if (ph === "focus") {
    const nextCycle = cycle + 1;
    const useLong = nextCycle >= p.cyclesBeforeLong;
    const nextPhase: Phase = useLong ? "long" : "short";
    const dur = useLong ? p.longMin * 60 : p.shortMin * 60;
    const nextTargetAt = endedAtMs + dur * 1000;
    return { phase: nextPhase, cycle: useLong ? 0 : nextCycle, targetAt: nextTargetAt };
  }
  const dur = p.focusMin * 60;
  return { phase: "focus" as Phase, cycle, targetAt: endedAtMs + dur * 1000 };
}

declare global {
  interface Window { __BYB_FOCUS_SERVICE__?: Service; }
}

function initService(): Service {
  if (window.__BYB_FOCUS_SERVICE__) return window.__BYB_FOCUS_SERVICE__;
  // restore or defaults
  let state: ServiceSnapshot = (() => {
    try {
      const raw = localStorage.getItem(LS_SERVICE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as ServiceSnapshot;
        if (s && s.v === 1) {
          // if it was running, recompute remaining and fast-forward phases if needed
          if (s.running && s.targetAt) {
            const p = presetByKey(s.presetKey, s.custom);
            let ph = s.phase, cyc = s.cycle, tgt = s.targetAt, guard = 0;
            while (tgt <= Date.now() && guard++ < 50) {
              const next = computeNext(ph, cyc, p, tgt);
              ph = next.phase; cyc = next.cycle; tgt = next.targetAt;
            }
            const rem = nowSecToTarget(tgt);
            return { ...s, phase: ph, cycle: cyc, targetAt: tgt, remaining: rem, running: true };
          }
          const p = presetByKey(s.presetKey, s.custom);
          const rem = Math.max(0, s.remaining || durationFor(s.phase, p));
          return { ...s, remaining: rem, running: false, targetAt: null };
        }
      }
    } catch {}
    return {
      v: 1, running: false, phase: "focus", cycle: 0, targetAt: null, remaining: PRESETS_BASE[0].focusMin * 60,
      presetKey: "pomodoro", custom: { focusMin: 25, shortMin: 5, longMin: 15, cyclesBeforeLong: 4 },
      autoStartNext: true, taskTitle: ""
    };
  })();

  // single interval ticker
  let intervalId: number | null = null;

  function save() {
    try { localStorage.setItem(LS_SERVICE_KEY, JSON.stringify(state)); } catch {}
  }
  function broadcast() {
    window.dispatchEvent(new CustomEvent("byb:focus:update", { detail: state }));
  }
  function schedule() {
    if (intervalId !== null || !state.running || !state.targetAt) return;
    intervalId = window.setInterval(() => {
      if (!state.running || !state.targetAt) return;
      const rem = nowSecToTarget(state.targetAt);
      state = { ...state, remaining: rem };
      if (rem <= 0) {
        // phase end
        const p = presetByKey(state.presetKey, state.custom);
        const ended = state.phase;
        const now = Date.now();
        const next = computeNext(ended, state.cycle, p, now);
        if (state.autoStartNext) {
          const rem2 = nowSecToTarget(next.targetAt);
          state = { ...state, phase: next.phase, cycle: next.cycle, targetAt: next.targetAt, remaining: rem2, running: true };
        } else {
          state = { ...state, phase: next.phase, cycle: next.cycle, targetAt: null, remaining: durationFor(next.phase, p), running: false };
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
        }
        save();
        broadcast();
        window.dispatchEvent(new CustomEvent("byb:focus:ended", { detail: { phase: ended } }));
        return;
      }
      save();
      broadcast();
    }, 1000) as unknown as number;
  }
  function start() {
    if (state.running) return;
    const p = presetByKey(state.presetKey, state.custom);
    const base = state.remaining > 0 ? state.remaining : durationFor(state.phase, p);
    const tgt = Date.now() + base * 1000;
    state = { ...state, running: true, targetAt: tgt };
    save(); broadcast(); schedule();
  }
  function pause() {
    if (!state.running) return;
    const rem = state.targetAt ? nowSecToTarget(state.targetAt) : state.remaining;
    state = { ...state, running: false, targetAt: null, remaining: rem };
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    save(); broadcast();
  }
  function resetToPreset(presetKey: PresetKey, custom: PresetVals) {
    const p = presetByKey(presetKey, custom);
    state = {
      ...state,
      presetKey, custom,
      running: false, phase: "focus", cycle: 0, targetAt: null, remaining: p.focusMin * 60
    };
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    save(); broadcast();
  }
  function setAutoStartNext(v: boolean) {
    state = { ...state, autoStartNext: v }; save(); broadcast();
  }
  function setTaskTitle(t: string) {
    state = { ...state, taskTitle: t }; save(); broadcast();
  }
  function applyCustom(custom: PresetVals) {
    // cap focus max 240 here too as a guard
    const safe = { ...custom, focusMin: clamp(custom.focusMin, 1, 240) };
    state = { ...state, custom: safe };
    // if current preset is custom and not running, also reset remaining for current phase
    if (state.presetKey === "custom" && !state.running) {
      const p = presetByKey("custom", safe);
      const rem = durationFor(state.phase, p);
      state = { ...state, remaining: rem };
    }
    save(); broadcast();
  }
  function setPresetKey(k: PresetKey) {
    state = { ...state, presetKey: k };
    save(); broadcast();
  }

  const service: Service = { get: () => state, start, pause, resetToPreset, setAutoStartNext, setTaskTitle, applyCustom, setPresetKey };
  window.__BYB_FOCUS_SERVICE__ = service;
  // if it was running on restore, restart interval
  if (state.running && state.targetAt) schedule();
  return service;
}

/* ---------- Tiny helpers ---------- */
function mmss(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
function todayStartISO() {
  const d = new Date(); d.setHours(0,0,0,0); return d.toISOString();
}
function startOfWeekMondayISO() {
  const d = new Date(); const day = (d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d.toISOString();
}
function parseIntSafe(s: string) { const m = (s ?? "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; }

/* ---------- Modal ---------- */
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
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
      <p><em>Short, focused bursts with deliberate breaks — perfect for deep work without burnout.</em></p>
      <h4 style={{ margin: 0 }}>How this timer works</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Focus</b> for the set minutes (no context-switching).</li>
        <li>Take a <b>Short break</b> after each focus cycle.</li>
        <li>After several cycles, enjoy a <b>Long break</b>.</li>
        <li>Use a preset or make a <b>Custom</b> one.</li>
      </ul>
      <h4 style={{ margin: 0 }}>Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Type a task to anchor your session, then Start.</li>
        <li>Breaks are for movement/water — not doomscrolling.</li>
        <li>Tap <b>Distraction +</b> when you get pulled away to keep awareness high.</li>
        <li>Stuck? Ask <b>Eva</b> for a quick 25-minute action plan.</li>
      </ul>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Shortcuts: <b>Space</b> start/pause • <b>R</b> reset • “<b>Mini</b>” opens a floating timer (Chrome).
      </p>
    </div>
  );
}

/* ---------- Confetti (light) ---------- */
function ConfettiBurst({ show }:{ show:boolean }) {
  if (!show) return null;
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:3000 }}>
      {pieces.map((_, i) => (
        <span key={i}
          style={{ position:"absolute", left: `${(i / pieces.length) * 100}%`, top: -10, width:6, height:10, borderRadius:1, background:"hsl(var(--pastel-hsl))", animation: `fall ${600 + i*20}ms ease-out forwards` }}/>
      ))}
      <style>{`@keyframes fall{ to { transform: translateY(100vh) rotate(260deg); opacity:.2; } }`}</style>
    </div>
  );
}

/* ---------- Summary (unchanged) ---------- */
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
      const today = data
        .filter(x => new Date(x.started_at) >= new Date(todayStartISO()))
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

/* =========================================================
   Page
   ========================================================= */
export default function FocusScreen() {
  // bind to the singleton service
  const serviceRef = useRef<Service | null>(null);
  if (!serviceRef.current) serviceRef.current = initService();
  const service = serviceRef.current;

  // local reactive mirror of service state
  const [snap, setSnap] = useState<ServiceSnapshot>(() => service.get());

  // UI state not owned by service
  const [showHelp, setShowHelp] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [notifOn, setNotifOn] = useState(true);
  const [celebrate, setCelebrate] = useState(false);
  const [autoCreateTask, setAutoCreateTask] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem("byb:focus:autoCreateTask") || "false"); } catch { return false; }
  });

  // auth (for logging sessions)
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({data}) => setUserId(data.user?.id ?? null)); }, []);

  // subscribe to service updates
  useEffect(() => {
    const onUpdate = (e: any) => setSnap(e.detail as ServiceSnapshot);
    const onEnded = async (e: any) => {
      const endedPhase: Phase = e.detail?.phase;
      if (document.visibilityState !== "visible") {
        sendNotification(notifOn, endedPhase === "focus" ? "Break time!" : "Back to focus!", endedPhase === "focus" ? "Focus block complete" : "Break finished");
      }
      playBeep(2, soundOn);

      // Log focus session when a focus block ends
      if (endedPhase === "focus" && userId) {
        const p = presetByKey(snap.presetKey, snap.custom);
        try {
          await supabase.from("focus_sessions").insert({
            user_id: userId,
            started_at: new Date(Date.now() - p.focusMin * 60 * 1000).toISOString(),
            ended_at: new Date().toISOString(),
            phase: "focus",
            preset: snap.presetKey,
            minutes: p.focusMin,
            interruptions: 0, // simplified in service mode; keep extension if you want
            task_title: snap.taskTitle || null,
          });
        } catch {}
        setCelebrate(true);
        if ((navigator as any).vibrate) (navigator as any).vibrate(8);
        setTimeout(() => setCelebrate(false), 900);
      }
    };
    window.addEventListener("byb:focus:update", onUpdate as any);
    window.addEventListener("byb:focus:ended", onEnded as any);
    // prime once (handles hot nav back to this screen)
    setSnap(service.get());
    return () => {
      window.removeEventListener("byb:focus:update", onUpdate as any);
      window.removeEventListener("byb:focus:ended", onEnded as any);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, soundOn, notifOn]);

  // document title live
  useEffect(() => {
    const label = snap.phase === "focus" ? "Focus" : snap.phase === "short" ? "Short break" : "Long break";
    document.title = snap.running ? `${mmss(snap.remaining)} • ${label}` : "Focus Timer";
  }, [snap.running, snap.remaining, snap.phase]);

  // persist the “create task on start” preference
  useEffect(() => {
    try { localStorage.setItem("byb:focus:autoCreateTask", JSON.stringify(autoCreateTask)); } catch {}
  }, [autoCreateTask]);

  /* ----- Custom inputs (free typing, with caps) ----- */
  const [focusStr, setFocusStr]   = useState("");
  const [shortStr, setShortStr]   = useState("");
  const [longStr, setLongStr]     = useState("");
  const [cyclesStr, setCyclesStr] = useState("");

  // when switching to custom, show blanks to allow free typing
  useEffect(() => {
    if (snap.presetKey === "custom") {
      setFocusStr(""); setShortStr(""); setLongStr(""); setCyclesStr("");
    }
  }, [snap.presetKey]);

  // fill with numbers if still blank (first paint)
  useEffect(() => {
    if (snap.presetKey !== "custom") return;
    if (focusStr === "")  setFocusStr(String(snap.custom.focusMin));
    if (shortStr === "")  setShortStr(String(snap.custom.shortMin));
    if (longStr === "")   setLongStr(String(snap.custom.longMin));
    if (cyclesStr === "") setCyclesStr(String(snap.custom.cyclesBeforeLong));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.custom]);

  function commitFocus() {
    const n = parseIntSafe(focusStr);
    if (isNaN(n)) { setFocusStr(String(snap.custom.focusMin)); return; }
    const v = clamp(n, 1, 240); // 4h max
    service.applyCustom({ ...snap.custom, focusMin: v });
    setFocusStr(String(v));
  }
  function commitShort() {
    const n = parseIntSafe(shortStr);
    if (isNaN(n)) { setShortStr(String(snap.custom.shortMin)); return; }
    const v = clamp(n, 1, 180);
    service.applyCustom({ ...snap.custom, shortMin: v });
    setShortStr(String(v));
  }
  function commitLong() {
    const n = parseIntSafe(longStr);
    if (isNaN(n)) { setLongStr(String(snap.custom.longMin)); return; }
    const v = clamp(n, 1, 180);
    service.applyCustom({ ...snap.custom, longMin: v });
    setLongStr(String(v));
  }
  function commitCycles() {
    const n = parseIntSafe(cyclesStr);
    if (isNaN(n)) { setCyclesStr(String(snap.custom.cyclesBeforeLong)); return; }
    const v = clamp(n, 1, 12);
    service.applyCustom({ ...snap.custom, cyclesBeforeLong: v });
    setCyclesStr(String(v));
  }

  /* ----- Controls ----- */
  async function start() {
    if (snap.presetKey === "custom") { commitFocus(); commitShort(); commitLong(); commitCycles(); }
    if (notifOn) await ensureNotifPermission().catch(()=>{});
    // optional: auto-create a task when starting
    try {
      if (autoCreateTask && userId && snap.taskTitle.trim()) {
        await supabase.from("tasks").insert({
          user_id: userId,
          title: snap.taskTitle.trim(),
          status: "in_progress",
          priority: 0,
          due_date: new Date().toISOString().slice(0,10),
          source: "focus_timer",
        });
      }
    } catch {}
    service.start();
  }
  function pause() { service.pause(); }
  function resetAll() { service.resetToPreset(snap.presetKey, snap.custom); }

  function progressPct() {
    const p = presetByKey(snap.presetKey, snap.custom);
    const total = (snap.phase === "focus" ? p.focusMin : snap.phase === "short" ? p.shortMin : p.longMin) * 60;
    if (total <= 0) return 0;
    const done = Math.max(0, Math.min(1, 1 - snap.remaining / total));
    return Math.round(done * 100);
  }

  // Keyboard: optional on mobile, harmless if no hardware keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e as any).isComposing) return;
      if (e.key === ' ') { e.preventDefault(); snap.running ? pause() : start(); }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap.running, snap.presetKey, snap.custom]);

  // Optional mini PiP (desktop Chrome)
  async function openMiniTimer() {
    // @ts-ignore
    const dip = (window as any).documentPictureInPicture;
    if (!dip?.requestWindow) return;
    const pip = await dip.requestWindow({ width: 220, height: 120 });
    const el = pip.document.createElement('div');
    el.style.cssText = 'font: 700 28px system-ui; display:grid; place-items:center; height:100%;';
    pip.document.body.style.margin = "0";
    pip.document.body.appendChild(el);
    const i = setInterval(() => { el.textContent = mmss(snap.remaining); }, 250);
    pip.addEventListener('pagehide', () => clearInterval(i));
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  const presets: (PresetVals & { key: PresetKey; label: string })[] = useMemo(() => {
    const base = PRESETS_BASE.map(p => ({
      key: p.key as PresetKey,
      label: `${p.focusMin} / ${p.shortMin} (x${p.cyclesBeforeLong} → ${p.longMin})`,
      focusMin: p.focusMin, shortMin: p.shortMin, longMin: p.longMin, cyclesBeforeLong: p.cyclesBeforeLong
    }));
    return [
      ...base,
      { key: "custom", label: "Custom…", ...snap.custom }
    ];
  }, [snap.custom]);

  return (
    <div className="page-focus">
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card" style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open Focus help"
            title="Need a hand? Ask Eva"
            style={{ position: "absolute", top: 8, right: 8, border: "1px solid var(--border)", background: "#fff", padding: "6px 10px", borderRadius: 999 }}
          >
            ?
          </button>
          <h1 style={{ margin: 0 }}>Focus Timer</h1>
          <div className="muted">Deep work intervals with smart breaks. Stuck? Ask <b>Eva</b> for a 25-minute plan.</div>
        </div>

        {/* Controls */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="muted">Preset</span>
              <select
                value={snap.presetKey}
                onChange={e => {
                  const k = e.target.value as PresetKey;
                  service.setPresetKey(k);
                  service.resetToPreset(k, snap.custom);
                }}>
                {presets.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>

            {snap.presetKey === "custom" && (
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                <label>
                  Focus{" "}
                  <input
                    type="text" inputMode="numeric" placeholder="min"
                    value={focusStr}
                    onChange={e => setFocusStr(e.target.value)}
                    onBlur={commitFocus}
                    onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                    style={{ width:70 }}
                    aria-label="Custom focus minutes (max 240)"
                  />
                </label>
                <label>
                  Short{" "}
                  <input
                    type="text" inputMode="numeric" placeholder="min"
                    value={shortStr}
                    onChange={e => setShortStr(e.target.value)}
                    onBlur={commitShort}
                    onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                    style={{ width:70 }}
                    aria-label="Custom short break minutes"
                  />
                </label>
                <label>
                  Long{" "}
                  <input
                    type="text" inputMode="numeric" placeholder="min"
                    value={longStr}
                    onChange={e => setLongStr(e.target.value)}
                    onBlur={commitLong}
                    onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                    style={{ width:70 }}
                    aria-label="Custom long break minutes"
                  />
                </label>
                <label>
                  Cycles{" "}
                  <input
                    type="text" inputMode="numeric" placeholder="x"
                    value={cyclesStr}
                    onChange={e => setCyclesStr(e.target.value)}
                    onBlur={commitCycles}
                    onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                    style={{ width:70 }}
                    aria-label="Cycles before long break"
                  />
                </label>
                <span className="muted" style={{ fontSize: 12 }}>Focus max 240 min (4h)</span>
              </div>
            )}

            <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <input type="checkbox" checked={snap.autoStartNext} onChange={e => service.setAutoStartNext(e.target.checked)} />
              Auto-start next
            </label>

            <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)} />
              Sound
            </label>

            <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <input type="checkbox" checked={notifOn} onChange={e => setNotifOn(e.target.checked)} />
              Notifications
            </label>

            <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <input type="checkbox" checked={autoCreateTask} onChange={e => setAutoCreateTask(e.target.checked)} />
              Create task on Start
            </label>

            <span className="badge" title="Completed focus cycles in this set">Cycles: {snap.cycle}/{presetByKey(snap.presetKey, snap.custom).cyclesBeforeLong}</span>
            <span className="badge" style={{ background: "#eef2ff", border: "1px solid var(--border)" }}>
              {snap.phase === "focus" ? "Focus" : snap.phase === "short" ? "Short break" : "Long break"}
            </span>

            <div style={{ flex: 1 }} />

            <label style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span className="muted">Task</span>
              <input
                value={snap.taskTitle}
                onChange={e=> service.setTaskTitle(e.target.value)}
                placeholder="Optional: what are you focusing on?"
                style={{ minWidth: 220 }}
              />
            </label>
          </div>

          {/* Timer + actions */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: 1, minWidth: 110, textAlign: "right" }}>
              {mmss(snap.remaining)}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!snap.running ? (
                <button className="btn-primary" onClick={start} style={{ borderRadius: 8 }}>Start</button>
              ) : (
                <button onClick={pause}>Pause</button>
              )}
              <button onClick={resetAll}>Reset</button>
              {snap.phase !== "focus" && (
                <button onClick={() => {
                  // Force end of current break immediately
                  const next = computeNext(snap.phase, snap.cycle, presetByKey(snap.presetKey, snap.custom), Date.now());
                  if (snap.autoStartNext) {
                    const rem2 = nowSecToTarget(next.targetAt);
                    const curr = service.get();
                    // emulate internal transition
                    (window as any).dispatchEvent(new CustomEvent("byb:focus:ended", { detail: { phase: snap.phase } }));
                    // update service snapshot quickly by resetting to same preset then starting
                    service.pause();
                    service.resetToPreset(curr.presetKey, curr.custom);
                    // set to next phase running:
                    const tmp: ServiceSnapshot = { ...service.get(), running: true, phase: next.phase, cycle: next.cycle, targetAt: next.targetAt, remaining: rem2 };
                    // persist and broadcast
                    try { localStorage.setItem(LS_SERVICE_KEY, JSON.stringify(tmp)); } catch {}
                    window.dispatchEvent(new CustomEvent("byb:focus:update", { detail: tmp }));
                    // restart interval
                    service.start();
                  } else {
                    service.pause();
                    service.resetToPreset(snap.presetKey, snap.custom);
                  }
                }}>Skip break</button>
              )}
              <button onClick={() => {
                const add = 5 * 60;
                const curr = service.get();
                if (curr.running && curr.targetAt) {
                  const tgt = curr.targetAt + add * 1000;
                  const next = { ...curr, targetAt: tgt, remaining: curr.remaining + add };
                  try { localStorage.setItem(LS_SERVICE_KEY, JSON.stringify(next)); } catch {}
                  window.dispatchEvent(new CustomEvent("byb:focus:update", { detail: next }));
                } else {
                  const next = { ...curr, remaining: curr.remaining + add };
                  try { localStorage.setItem(LS_SERVICE_KEY, JSON.stringify(next)); } catch {}
                  window.dispatchEvent(new CustomEvent("byb:focus:update", { detail: next }));
                }
              }}>+5 min</button>
              <button onClick={openMiniTimer} title="Floating mini-timer (Chrome)">Mini</button>
              <button onClick={toggleFullscreen} title="Fullscreen timer">Fullscreen</button>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ height: 10, borderRadius: 999, border: "1px solid var(--border)", background: "#f8fafc", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progressPct()}%`, background: "hsl(var(--pastel-hsl, 210 95% 78%))", transition: "width .35s linear" }} />
              </div>
            </div>
          </div>

          {/* “Currently focusing on …” */}
          {snap.taskTitle.trim() && (
            <div className="muted" style={{ fontSize: 12 }}>
              Currently focusing on: <b>{snap.taskTitle.trim()}</b>
            </div>
          )}
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
          <div className="muted" style={{ fontSize: 12 }}>
            Want help chunking your work? Ask <b>Eva</b> to turn your goal into a 3-step plan for your next block.
          </div>
        </div>

        {/* Help modal */}
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Focus — Help (with Eva)">
          <FocusHelpContent />
        </Modal>
      </div>

      <ConfettiBurst show={celebrate} />
    </div>
  );
}
