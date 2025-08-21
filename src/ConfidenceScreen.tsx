import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- tiny helpers ---------- */
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayISO = () => toISO(new Date());

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
const CONF_ALFRED_SRC = publicPath("/alfred/Confidence_Alfred.png");

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
function ConfidenceHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Use this page for a one-minute reset before a meeting, interview, or whenever you want to feel steady and bold.</em></p>
      <h4 style={{ margin: 0 }}>What’s here</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Daily prompt</b> — quick check-in that builds a streak.</li>
        <li><b>Confidence reps</b> — track pose, breath, and affirmation reps.</li>
        <li><b>Wins reflection</b> — one short line after each minute.</li>
      </ul>
      <h4 style={{ margin: 0 }}>60-second flow</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Power Pose 20s</li>
        <li>Breathing 30s (use the bloom pacer)</li>
        <li>Affirmation 10s</li>
      </ol>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Wellness note: general self-regulation, not medical advice. Stop if you feel dizzy or uncomfortable.
      </p>
    </div>
  );
}

/* ---------- Breath patterns (seconds per phase) ---------- */
type BreathPatternKey = "box" | "478" | "coherent";
type Pattern = { name: string; phases: { label: "Inhale" | "Hold" | "Exhale"; secs: number }[] };
const PATTERNS: Record<BreathPatternKey, Pattern> = {
  box: { name: "Box 4-4-4-4", phases: [{label:"Inhale",secs:4},{label:"Hold",secs:4},{label:"Exhale",secs:4},{label:"Hold",secs:4}] },
  "478": { name: "4-7-8", phases: [{label:"Inhale",secs:4},{label:"Hold",secs:7},{label:"Exhale",secs:8}] },
  coherent: { name: "Coherent 5/5", phases: [{label:"Inhale",secs:5},{label:"Exhale",secs:5}] },
};

/* ---------- Persistence (Supabase + localStorage fallback) ---------- */
type ConfKind = "prompt" | "pose" | "breath" | "affirm" | "reflection";
type ConfEntry = {
  id?: number;
  user_id?: string;
  entry_date: string;           // YYYY-MM-DD
  kind: ConfKind;
  reps?: number | null;
  pattern?: string | null;      // breathing pattern key
  text?: string | null;         // affirmation or reflection
};

const LS_CONF = "byb:confidence_entries:v1";

async function saveEntry(userId: string | null, entry: ConfEntry) {
  // Try Supabase first; fall back to localStorage
  try {
    if (userId) {
      const { error } = await supabase.from("confidence_entries").insert({
        user_id: userId,
        entry_date: entry.entry_date,
        kind: entry.kind,
        reps: entry.reps ?? null,
        pattern: entry.pattern ?? null,
        text: entry.text ?? null,
      });
      if (!error) return;
    }
  } catch {}
  // local fallback
  try {
    const arr: ConfEntry[] = JSON.parse(localStorage.getItem(LS_CONF) || "[]");
    arr.push(entry);
    localStorage.setItem(LS_CONF, JSON.stringify(arr));
  } catch {}
}

async function loadEntries(userId: string | null, sinceISO: string) : Promise<ConfEntry[]> {
  try {
    if (userId) {
      const { data, error } = await supabase
        .from("confidence_entries")
        .select("entry_date,kind,reps,pattern,text")
        .gte("entry_date", sinceISO)
        .order("entry_date", { ascending: false });
      if (!error && data) return data as ConfEntry[];
    }
  } catch {}
  try {
    const arr: ConfEntry[] = JSON.parse(localStorage.getItem(LS_CONF) || "[]");
    return arr.filter(x => x.entry_date >= sinceISO);
  } catch { return []; }
}

/* ---------- Confetti ---------- */
function Confetti({ show }:{ show:boolean }) {
  if (!show) return null;
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:3000 }}>
      {pieces.map((_, i) => (
        <span key={i}
          style={{
            position:"absolute", left: `${(i / pieces.length) * 100}%`, top: -10,
            width:6, height:10, borderRadius:1, background:"hsl(var(--pastel-hsl))",
            animation: `fall ${600 + i*20}ms ease-out forwards`,
          }} />
      ))}
      <style>{`@keyframes fall{ to { transform: translateY(100vh) rotate(260deg); opacity:.2; } }`}</style>
    </div>
  );
}

