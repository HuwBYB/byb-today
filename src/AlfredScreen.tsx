import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ============================================================================
 * Types
 * ==========================================================================*/
type Mode = "business" | "finance" | "health" | "friend";
type Msg = { role: "user" | "assistant"; content: string };

type SectionKey = "general" | "big_goal" | "exercise" | "gratitude";

/* ============================================================================
 * Persona meta
 * ==========================================================================*/
const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: "business", label: "Business Advisor", emoji: "💼" },
  { key: "finance",  label: "Financial Advisor", emoji: "💷" },
  { key: "health",   label: "Health Coach",      emoji: "💪" },
  { key: "friend",   label: "Supportive Friend", emoji: "🧑‍🤝‍🧑" },
];

const TONES: Record<Mode, { opener: string; signoff: string }> = {
  business: { opener: "Direct plan, minimal fluff.",           signoff: "Onward. — Eva" },
  finance:  { opener: "Caution + clarity. Numbers first.",     signoff: "Steady as we go. — Eva" },
  health:   { opener: "Warm + practical. Sustainable beats extreme.", signoff: "You've got this. — Eva" },
  friend:   { opener: "Empathy first. Then tiny wins.",        signoff: "Proud of you. — Eva" },
};

const SECTION_LABELS: Record<SectionKey, string> = {
  general: "General",
  big_goal: "Big Goal",
  exercise: "Exercise",
  gratitude: "Gratitude",
};

/* ============================================================================
 * Small utils
 * ==========================================================================*/
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

/** Heuristic extraction of action items from assistant text */
function extractActions(text: string): string[] {
  const lines: string[] = text.split(/\r?\n/).map((l: string) => l.trim());
  const bullets: string[] = lines
    .filter((l: string) => /^([-*•]|\d+\.)\s+/.test(l))
    .map((l: string) => l.replace(/^([-*•]|\d+\.)\s+/, "").trim());

  if (bullets.length) return bullets.slice(0, 12);

  const sentences: string[] = text.split(/[.;]\s+/);
  return sentences
    .filter(
      (s: string) =>
        s.length > 0 &&
        /\b(prepare|email|call|draft|review|log|plan|write|send|schedule|clean|walk|hydrate|stretch|update|design|setup|configure|build|launch|learn|research|outline|organize)\b/i.test(
          s
        )
    )
    .slice(0, 8);
}

/** Naive section guesser for quick-add */
function guessSection(s: string): SectionKey {
  const t = s.toLowerCase();
  if (/(deadlift|squat|run|km|gym|workout|warm[- ]?up|sets?)/.test(t)) return "exercise";
  if (/(gratitude|thankful|appreciate|3 things)/.test(t)) return "gratitude";
  if (/(milestone|big goal|phase|roadmap|deliverable|launch|prototype)/.test(t)) return "big_goal";
  return "general";
}

/* ============================================================================
 * Mini coach flows (one-taps)
 * ==========================================================================*/
type FlowKey = "sales" | "money" | "health" | "reset";
const FLOWS: Record<FlowKey, { label: string; prompt: string; persona: Mode }> = {
  sales: {
    label: "Sales Sprint (15m)",
    persona: "business",
    prompt:
      "Create a compact 3-step sales sprint for today: 1) 3 ICP leads to reach 2) one follow-up 3) one nurture touch. Each step 1 sentence, actionable, starting with a verb. End with a brief pep line.",
  },
  money: {
    label: "Money Check-in (10m)",
    persona: "finance",
    prompt:
      "Give me a 3-step 10-minute finance check-in for today: one expense to review, one saving to action, one number to update. Each step imperative, one line.",
  },
  health: {
    label: "Health Micro-plan (20m)",
    persona: "health",
    prompt:
      "Design a simple 20-minute dumbbell-only workout: warm-up (1 line), 3 sets (each 1 line), cooldown (1 line). Include reps/time. Keep it encouraging.",
  },
  reset: {
    label: "Reset Ritual (5m)",
    persona: "friend",
    prompt:
      "Create a 5-minute reset ritual: 1) 1 gratitude 2) 1 easy win (2 min) 3) 1 tidy/clear step. Keep calm and kind.",
  },
};

/* ============================================================================
 * Modal (simple)
 * ==========================================================================*/
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

/* ============================================================================
 * Help content
 * ==========================================================================*/
function EvaHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Eva turns vague questions into clear next actions — and can file them straight into your task list or Big Goal.</em></p>
      <h4 style={{ margin: 0 }}>How to use Eva</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pick a persona</b>: Business, Finance, Health, or Friend.</li>
        <li><b>Ask anything</b>: “How would I build a website?” “Draft a 20-min dumbbell workout.”</li>
        <li><b>Convert answers into work</b>: Eva can split big ideas into stages and add them as tasks (or a Big Goal).</li>
      </ul>
      <p><strong>Tip:</strong> Use the one-tap <i>Mini coach</i> flows for fast momentum.</p>
    </div>
  );
}

/* ============================================================================
 * Confetti
 * ==========================================================================*/
