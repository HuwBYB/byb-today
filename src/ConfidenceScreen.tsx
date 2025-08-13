import { useEffect, useMemo, useState } from "react";

/** ----- tiny helpers ----- */
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

/** Breathing patterns (seconds per phase) */
type BreathPatternKey = "box" | "478" | "coherent";
type Pattern = { name: string; phases: { label: string; secs: number }[]; };
const PATTERNS: Record<BreathPatternKey, Pattern> = {
  box:      { name: "Box 4-4-4-4", phases: [{label:"Inhale",secs:4},{label:"Hold",secs:4},{label:"Exhale",secs:4},{label:"Hold",secs:4}] },
  "478":    { name: "4-7-8",       phases: [{label:"Inhale",secs:4},{label:"Hold",secs:7},{label:"Exhale",secs:8}] },
  coherent: { name: "Coherent 5/5",phases: [{label:"Inhale",secs:5},{label:"Exhale",secs:5}] },
};

export default function ConfidenceScreen() {
  const [tab, setTab] = useState<"pose"|"breath"|"affirm">("pose");
  const [countdown, setCountdown] = useState(60);
  const [running, setRunning] = useState(false);

  // Timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setCountdown(s => clamp(s-1, 0, 60)), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (running && countdown === 0) setRunning(false);
  }, [countdown, running]);

  function startOneMinute() { setCountdown(60); setRunning(true); }
  function stop() { setRunning(false); }
  function reset() { setRunning(false); setCountdown(60); }

  return (
    <div style={{ display:"grid", gap:12 }}>
      <div className="card" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div>
          <h1 style={{ margin:0 }}>Confidence Moves</h1>
          <div className="muted">A focused minute before your meeting or interview.</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={startOneMinute} className="btn-primary" style={{ borderRadius:8 }}>Start 1-minute</button>
          <button onClick={stop}>Pause</button>
          <button onClick={reset}>Reset</button>
          <div className="muted" style={{ width:64, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{countdown}s</div>
        </div>
      </div>

      <div className="card" style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <TabButton active={tab==="pose"} onClick={()=>setTab("pose")} label="Power Pose" />
        <TabButton active={tab==="breath"} onClick={()=>setTab("breath")} label="Breathing" />
        <TabButton active={tab==="affirm"} onClick={()=>setTab("affirm")} label="Affirmation" />
      </div>

      {tab==="pose"   && <PowerPose running={running} />}
      {tab==="breath" && <Breathing running={running} />}
      {tab==="affirm" && <Affirmation running={running} />}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active:boolean; onClick:()=>void; label:string }) {
  return (
    <button onClick={onClick}
      style={{
        padding:"8px 12px", borderRadius:8, border:"1px solid",
        borderColor: active? "#111" : "#ddd",
        background: active? "#111" : "#fff", color: active? "#fff" : "#111",
      }}>
      {label}
    </button>
  );
}

/* ===========================
   Power Pose (animated SVG)
   =========================== */
function PowerPose({ running }: { running:boolean }) {
  return (
    <div className="card" style={{ display:"grid", gridTemplateColumns:"minmax(280px, 420px) 1fr", gap:16, alignItems:"center" }}>
      <style>{CSS_POSE}</style>
      <div style={{ display:"grid", placeItems:"center", minHeight:260 }}>
        <svg viewBox="0 0 200 240" className="hero">
          <ellipse cx="100" cy="225" rx="40" ry="8" className="shadow" />
          <g className="body">
            <circle cx="100" cy="48" r="18" />
            <rect x="84" y="66" width="32" height="42" rx="8" />
            <rect x="52" y="74" width="32" height="10" rx="5" transform="rotate(20 52 74)" />
            <rect x="116" y="74" width="32" height="10" rx="5" transform="rotate(-20 148 74)" />
            <rect x="88" y="110" width="24" height="22" rx="6" />
            <rect x="78" y="132" width="12" height="46" rx="6" />
            <rect x="110" y="132" width="12" height="46" rx="6" />
          </g>
          <path className={"cape"+(running?" cape-run":"")}
            d="M100 74 C 65 84, 40 110, 36 144 C 60 138, 92 156, 118 170 C 126 160, 128 144, 124 130 C 122 120, 116 110, 108 100 Z"
          />
        </svg>
      </div>

      <div style={{ display:"grid", gap:10 }}>
        <h2 style={{ margin:0 }}>Stand like a superhero</h2>
        <ul className="list" style={{ lineHeight:1.4 }}>
          <li><b>Feet</b> shoulder-width apart</li>
          <li><b>Hands</b> on hips (or arms open)</li>
          <li><b>Chest</b> up, <b>chin</b> level</li>
          <li><b>Breathe</b> slow through the nose</li>
          <li><b>Eyes</b> soften; tiny smile</li>
        </ul>
        <div className="muted">Hold for one minute. Let the cape remind you to stay tall.</div>
      </div>
    </div>
  );
}

const CSS_POSE = `
.hero { width: 100%; max-width: 360px; }
.body { fill: #111; }
.cape { fill: #ef4444; opacity: 0.95; transform-origin: 100px 74px; }
.cape-run { animation: capeWave 1.6s ease-in-out infinite; }
.shadow { fill: #000; opacity: 0.12; }
@keyframes capeWave {
  0%   { transform: rotate(-2deg) skewX(0deg); }
  50%  { transform: rotate(2deg)  skewX(5deg); }
  100% { transform: rotate(-2deg) skewX(0deg); }
}
`;

/* ===========================
   Breathing Guide
   =========================== */
function Breathing({ running }: { running:boolean }) {
  const [patternKey, setPatternKey] = useState<BreathPatternKey>("box");
  const pattern = PATTERNS[patternKey];
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [phaseLeft, setPhaseLeft] = useState(pattern.phases[0].secs);

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

  const size = 180;
  const scale = useMemo(() => {
    const label = pattern.phases[phaseIdx].label.toLowerCase();
    if (label === "inhale") return 1.0;
    if (label === "exhale") return 0.65;
    return 0.82;
  }, [pattern, phaseIdx]);

  return (
    <div className="card" style={{ display:"grid", gridTemplateColumns:"minmax(260px, 340px) 1fr", gap:16, alignItems:"center" }}>
      <style>{CSS_BREATH}</style>
      <div style={{ display:"grid", placeItems:"center", minHeight:240 }}>
        <div className="ringWrap" style={{ width:size, height:size, transform:`scale(${scale})`, transition:"transform 900ms ease-in-out" }}>
          <div className="ring" />
          <div className="ringInner" />
        </div>
        <div style={{ marginTop:12, textAlign:"center" }}>
          <div style={{ fontWeight:700 }}>{pattern.phases[phaseIdx].label}</div>
          <div className="muted">{phaseLeft}s</div>
        </div>
      </div>

      <div style={{ display:"grid", gap:10 }}>
        <h2 style={{ margin:0 }}>Guided breathing</h2>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <PatternButton current={patternKey} setKey={setPatternKey} k="box" label="Box 4-4-4-4" />
          <PatternButton current={patternKey} setKey={setPatternKey} k="478" label="4-7-8" />
          <PatternButton current={patternKey} setKey={setPatternKey} k="coherent" label="Coherent 5/5" />
        </div>
        <div className="muted">Follow the circle—expand on inhale, shrink on exhale. Holds stay steady.</div>
      </div>
    </div>
  );
}
function PatternButton({ current, setKey, k, label }:{ current:BreathPatternKey; setKey:(k:BreathPatternKey)=>void; k:BreathPatternKey; label:string }) {
  const active = current===k;
  return (
    <button onClick={()=>setKey(k)}
      style={{ padding:"6px 10px", borderRadius:999, border:"1px solid", borderColor: active?"#111":"#ddd", background: active?"#111":"#fff", color: active?"#fff":"#111" }}>
      {label}
    </button>
  );
}

const CSS_BREATH = `
.ringWrap { position: relative; }
.ring, .ringInner {
  position:absolute; inset:0; border-radius:9999px;
}
.ring { border: 6px solid #111; opacity: 0.15; }
.ringInner { border: 6px solid #111; opacity: 0.8; box-shadow: 0 0 24px rgba(0,0,0,0.08) inset; }
`;

/* ===========================
   Affirmation Flash
   =========================== */
function Affirmation({ running }: { running:boolean }) {
  const LS_KEY = "byb_affirmation";
  const [text, setText] = useState<string>(() => localStorage.getItem(LS_KEY) || "I follow through on what matters today.");
  const [speak, setSpeak] = useState<boolean>(false);

  useEffect(() => { localStorage.setItem(LS_KEY, text); }, [text]);

  useEffect(() => {
    if (!running || !speak) return;
    const say = () => {
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.95; utter.pitch = 1;
        window.speechSynthesis.speak(utter);
      } catch {}
    };
    say();
    const id = setInterval(say, 6000);
    return () => clearInterval(id);
  }, [running, speak, text]);

  return (
    <div className="card" style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:16, alignItems:"center" }}>
      <div style={{ display:"grid", gap:12 }}>
        <h2 style={{ margin:0 }}>Affirmation</h2>
        <div style={{
          padding:20, border:"1px solid #e5e7eb", borderRadius:12,
          fontSize:22, fontWeight:700, lineHeight:1.3, textAlign:"center"
        }}>
          {text}
        </div>
        <label style={{ display:"grid", gap:6 }}>
          <div className="section-title">Edit</div>
          <input value={text} onChange={e=>setText(e.target.value)} />
        </label>
      </div>
      <div style={{ display:"grid", gap:10 }}>
        <div className="muted">Tip: keep it short, active, and present-tense.</div>
        <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
          <input type="checkbox" checked={speak} onChange={e=>setSpeak(e.target.checked)} />
          Speak it while the timer runs
        </label>
      </div>
    </div>
  );
}
