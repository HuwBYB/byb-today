import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

type Mode = "business" | "finance" | "health" | "friend";
type Msg = { role: "user" | "assistant"; content: string };

// ---------- Persona meta ----------
const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: "business", label: "Business Advisor", emoji: "💼" },
  { key: "finance",  label: "Financial Advisor", emoji: "💷" },
  { key: "health",   label: "Health Advisor",    emoji: "💪" },
  { key: "friend",   label: "Friend",            emoji: "🧑‍🤝‍🧑" },
];

const TONES: Record<Mode, { opener: string; signoff: string }> = {
  business: { opener: "Direct plan, minimal fluff.", signoff: "Onward. — A" },
  finance:  { opener: "Caution + clarity. Numbers first.", signoff: "Steady as we go. — A" },
  health:   { opener: "Warm + practical. Sustainable beats extreme.", signoff: "You've got this. — A" },
  friend:   { opener: "Empathy first. Then tiny wins.", signoff: "Proud of you. — A" },
};

// ---------- Public path helper ----------
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) || "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}

// Try multiple filenames
const ALFRED_CANDIDATES = [
  "/alfred/Today_Alfred.png",
  "/alfred/Today Alfred.png",
  "/alfred/Today_Alfred.webp",
  "/alfred/Today Alfred.webp",
  "/alfred/Today_Alfred.jpg",
  "/alfred/Today Alfred.jpg",
].map(publicPath);

// ---------- Modal ----------
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => { if (open && closeRef.current) closeRef.current.focus(); }, [open]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 2000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, width: "100%", background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// ---------- Help content ----------
function AlfredHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Alfred turns vague thoughts into clear next actions — and drops them straight onto Today.</em></p>
      <h4 style={{ margin: 0 }}>How to use Alfred</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pick a persona</b>: Business, Finance, Health, or Friend.</li>
        <li><b>Ask clearly</b>: “Plan 3 sales actions for today.” “Draft a 20-min dumbbell workout.”</li>
        <li><b>Quick add</b>: Select bullets below the chat → <i>＋ Add</i> → choose a section.</li>
      </ul>
      <h4 style={{ margin: 0 }}>One-tap mini-flows</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Sales Sprint</b> (15m), <b>Money Check-in</b> (10m), <b>Health Micro-plan</b> (20m), <b>Reset Ritual</b> (5m)</li>
      </ul>
      <p><strong>Bottom line:</strong> Chat → extract steps → add to Today in seconds.</p>
    </div>
  );
}

// ---------- Utils ----------
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

// Heuristic action extraction from assistant text
function extractActions(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const bullets = lines.filter(l => /^([-*•]|\d+\.)\s+/.test(l))
    .map(l => l.replace(/^([-*•]|\d+\.)\s+/, "").trim());
  // fallback: sentence-split first 5 imperative-ish lines
  if (bullets.length) return bullets.slice(0, 12);
  return text.split(/[.;]\s+/).filter(s => s.length > 0 && /\b(prepare|email|call|draft|review|log|plan|write|send|schedule|clean|walk|hydrate|stretch|update)\b/i.test(s)).slice(0, 8);
}

type SectionKey = "general" | "big_goal" | "exercise" | "gratitude";
const SECTION_LABELS: Record<SectionKey, string> = {
  general: "General",
  big_goal: "Big Goal",
  exercise: "Exercise",
  gratitude: "Gratitude",
};

// Naive section guesser
function guessSection(s: string): SectionKey {
  const t = s.toLowerCase();
  if (/(deadlift|squat|run|km|gym|workout|warm[- ]?up|sets?)/.test(t)) return "exercise";
  if (/(gratitude|thankful|appreciate|3 things)/.test(t)) return "gratitude";
  if (/(milestone|big goal|phase|roadmap|deliverable)/.test(t)) return "big_goal";
  return "general";
}

// ---------- Mini coach flows ----------
type FlowKey = "sales" | "money" | "health" | "reset";
const FLOWS: Record<FlowKey, { label: string; prompt: string; persona: Mode }> = {
  sales: {
    label: "Sales Sprint (15m)",
    persona: "business",
    prompt: "Create a compact 3-step sales sprint for today: 1) 3 ICP leads to reach 2) one follow-up 3) one nurture touch. Each step 1 sentence, actionable, starting with a verb. End with a brief pep line.",
  },
  money: {
    label: "Money Check-in (10m)",
    persona: "finance",
    prompt: "Give me a 3-step 10-minute finance check-in for today: one expense to review, one saving to action, one number to update. Each step imperative, one line.",
  },
  health: {
    label: "Health Micro-plan (20m)",
    persona: "health",
    prompt: "Design a simple 20-minute dumbbell-only workout: warm-up (1 line), 3 sets (each 1 line), cooldown (1 line). Include reps/time. Keep it encouraging.",
  },
  reset: {
    label: "Reset Ritual (5m)",
    persona: "friend",
    prompt: "Create a 5-minute reset ritual: 1) 1 gratitude 2) 1 easy win (2 min) 3) 1 tidy/clear step. Keep calm and kind.",
  },
};