function ConfettiBurst() {
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:3000 }}>
      {pieces.map((_, i: number) => (
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

/* ============================================================================
 * Main
 * ==========================================================================*/
export default function EvaScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("business");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Help modal
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Action extraction & quick-add
  const [extracted, setExtracted] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [section, setSection] = useState<SectionKey>("general");
  const [celebrate, setCelebrate] = useState<boolean>(false);

  // Smart conversion cues
  const [offerStructure, setOfferStructure] = useState<boolean>(false);
  const [offerBigGoal, setOfferBigGoal] = useState<boolean>(false);

  // Time-based hint
  const hour = new Date().getHours();
  const dayHint =
    hour >= 18 ? "Late? Park one thing for tomorrow and sleep well." :
    hour <= 9  ? "Morning momentum: one Big Goal step first." :
                 "Keep it tight. Tiny steps count.";

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) setErr(error.message);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- persist conversations per mode ----- */
  useEffect(() => {
    const saved = localStorage.getItem(lsKey(mode));
    setMessages(saved ? (JSON.parse(saved) as Msg[]) : []);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(lsKey(mode), JSON.stringify(messages));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mode]);

  function lsKey(m: Mode) { return `eva:conv:${m}`; }

  /* ----- API send ----- */
  async function send(customPrompt?: string) {
    const q = (customPrompt ?? input).trim();
    if (!q) return;
    setErr(null);
    setBusy(true);

    // persona wrapper
    const preface = `${TONES[mode].opener}\nUser: ${q}\nAssistant style: ${mode}`;
    const newMsgs: Msg[] = [...messages, { role: "user", content: preface }];

    // show the clean user text in the chat
    setMessages(prev => [...prev, { role: "user", content: customPrompt ?? input }]);
    setInput("");

    try {
      const res = await fetch("/api/eva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: newMsgs }),
      });
      if (!res.ok) throw new Error(`Eva error: ${res.status}`);
      const data = await res.json();
      let text: string = (data.text || "…").trim();
      if (!text.endsWith(TONES[mode].signoff)) text += `\n\n${TONES[mode].signoff}`;
      setMessages(prev => [...prev, { role: "assistant", content: text }]);

      // Extract actions & select by default
      const acts = extractActions(text);
      setExtracted(acts);
      setSelected(Object.fromEntries(acts.map((_, i: number) => [i, true])));

      // Guess section by majority
      const guesses: SectionKey[] = acts.map((a: string) => guessSection(a));
      const order: SectionKey[] = ["exercise", "gratitude", "big_goal", "general"];
      const winner = order.sort((a: SectionKey, b: SectionKey) =>
        guesses.filter(g => g === b).length - guesses.filter(g => g === a).length
      )[0] as SectionKey;
      setSection(winner);

      // Smart conversion heuristics
      const qLower = q.toLowerCase();
      const looksBig =
        /how (do|would) i\b|build|create|start|launch|learn|website|business|app|course|book|podcast|agency|roadmap|strategy|plan/.test(qLower) ||
        acts.length >= 6;
      setOfferStructure(looksBig);
      setOfferBigGoal(looksBig);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ----- mini flow launcher ----- */
  async function runFlow(k: FlowKey) {
    const m = FLOWS[k];
    setMode(m.persona);
    await send(m.prompt);
  }

  /* ----- Quick add to tasks ----- */
  async function addTasks(titles: string[], sec: SectionKey) {
    if (!userId) { setErr("Not signed in."); return; }
    if (titles.length === 0) return;
    const iso = toISO(new Date());

    const rows = titles.map((title: string) => ({
      user_id: userId,
      title,
      due_date: iso,
      priority: 3,
      source: "eva",
      category: sec === "general" ? null : sec,
      category_color: null,
      status: "todo",
    }));

    const { error } = await supabase.from("tasks").insert(rows);
    if (error) { setErr(error.message); return; }

    setCelebrate(true);
    window.setTimeout(() => setCelebrate(false), 900);
    if ((navigator as any).vibrate) (navigator as any).vibrate(8);
  }

  /* ----- Convert to Big Goal (as categorized tasks) ----- */
  async function addAsBigGoal(titleHint?: string) {
    if (!userId) { setErr("Not signed in."); return; }
    // Make a lightweight "goal seed" task + today note
    const iso = toISO(new Date());
    const seedTitle = (titleHint || messages[messages.length - 1]?.content || "New Big Goal").split("\n")[0].slice(0, 140);

    const { error } = await supabase.from("tasks").insert([{
      user_id: userId,
      title: seedTitle,
      due_date: iso,
      priority: 4,
      source: "eva_big_goal",
      category: "big_goal",
      category_color: null,
      status: "todo",
    }]);
    if (error) { setErr(error.message); return; }

    setCelebrate(true);
    window.setTimeout(() => setCelebrate(false), 900);
    if ((navigator as any).vibrate) (navigator as any).vibrate(12);
  }

  /* ----- Structure prompt helpers ----- */
  function requestPhasedPlan() {
    const base = (messages[messages.length - 1]?.role === "user" ? messages[messages.length - 1].content : "") || input;
    const ask =
      `${base}\n\nPlease break this into phases (Phase 1..N), each with 3–6 concrete tasks. ` +
      `Make tasks one line each starting with a verb. If relevant, suggest a sensible timeline. ` +
      `End with: "Would you like me to add these tasks now?"`;
    send(ask);
  }

  /* ----- UI helpers ----- */
  const quickAdds = useMemo(() => extracted, [extracted]);
  const selectedTitles = useMemo(() => quickAdds.filter((_, i: number) => selected[i]), [quickAdds, selected]);
  function toggleSel(i: number) { setSelected(prev => ({ ...prev, [i]: !prev[i] })); }

  const chips: Array<{ label: string; action: () => void }> = [
    { label: "Break into 3 steps", action: () => setInput((i: string) => `${i.trim()} — break into 3 concrete steps for today.`) },
    { label: "Make it for today", action: () => setInput((i: string) => `${i.trim()} — restrict plan to what I can do today.`) },
    { label: "Turn into checklist", action: () => setInput((i: string) => `${i.trim()} — output as a checklist with 3–6 bullets.`) },
    ...(mode === "business" ? [{ label: "Draft outreach email", action: () => setInput("Draft a 100-word cold email for our top ICP with one CTA.") }] : []),
    ...(mode === "health" ? [{ label: "20-min workout", action: () => setInput("Create a 20-minute dumbbell workout, 3 sets + short cardio finisher.") }] : []),
  ];

  /* ----- Render ----- */
  return (
    <div className="two-col" style={{ alignItems: "start" }}>
      {/* Sidebar */}
      <aside className="card sidebar-sticky" style={{ position: "relative", display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h2 style={{ margin: 0 }}>Eva</h2>
          <div className="muted" style={{ fontSize: 12 }}>Enhanced Virtual Assistant (EVA)</div>
        </div>

        <div className="card" style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Persona</div>
          {MODES.map((m) => (
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
          {Object.entries(FLOWS).map(([k, v]: [string, { label: string } & { prompt: string; persona: Mode }]) => (
            <button key={k} onClick={() => runFlow(k as FlowKey)} style={{ textAlign: "left" }}>
              {v.label}
            </button>
          ))}
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{dayHint}</div>

        <button className="btn-soft" onClick={() => setShowHelp(true)} style={{ marginTop: 8 }}>
          How Eva works
        </button>
      </aside>

      {/* Chat pane */}
      <main className="card" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, minHeight: 420 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{MODES.find((m) => m.key === mode)?.label}</h3>
          <span className="muted">/ chat</span>
        </div>

        <div ref={scrollRef} style={{ overflowY: "auto", maxHeight: "50vh", paddingRight: 4 }}>
          {messages.length === 0 && (
            <div className="muted">
              Try: “How would I build a website?” — then let Eva turn it into stages and add to your tasks.
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {messages.map((m: Msg, i: number) => (
              <div key={i} style={{
                background: m.role === "assistant" ? "#f8fafc" : "#eef2ff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10
              }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  {m.role === "assistant" ? "Eva" : "You"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
          </div>

          {/* Smart conversion banner when it looks like a big task/goal */}
          {(offerStructure || offerBigGoal) && (
            <div className="card card--wash" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 600 }}>Turn this into a plan?</div>
              {offerStructure && (
                <button className="btn-soft" onClick={requestPhasedPlan}>
                  Break into phases & tasks
                </button>
              )}
              {offerBigGoal && (
                <button className="btn-soft" onClick={() => addAsBigGoal(messages.findLast((mm: Msg) => mm.role === "user")?.content)}>
                  Add as Big Goal
                </button>
              )}
            </div>
          )}
        </div>

        {/* One-tap chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c: { label: string; action: () => void }, i: number) => (
            <button key={i} onClick={c.action} style={{ borderRadius: 999, padding: "6px 10px", border: "1px solid var(--border)" }}>
              {c.label}
            </button>
          ))}
        </div>

        {/* Extraction → Add to Today */}
        {quickAdds.length > 0 && (
          <div className="card" style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "grid", gap: 8 }}>
            <div className="section-title" style={{ marginBottom: 2 }}>Actions from Eva</div>
            <div style={{ display: "grid", gap: 6 }}>
              {quickAdds.map((t: string, idx: number) => (
                <label key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={!!selected[idx]} onChange={() => toggleSel(idx)} />
                  <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="muted">Section:</span>
              {(["general","big_goal","exercise","gratitude"] as SectionKey[]).map((k: SectionKey) => (
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) send(); } }}
            placeholder="Ask anything… (Shift+Enter for newline)"
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setMessages([])} disabled={busy}>Clear</button>
            <button className="btn-primary" onClick={() => send()} disabled={busy || !input.trim()} style={{ borderRadius: 10 }}>
              {busy ? "Thinking…" : "Send"}
            </button>
          </div>
        </div>
      </main>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Eva — Help">
        <EvaHelpContent />
      </Modal>

      {celebrate && <ConfettiBurst />}
    </div>
  );
}
