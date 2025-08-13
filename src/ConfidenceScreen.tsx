import { useEffect, useMemo, useState } from "react";

/** ----- tiny helpers ----- */
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Breathing patterns (seconds per phase) */
type BreathPatternKey = "box" | "478" | "coherent";
type Pattern = { name: string; phases: { label: string; secs: number }[] };
const PATTERNS: Record<BreathPatternKey, Pattern> = {
  box: {
    name: "Box 4-4-4-4",
    phases: [
      { label: "Inhale", secs: 4 },
      { label: "Hold", secs: 4 },
      { label: "Exhale", secs: 4 },
      { label: "Hold", secs: 4 },
    ],
  },
  "478": {
    name: "4-7-8",
    phases: [
      { label: "Inhale", secs: 4 },
      { label: "Hold", secs: 7 },
      { label: "Exhale", secs: 8 },
    ],
  },
  coherent: {
    name: "Coherent 5/5",
    phases: [
      { label: "Inhale", secs: 5 },
      { label: "Exhale", secs: 5 },
    ],
  },
};

export default function ConfidenceScreen() {
  const [tab, setTab] = useState<"pose" | "breath" | "affirm">("pose");
  const [countdown, setCountdown] = useState(60);
  const [running, setRunning] = useState(false);

  // Timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setCountdown((s) => clamp(s - 1, 0, 60)), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (running && countdown === 0) setRunning(false);
  }, [countdown, running]);

  function startOneMinute() {
    setCountdown(60);
    setRunning(true);
  }
  function stop() {
    setRunning(false);
  }
  function reset() {
    setRunning(false);
    setCountdown(60);
  }

  return (
    <div className="page-confidence" style={{ display: "grid", gap: 12 }}>
      {/* Top bar */}
      <div className="card">
        <div
          className="confidence-toolbar"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <div>
            <h1 style={{ margin: 0 }}>Confidence Moves</h1>
            <div className="muted">A focused minute before your meeting or interview.</div>
          </div>

          <div className="confidence-toolbar" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={startOneMinute} className="btn-primary" style={{ borderRadius: 8 }}>
              Start 1-minute
            </button>
            <button onClick={stop}>Pause</button>
            <button onClick={reset}>Reset</button>
            <div className="muted" style={{ width: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {countdown}s
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <TabButton active={tab === "pose"} onClick={() => setTab("pose")} label="Power Pose" />
        <TabButton active={tab === "breath"} onClick={() => setTab("breath")} label="Breathing" />
        <TabButton active={tab === "affirm"} onClick={() => setTab("affirm")} label="Affirmation" />
      </div>

      {tab === "pose" && <PowerPose running={running} />}
      {tab === "breath" && <Breathing running={running} />}
      {tab === "affirm" && <Affirmation running={running} />}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid",
        borderColor: active ? "#111" : "#ddd",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
      }}
    >
      {label}
    </button>
  );
}

/* ===========================
   Power Pose (static silhouette)
   =========================== */
function PowerPose({ running }: { running: boolean }) {
  return (
    <div className="card confidence-layout">
      <style>{CSS_POSE}</style>

      {/* Left: static hero */}
      <div style={{ display: "grid", placeItems: "center", minHeight: 260 }}>
        <svg viewBox="0 0 300 260" className="hero-static" aria-label="Superhero silhouette">
          <defs>
            {/* soft background glow (uses your pastel theme variables) */}
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
          <ellipse cx="150" cy="232" rx="48" ry="10" className="shadow" />

          {/* cape behind body */}
          <path
            className="cape"
            d="M150 96
               C 110 100, 76 122, 66 160
               C 120 152, 170 192, 214 206
               C 224 182, 210 142, 192 118
               C 178 104, 164 98, 150 96 Z"
          />

          {/* silhouette body */}
          <g className="silhouette">
            {/* head */}
            <circle cx="150" cy="58" r="22" />
            {/* chest/torso */}
            <path d="M112 90 Q150 74 188 90 L180 132 Q150 146 120 132 Z" />
            {/* arms on hips */}
            <path d="M112 96 L90 112 L112 126 L124 108 Z" />
            <path d="M188 96 L210 112 L188 126 L176 108 Z" />
            {/* hips/core */}
            <rect x="135" y="132" width="30" height="22" rx="8" />
            {/* legs */}
            <path d="M134 154 L118 208 L136 208 L146 156 Z" />
            <path d="M166 154 L182 208 L164 208 L154 156 Z" />
          </g>
        </svg>
      </div>

      {/* Right: instructions */}
      <div style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Stand like a superhero</h2>
        <ul className="list" style={{ lineHeight: 1.4 }}>
          <li>
            <b>Feet</b> shoulder-width apart
          </li>
          <li>
            <b>Hands</b> on hips (or arms open)
          </li>
          <li>
            <b>Chest</b> up, <b>chin</b> level
          </li>
          <li>
            <b>Breathe</b> slow through the nose
          </li>
          <li>
            <b>Eyes</b> soften; tiny smile
          </li>
        </ul>
        <div className="muted">Hold for one minute. The cape is your cue to stay tall.</div>
      </div>
    </div>
  );
}