export default function AlfredScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("business");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Help modal & image
  const [showHelp, setShowHelp] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [imgOk, setImgOk] = useState(true);
  const src = ALFRED_CANDIDATES[imgIdx] ?? "";

  // Action extraction & selection pane
  const [extracted, setExtracted] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [section, setSection] = useState<SectionKey>("general");
  const [celebrate, setCelebrate] = useState(false);

  // Contextual hints (very light; you can wire real app state via props later)
  const hour = new Date().getHours();
  const dayHint = hour >= 18 ? "Late? Park one thing for tomorrow and sleep well." :
                   hour <= 9 ? "Morning momentum: one Big Goal step first." :
                   "Keep it tight. Tiny steps count.";

  // auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) setErr(error.message);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // persist conversations per mode
  useEffect(() => {
    const saved = localStorage.getItem(lsKey(mode));
    setMessages(saved ? JSON.parse(saved) : []);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(lsKey(mode), JSON.stringify(messages));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mode]);

  function lsKey(m: Mode) { return `alfred:conv:${m}`; }

  // API send
  async function send(customPrompt?: string) {
    const q = (customPrompt ?? input).trim();
    if (!q) return;
    setErr(null);
    setBusy(true);

    // persona tone wrapper
    const preface = `${TONES[mode].opener}\nUser: ${q}\nAssistant style: ${mode}`;
    const newMsgs = [...messages, { role: "user", content: preface } as Msg];
    setMessages(prev => [...prev, { role: "user", content: input || customPrompt || "" } as Msg]);
    setInput("");

    try {
      const res = await fetch("/api/alfred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: newMsgs }),
      });
      if (!res.ok) throw new Error(`Alfred error: ${res.status}`);
      const data = await res.json();
      let text: string = (data.text || "…").trim();
      // sign-off
      if (!text.endsWith(TONES[mode].signoff)) text += `\n\n${TONES[mode].signoff}`;
      setMessages(prev => [...prev, { role: "assistant", content: text }]);

      // extract actions for quick add
      const acts = extractActions(text);
      setExtracted(acts);
      setSelected(Object.fromEntries(acts.map((_, i) => [i, true])));
      // auto-choose section by majority guess
      const guesses = acts.map(guessSection);
      const winner = (["exercise","gratitude","big_goal","general"] as SectionKey[])
        .sort((a,b) => guesses.filter(g=>g===b).length - guesses.filter(g=>g===a).length)[0] as SectionKey;
      setSection(winner);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // mini flow launcher
  async function runFlow(k: FlowKey) {
    const m = FLOWS[k];
    setMode(m.persona);
    await send(m.prompt);
  }

  // Quick add: write to Supabase
  async function addTasks(titles: string[], sec: SectionKey) {
    if (!userId) { setErr("Not signed in."); return; }
    if (titles.length === 0) return;
    const iso = toISO(new Date());

    const rows = titles.map(title => ({
      user_id: userId,
      title,
      due_date: iso,
      priority: 3,
      source: "alfred",
      category: sec === "general" ? null : sec,
      category_color: null,
      status: "todo",
    }));

    const { error } = await supabase.from("tasks").insert(rows);
    if (error) { setErr(error.message); return; }

    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 900);
    if ((navigator as any).vibrate) (navigator as any).vibrate(8);
  }

  // UI helpers
  const quickAdds = useMemo(() => extracted, [extracted]);
  const selectedTitles = useMemo(() => quickAdds.filter((_, i) => selected[i]), [quickAdds, selected]);
  function toggleSel(i: number) { setSelected(prev => ({ ...prev, [i]: !prev[i] })); }

  // one-tap suggestion chips
  const chips = [
    { label: "Break into 3 steps", action: () => setInput(i => `${i.trim()} — break into 3 concrete steps for today.`) },
    { label: "Make it for today", action: () => setInput(i => `${i.trim()} — restrict plan to what I can do today.`) },
    { label: "Turn into checklist", action: () => setInput(i => `${i.trim()} — output as a checklist with 3–6 bullets.`) },
    ...(mode === "business" ? [{ label: "Draft outreach email", action: () => setInput("Draft a 100-word cold email for our top ICP with one CTA.") }] : []),
    ...(mode === "health" ? [{ label: "20-min workout", action: () => setInput("Create a 20-minute dumbbell workout, 3 sets + short cardio finisher.") }] : []),
  ];

  return (
    <div className="two-col" style={{ alignItems: "start" }}>
      {/* Sidebar */}
      <aside className="card sidebar-sticky" style={{ position: "relative", display: "grid", gap: 10, paddingRight: 64 }}>
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Alfred help"
          title="Need a hand? Ask Alfred"
          style={{ position: "absolute", top: 8, right: 8, cursor: "pointer", border: "none", background: "transparent", lineHeight: 0 }}
        >
          {imgOk && src ? (
            <img
              src={src}
              alt="Alfred — open help"
              draggable={false}
              style={{ display: "block", maxWidth: 44, maxHeight: 44, objectFit: "contain" }}
              onError={() => { if (imgIdx < ALFRED_CANDIDATES.length - 1) setImgIdx(i => i + 1); else setImgOk(false); }}
            />
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700 }}>?</span>
          )}
        </button>

        <h2 style={{ margin: 0 }}>Alfred</h2>
        <div className="muted" style={{ fontSize: 12 }}>Choose a persona</div>
        <div style={{ display: "grid", gap: 6 }}>
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={mode === m.key ? "btn-primary" : ""}
              style={{ borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}
              aria-pressed={mode === m.key}
            >
              <span aria-hidden>{m.emoji}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="card" style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Mini coach</div>
          {Object.entries(FLOWS).map(([k, v]) => (
            <button key={k} onClick={() => runFlow(k as FlowKey)} style={{ textAlign: "left" }}>{v.label}</button>
          ))}
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{dayHint}</div>
      </aside>

      {/* Chat pane */}
      <main className="card" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, minHeight: 420 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{MODES.find(m => m.key === mode)?.label}</h3>
          <span className="muted">/ chat</span>
        </div>

        <div ref={scrollRef} style={{ overflowY: "auto", maxHeight: "50vh", paddingRight: 4 }}>
          {messages.length === 0 && (
            <div className="muted">
              Tip: “Plan 3 sales actions for today.” or run a Mini coach flow.
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                background: m.role === "assistant" ? "#f8fafc" : "#eef2ff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10
              }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  {m.role === "assistant" ? "Alfred" : "You"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
          </div>
        </div>

        {/* One-tap chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c, i) => (
            <button key={i} onClick={c.action} style={{ borderRadius: 999, padding: "6px 10px", border: "1px solid var(--border)" }}>{c.label}</button>
          ))}
        </div>

        {/* Extraction → Add to Today */}
        {quickAdds.length > 0 && (
          <div className="card" style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "grid", gap: 8 }}>
            <div className="section-title" style={{ marginBottom: 2 }}>Actions from Alfred</div>
            <div style={{ display: "grid", gap: 6 }}>
              {quickAdds.map((t, idx) => (
                <label key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={!!selected[idx]} onChange={() => toggleSel(idx)} />
                  <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="muted">Section:</span>
              {(["general","big_goal","exercise","gratitude"] as SectionKey[]).map(k => (
                <button key={k} onClick={() => setSection(k)} aria-pressed={section===k}
                        style={{
                          borderRadius: 999, padding: "6px 10px",
                          border: "1px solid var(--border)",
                          background: section===k ? "hsl(var(--pastel-hsl) / .45)" : "var(--card)"
                        }}>
                  {SECTION_LABELS[k]}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={() => addTasks(selectedTitles, section)} className="btn-primary" style={{ borderRadius: 10 }}>
                ＋ Add {selectedTitles.length || "0"} to Today
              </button>
            </div>
          </div>
        )}

        {/* Input row */}
        <div style={{ display: "grid", gap: 6 }}>
          {err && <div style={{ color: "red" }}>{err}</div>}
          <textarea
            rows={3}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) send(); } }}
            placeholder="Type your question… (Shift+Enter for newline)"
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setMessages([])} disabled={busy}>Clear</button>
            <button className="btn-primary" onClick={() => send()} disabled={busy || !input.trim()} style={{ borderRadius: 10 }}>
              {busy ? "Thinking…" : "Send"}
            </button>
          </div>
        </div>
      </main>

      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Alfred — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {src && (
            <img
              src={src}
              alt=""
              aria-hidden="true"
              style={{ display: "block", maxWidth: 72, maxHeight: 72, objectFit: "contain", flex: "0 0 auto" }}
              onError={() => { if (imgIdx < ALFRED_CANDIDATES.length - 1) setImgIdx(i => i + 1); else setImgOk(false); }}
            />
          )}
          <div style={{ flex: 1 }}>
            <AlfredHelpContent />
          </div>
        </div>
      </Modal>

      {/* confetti (simple) */}
      {celebrate && <ConfettiBurst />}
    </div>
  );
}

// ---------- Confetti ----------
function ConfettiBurst() {
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:3000 }}>
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