/* =========================================================
   PAGE
   ========================================================= */
export default function ConfidenceScreen() {
  const [tab, setTab] = useState<"pose" | "breath" | "affirm">("pose");
  const [seconds, setSeconds] = useState(60);
  const [running, setRunning] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({data}) => setUserId(data.user?.id ?? null)); }, []);

  // keyboard: Space start/pause, R reset
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') { e.preventDefault(); running ? pause() : start(); }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, seconds]);

  // timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds(s => clamp(s - 1, 0, 3600)), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (running && seconds === 0) {
      setRunning(false);
      setCelebrate(true);
      if ((navigator as any).vibrate) (navigator as any).vibrate(8);
      setTimeout(() => setCelebrate(false), 900);
    }
  }, [seconds, running]);

  function start() { setSeconds(60); setRunning(true); }
  function pause() { setRunning(false); }
  function reset() { setRunning(false); setSeconds(60); }

  // daily prompt + reps + streaks data
  const [entries, setEntries] = useState<ConfEntry[]>([]);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  useEffect(() => {
    const since = toISO(new Date(new Date().setDate(new Date().getDate() - 30)));
    loadEntries(userId, since).then((rows) => {
      setEntries(rows);
      const days: Record<string, boolean> = {};
      rows.forEach(r => { if (["prompt","pose","breath","affirm","reflection"].includes(r.kind)) days[r.entry_date] = true; });
      // compute current/best streak over last 120 days
      let current = 0, best = 0, run = 0;
      for (let i=120;i>=0;i--) {
        const d = toISO(new Date(new Date().setDate(new Date().getDate() - i)));
        if (days[d]) { run++; best = Math.max(best, run); }
        else run = 0;
      }
      // current streak ending today
      const todayDone = !!days[todayISO()];
      if (todayDone) {
        let c = 0;
        for (let i=0; i<120; i++) {
          const d = toISO(new Date(new Date().setDate(new Date().getDate() - i)));
          if (days[d]) c++; else break;
        }
        current = c;
      } else current = 0;
      setStreak(current); setBestStreak(best);
    });
  }, [userId]);

  async function log(kind: ConfKind, data?: Partial<ConfEntry>) {
    const row: ConfEntry = { entry_date: todayISO(), kind, reps: null, pattern: null, text: null, ...data };
    await saveEntry(userId, row);
    setEntries(prev => [row, ...prev]);
  }

  return (
    <div className="page-confidence">
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Title with Alfred */}
        <div className="card" style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open Confidence help"
            title="Need a hand? Ask Alfred"
            style={{ position: "absolute", top: 8, right: 8, border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10 }}
          >
            {imgOk ? (
              <img src={CONF_ALFRED_SRC} alt="Confidence Alfred — open help" style={{ width: 48, height: 48 }} onError={() => setImgOk(false)} />
            ) : (
              <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, borderRadius:999, border:"1px solid #d1d5db", background:"#f9fafb", fontWeight:700 }}>?</span>
            )}
          </button>

          <h1 style={{ margin: 0 }}>Confidence</h1>
          <div className="muted">1-minute reset · daily prompt · reps · reflection</div>
        </div>

        {/* Daily prompt & streak */}
        <DailyPromptCard onRespond={async (txt) => { await log("prompt", { text: txt }); }} streak={streak} best={bestStreak} />

        {/* Timer card */}
        <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={start} className="btn-primary" style={{ borderRadius: 8 }}>Start 1-minute</button>
          <button onClick={pause}>Pause</button>
          <button onClick={reset}>Reset</button>
          <div className="muted" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{seconds}s</div>
        </div>

        {/* Tabs */}
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <TabButton active={tab === "pose"} onClick={() => setTab("pose")} label="Power Pose" />
          <TabButton active={tab === "breath"} onClick={() => setTab("breath")} label="Breathing" />
          <TabButton active={tab === "affirm"} onClick={() => setTab("affirm")} label="Affirmation" />
        </div>

        {tab === "pose" && <PowerPose onRep={async () => { await log("pose", { reps: 1 }); }} />}
        {tab === "breath" && <BloomBreath running={running} onRep={async (pattern) => { await log("breath", { reps: 1, pattern }); }} />}
        {tab === "affirm" && <Affirmation running={running} onRep={async (text) => { await log("affirm", { reps: 1, text }); }} />}

        {/* Reflection after timer */}
        <ReflectionCard enabled={!running && seconds === 0} onSave={async (t) => { await log("reflection", { text: t }); setCelebrate(true); setTimeout(()=>setCelebrate(false),900); }} />

        {/* Recent history snapshot (local or SB) */}
        <RecentHistory entries={entries.slice(0, 8)} />

        {/* Help modal */}
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Confidence — Help">
          <div style={{ display: "flex", gap: 16 }}>
            {imgOk && <img src={CONF_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
            <div style={{ flex: 1 }}>
              <ConfidenceHelpContent />
            </div>
          </div>
        </Modal>

        <Confetti show={celebrate} />
      </div>
    </div>
  );
}

