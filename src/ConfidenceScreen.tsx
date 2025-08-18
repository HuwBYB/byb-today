import { useEffect, useMemo, useState, type ReactNode } from "react";

/** ----- tiny helpers ----- */
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Public path helper (Vite/CRA/Vercel/GH Pages) */
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

/* ---------- Help content (inline) ---------- */
function ConfidenceHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Use this page for a one-minute reset before a meeting, interview, or whenever you want to feel steady and bold.</em></p>

      <h4 style={{ margin: 0 }}>How it works</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Start 1-minute</b> to begin a timed focus window. Pause/Reset anytime.</li>
        <li>Switch between three tools:
          <ul style={{ margin: "6px 0 0 18px" }}>
            <li><b>Power Pose</b>: Stand tall like the silhouette — feet shoulder-width, hands on hips, chest up.</li>
            <li><b>Breathing</b>: Follow the circle. Pick Box (4-4-4-4), 4-7-8, or Coherent 5/5.</li>
            <li><b>Affirmation</b>: Write a short, active phrase (e.g., “I speak clearly and stay calm”). Optional voice repeat.</li>
          </ul>
        </li>
      </ul>

      <h4 style={{ margin: 0 }}>Suggested 60-second flow</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Power Pose for 20s (posture up, slow nose breathing).</li>
        <li>Breathing pattern for 30s (steady rhythm).</li>
        <li>Affirmation for 10s (read or let it speak).</li>
      </ol>

      <h4 style={{ margin: 0 }}>Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>If anxious, start with a slightly longer exhale (4-7-8 helps).</li>
        <li>Keep the affirmation <b>present-tense</b>, short, and under your control.</li>
        <li>Use this before high-stakes calls and as a quick daily ritual.</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Wellness note: this is a general self-regulation tool, not medical advice. Stop if you feel dizzy or uncomfortable.
      </p>
    </div>
  );
}

export default function ConfidenceScreen() {
  const [tab, setTab] = useState<"pose" | "breath" | "affirm">("pose");
  const [countdown, setCountdown] = useState(60);
  const [running, setRunning] = useState(false);

  // Help / Alfred button
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

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
  function stop() { setRunning(false); }
  function reset() { setRunning(false); setCountdown(60); }

  return (
    <div className="page-confidence">
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Top bar with Alfred help button */}
        <div className="card" style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open Confidence help"
            title="Need a hand? Ask Alfred"
            style={{
              position: "absolute",
              top: 8, right: 8,
              border: "none", background: "transparent", padding: 0,
              cursor: "pointer", lineHeight: 0, zIndex: 10,
            }}
          >
            {imgOk ? (
              <img
                src={CONF_ALFRED_SRC}
                alt="Confidence Alfred — open help"
                style={{ width: 48, height: 48 }}
                onError={() => setImgOk(false)}
              />
            ) : (
              <span
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, borderRadius: 999,
                  border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700,
                }}
              >
                ?
              </span>
            )}
          </button>

          <div
            className="confidence-toolbar"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
          >
            <div>
              <h1 style={{ margin: 0 }}>Confidence Moves</h1>
              <div className="muted">A focused minute before your meeting or interview.</div>
            </div>

            <div className="confidence-toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

        {tab === "pose" && <PowerPose />}
        {tab === "breath" && <Breathing running={running} />}
        {tab === "affirm" && <Affirmation running={running} />}

        {/* Help modal */}
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Confidence — Help">
          <div style={{ display: "flex", gap: 16 }}>
            {imgOk && <img src={CONF_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
            <div style={{ flex: 1 }}>
              <ConfidenceHelpContent />
            </div>
          </div>
        </Modal>
      </div>
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
   Power Pose (image with fallback)
   =========================== */
function PowerPose() {
  const [imgOk, setImgOk] = useState(true);

  return (
    <div className="card confidence-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Left: hero image or fallback silhouette */}
      <div style={{ display: "grid", placeItems: "center", minHeight: 260, padding: 8 }}>
        {imgOk ? (
          <img
            src={CONF_ALFRED_SRC}
            alt="Power pose — Alfred"
            style={{ width: "100%", maxWidth: 420, height: "auto", borderRadius: 12 }}
            onError={() => setImgOk(false)}
          />
        ) : (
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
            <ellipse cx="150" cy="232" rx="48" ry="10" fill="#000" opacity=".1" />
            <path
              d="M150 96 C 110 100, 76 122, 66 160 C 120 152, 170 192, 214 206 C 224 182, 210 142, 192 118 C 178 104, 164 98, 150 96 Z"
              fill="url(#capeGrad)"
            />
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
        )}
      </div>

      {/* Right: instructions */}
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
      </div>
    </div>
  );
}

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
      <div style={{ display: "grid", placeItems: "center", minHeight: 240 }}>
        <div
          style={{
            width: size, height: size, transform: `scale(${scale})`,
            transition: "transform 900ms ease-in-out", position: "relative"
          }}
        >
          <div style={{ position: "absolute", inset: 0, borderRadius: 9999, border: "6px solid #111", opacity: 0.15 }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: 9999, border: "6px solid #111", opacity: 0.8, boxShadow: "0 0 24px rgba(0,0,0,0.08) inset" }} />
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
        <div className="muted">Follow the circle — expand on inhale, shrink on exhale. Holds stay steady.</div>
      </div>
    </div>
  );
}
function PatternButton({
  current, setKey, k, label,
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

/* ===========================
   Affirmation Flash
   =========================== */
function Affirmation({ running }: { running: boolean }) {
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
    <div className="card confidence-layout">
      <div style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Affirmation</h2>
        <div
          style={{
            padding: 20, border: "1px solid #e5e7eb", borderRadius: 12,
            fontSize: 22, fontWeight: 700, lineHeight: 1.3, textAlign: "center",
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