const CSS_POSE = `
.hero-static { width: 100%; max-width: 420px; }
.silhouette { fill: #111; }
.cape { fill: url(#capeGrad); }
.shadow { fill: #000; opacity: .10; }
`;

/* ===========================
   Breathing Guide
   =========================== */
function Breathing({ running }: { running: boolean }) {
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
    <div className="card confidence-layout">
      <style>{CSS_BREATH}</style>
      <div style={{ display: "grid", placeItems: "center", minHeight: 240 }}>
        <div
          className="ringWrap"
          style={{ width: size, height: size, transform: `scale(${scale})`, transition: "transform 900ms ease-in-out" }}
        >
          <div className="ring" />
          <div className="ringInner" />
        </div>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <div style={{ fontWeight: 700 }}>{pattern.phases[phaseIdx].label}</div>
          <div className="muted">{phaseLeft}s</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Guided breathing</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PatternButton current={patternKey} setKey={setPatternKey} k="box" label="Box 4-4-4-4" />
          <PatternButton current={patternKey} setKey={setPatternKey} k="478" label="4-7-8" />
          <PatternButton current={patternKey} setKey={setPatternKey} k="coherent" label="Coherent 5/5" />
        </div>
        <div className="muted">Follow the circle—expand on inhale, shrink on exhale. Holds stay steady.</div>
      </div>
    </div>
  );
}
function PatternButton({
  current,
  setKey,
  k,
  label,
}: {
  current: BreathPatternKey;
  setKey: (k: BreathPatternKey) => void;
  k: BreathPatternKey;
  label: string;
}) {
  const active = current === k;
  return (
    <button
      onClick={() => setKey(k)}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid",
        borderColor: active ? "#111" : "#ddd",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
      }}
    >
      {label}
    </button>
  );
}

const CSS_BREATH = `
.ringWrap { position: relative; }
.ring, .ringInner { position:absolute; inset:0; border-radius:9999px; }
.ring { border: 6px solid #111; opacity: 0.15; }
.ringInner { border: 6px solid #111; opacity: 0.8; box-shadow: 0 0 24px rgba(0,0,0,0.08) inset; }
`;

/* ===========================
   Affirmation Flash
   =========================== */
function Affirmation({ running }: { running: boolean }) {
  const LS_KEY = "byb_affirmation";
  const [text, setText] = useState<string>(() => localStorage.getItem(LS_KEY) || "I follow through on what matters today.");
  const [speak, setSpeak] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem(LS_KEY, text);
  }, [text]);

  useEffect(() => {
    if (!running || !speak) return;
    const say = () => {
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.95;
        utter.pitch = 1;
        window.speechSynthesis.speak(utter);
      } catch {}
    };
    say();
    const id = setInterval(say, 6000);
    return () => clearInterval(id);
  }, [running, speak, text]);

  return (
    <div className="card confidence-layout">
      <div style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Affirmation</h2>
        <div
          style={{
            padding: 20,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.3,
            textAlign: "center",
          }}
        >
          {text}
        </div>
        <label style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Edit</div>
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="muted">Tip: keep it short, active, and present-tense.</div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />
          Speak it while the timer runs
        </label>
      </div>
    </div>
  );
}