/* ---------- UI atoms ---------- */
function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid",
        borderColor: active ? "hsl(var(--pastel-hsl))" : "#e5e7eb",
        background: active ? "hsl(var(--pastel-hsl) / .45)" : "#fff",
        color: "inherit",
      }}
    >
      {label}
    </button>
  );
}

/* =========================================================
   Daily Prompt + Streak
   ========================================================= */
function DailyPromptCard({ onRespond, streak, best }:{ onRespond:(txt:string)=>void|Promise<void>; streak:number; best:number }) {
  const prompts = [
    "What’s one reason you’ll show up boldly today?",
    "Name one strength you can lean on right now.",
    "What would ‘confident you’ do in the first 5 minutes?",
    "What’s one thing that went well yesterday?",
    "What tiny action will prove your confidence today?",
  ];
  const [i, setI] = useState(() => Math.floor(Math.random() * prompts.length));
  const [text, setText] = useState("");

  async function save() {
    const t = text.trim();
    if (!t) return;
    await onRespond(t);
    setText("");
    setI((i+1) % prompts.length);
    if ((navigator as any).vibrate) (navigator as any).vibrate(5);
  }

  return (
    <div className="card" style={{ display:"grid", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <div className="section-title">Daily prompt</div>
        <StreakChip current={streak} best={best} />
      </div>
      <div style={{ fontWeight: 600 }}>{prompts[i]}</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="One short line…" style={{ flex:1, minWidth: 220 }} />
        <button className="btn-primary" onClick={save} style={{ borderRadius: 8 }}>Log</button>
      </div>
    </div>
  );
}
function StreakChip({ current, best }:{ current:number; best:number }) {
  return (
    <span title={`Current streak ${current} · Best ${best}`}
      style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 10px", borderRadius:999, border:"1px solid var(--border)", background:"var(--card)", fontWeight:700 }}>
      🔥 {current} <span className="muted" style={{ fontWeight:500 }}>(best {best})</span>
    </span>
  );
}

/* =========================================================
   Power Pose
   ========================================================= */
function PowerPose({ onRep }:{ onRep: ()=>void|Promise<void> }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className="card confidence-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div style={{ display: "grid", placeItems: "center", minHeight: 260, padding: 8 }}>
        {imgOk ? (
          <img src={CONF_ALFRED_SRC} alt="Power pose — Alfred" style={{ width: "100%", maxWidth: 420, height: "auto", borderRadius: 12 }} onError={() => setImgOk(false)} />
        ) : (
          <PoseSVG />
        )}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Stand like a superhero</h2>
        <ul className="list" style={{ lineHeight: 1.4 }}>
          <li><b>Feet</b> shoulder-width apart</li>
          <li><b>Hands</b> on hips (or arms open)</li>
          <li><b>Chest</b> up, <b>chin</b> level</li>
          <li><b>Breathe</b> slow through the nose</li>
          <li><b>Eyes</b> soften; tiny smile</li>
        </ul>
        <div className="muted">Hold for one minute. Picture the best version of you entering the room.</div>
        <div>
          <button onClick={onRep}>✓ Log pose rep</button>
        </div>
      </div>
    </div>
  );
}
function PoseSVG() {
  return (
    <svg viewBox="0 0 300 260" aria-label="Superhero silhouette" style={{ width: "100%", maxWidth: 420 }}>
      <defs>
        <radialGradient id="bgGlow" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="hsl(var(--pastel-hsl, 210 95% 78%))" stopOpacity="0.85" />
          <stop offset="60%" stopColor="hsl(var(--pastel-hsl, 210 95% 78%))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="capeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary, #6d28d9)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="hsl(var(--pastel-hsl, 210 95% 78%))" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="300" height="260" fill="url(#bgGlow)" />
      <ellipse cx="150" cy="232" rx="48" ry="10" fill="#000" opacity=".08" />
      <path d="M150 96 C 110 100, 76 122, 66 160 C 120 152, 170 192, 214 206 C 224 182, 210 142, 192 118 C 178 104, 164 98, 150 96 Z" fill="url(#capeGrad)" />
      <g fill="#111">
        <circle cx="150" cy="58" r="22" />
        <path d="M112 90 Q150 74 188 90 L180 132 Q150 146 120 132 Z" />
        <path d="M112 96 L90 112 L112 126 L124 108 Z" />
        <path d="M188 96 L210 112 L188 126 L176 108 Z" />
        <rect x="135" y="132" width="30" height="22" rx="8" />
        <path d="M134 154 L118 208 L136 208 L146 156 Z" />
        <path d="M166 154 L182 208 L164 208 L154 156 Z" />
      </g>
    </svg>
  );
}

/* =========================================================
   Breathing (NON-circle “Bloom” pacer)
   ========================================================= */
function BloomBreath({ running, onRep }:{ running:boolean; onRep:(pattern: string)=>void|Promise<void> }) {
  const [patternKey, setPatternKey] = useState<BreathPatternKey>("box");
  const pattern = PATTERNS[patternKey];
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [phaseLeft, setPhaseLeft] = useState(pattern.phases[0].secs);
  const phase = pattern.phases[phaseIdx].label;

  // phase timing
  useEffect(() => {
    setPhaseIdx(0);
    setPhaseLeft(pattern.phases[0].secs);
  }, [patternKey]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setPhaseLeft((s) => {
        if (s > 1) return s - 1;
        setPhaseIdx((i) => (i + 1) % pattern.phases.length);
        return pattern.phases[(phaseIdx + 1) % pattern.phases.length].secs;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phaseIdx, patternKey]);

  // log a rep when an exhale finishes (natural “completion”)
  const prevPhaseRef = useRef<"Inhale"|"Hold"|"Exhale">(phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    if (prev === "Exhale" && phase !== "Exhale") { onRep(patternKey); }
    prevPhaseRef.current = phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Bloom visuals: 6 petals scale/opacity by phase
  const petalScale = phase === "Inhale" ? 1.0 : phase === "Exhale" ? 0.6 : 0.8;
  const petalOpacity = phase === "Hold" ? 0.9 : 1.0;

  return (
    <div className="card confidence-layout" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
      {/* Left: “Bloom” pacer */}
      <div style={{ display:"grid", placeItems:"center", minHeight:240 }}>
        <svg viewBox="0 0 220 220" width={220} height={220} aria-label="Bloom breath pacer">
          <defs>
            <radialGradient id="petalGrad" cx="50%" cy="50%" r="65%">
              <stop offset="0%" stopColor="hsl(var(--pastel-hsl, 210 95% 78%))" stopOpacity="1" />
              <stop offset="100%" stopColor="hsl(var(--pastel-hsl, 210 95% 78%))" stopOpacity="0.2" />
            </radialGradient>
          </defs>
          <g transform="translate(110,110)">
            {[0,1,2,3,4,5].map(i => (
              <g key={i} transform={`rotate(${i*60}) scale(${petalScale})`} style={{ transition: "transform 900ms ease-in-out", opacity: petalOpacity }}>
                <path d="M0 0 C 20 -14, 40 -44, 0 -70 C -40 -44, -20 -14, 0 0 Z" fill="url(#petalGrad)" />
              </g>
            ))}
            <circle r="6" fill="#111" opacity=".8" />
          </g>
        </svg>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <div style={{ fontWeight: 700 }}>{phase}</div>
          <div className="muted">{phaseLeft}s</div>
        </div>
      </div>

      {/* Right: controls */}
      <div style={{ display:"grid", gap:10 }}>
        <h2 style={{ margin: 0 }}>Guided breathing</h2>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <PatternButton current={patternKey} setKey={setPatternKey} k="box" label="Box 4-4-4-4" />
          <PatternButton current={patternKey} setKey={setPatternKey} k="478" label="4-7-8" />
          <PatternButton current={patternKey} setKey={setPatternKey} k="coherent" label="Coherent 5/5" />
        </div>
        <div className="muted">Bloom opens on inhale, softens on hold, closes gently on exhale.</div>
        <div><button onClick={() => onRep(patternKey)}>✓ Log breath rep</button></div>
      </div>
    </div>
  );
}
function PatternButton({ current, setKey, k, label }:{
  current: BreathPatternKey; setKey: (k: BreathPatternKey)=>void; k: BreathPatternKey; label: string;
}) {
  const active = current === k;
  return (
    <button
      onClick={() => setKey(k)}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid",
        borderColor: active ? "hsl(var(--pastel-hsl))" : "#ddd",
        background: active ? "hsl(var(--pastel-hsl) / .45)" : "#fff",
      }}
    >
      {label}
    </button>
  );
}

/* =========================================================
   Affirmation
   ========================================================= */
function Affirmation({ running, onRep }:{ running:boolean; onRep:(text:string)=>void|Promise<void> }) {
  const LS_KEY = "byb_affirmation";
  const [text, setText] = useState<string>(() => localStorage.getItem(LS_KEY) || "I speak clearly and stay calm.");
  const [speak, setSpeak] = useState<boolean>(false);

  useEffect(() => { try { localStorage.setItem(LS_KEY, text); } catch {} }, [text]);

  useEffect(() => {
    if (!running || !speak) return;
    const say = () => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95; u.pitch = 1;
        window.speechSynthesis.speak(u);
      } catch {}
    };
    say();
    const id = setInterval(say, 6000);
    return () => clearInterval(id);
  }, [running, speak, text]);

  return (
    <div className="card confidence-layout" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
      <div style={{ display:"grid", gap:12 }}>
        <h2 style={{ margin: 0 }}>Affirmation</h2>
        <div style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 12, fontSize: 22, fontWeight: 700, lineHeight: 1.3, textAlign: "center" }}>
          {text}
        </div>
        <label style={{ display:"grid", gap:6 }}>
          <div className="section-title">Edit</div>
          <input value={text} onChange={e=>setText(e.target.value)} />
        </label>
        <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
          <input type="checkbox" checked={speak} onChange={e=>setSpeak(e.target.checked)} /> Speak it while the timer runs
        </label>
        <div><button onClick={() => onRep(text)}>✓ Log affirmation rep</button></div>
      </div>

      {/* Tiny suggestion list */}
      <div style={{ display:"grid", gap:6 }}>
        <div className="section-title">Ideas</div>
        {[
          "I follow through on what matters today.",
          "I can handle this — one step at a time.",
          "I speak clearly and stay calm.",
        ].map((s,idx)=>(
          <button key={idx} onClick={()=>setText(s)} style={{ textAlign:"left" }}>{s}</button>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   Reflection card
   ========================================================= */
function ReflectionCard({ enabled, onSave }:{ enabled:boolean; onSave:(t:string)=>void|Promise<void> }) {
  const [text, setText] = useState("");
  if (!enabled) return null;
  return (
    <div className="card" style={{ display:"grid", gap:8 }}>
      <div className="section-title">Wins reflection</div>
      <input value={text} onChange={e=>setText(e.target.value)} placeholder="What felt strong in that minute?" />
      <div style={{ display:"flex", justifyContent:"flex-end" }}>
        <button className="btn-primary" onClick={async ()=>{ const v=text.trim(); if(!v) return; await onSave(v); setText(""); }}>
          Save
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   Recent history
   ========================================================= */
function RecentHistory({ entries }:{ entries: ConfEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="card" style={{ display:"grid", gap:8 }}>
      <div className="section-title">Recent</div>
      <ul className="list" style={{ margin: 0 }}>
        {entries.map((e, i) => (
          <li key={i} className="item" style={{ alignItems:"center" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {e.kind === "prompt" ? "Prompt" :
                 e.kind === "pose" ? "Power pose rep" :
                 e.kind === "breath" ? `Breath rep (${e.pattern})` :
                 e.kind === "affirm" ? "Affirmation rep" :
                 "Reflection"}{e.text ? ` — ${e.text}` : ""}
              </div>
              <div className="muted" style={{ marginTop:4 }}>{e.entry_date}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
