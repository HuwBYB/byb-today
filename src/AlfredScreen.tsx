// EvaScreen.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ========================= Types & constants ========================= */
type Mode = "business" | "finance" | "health" | "friend";
type Msg = { role: "user" | "assistant"; content: string };

type SectionKey = "general" | "big_goal" | "exercise" | "gratitude";
const SECTION_LABELS: Record<SectionKey, string> = {
  general: "General",
  big_goal: "Big Goal",
  exercise: "Exercise",
  gratitude: "Gratitude",
};

const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: "business", label: "Business Advisor", emoji: "💼" },
  { key: "finance",  label: "Financial Advisor", emoji: "💷" },
  { key: "health",   label: "Health Advisor",    emoji: "💪" },
  { key: "friend",   label: "Friendly Coach",    emoji: "🧑‍🤝‍🧑" },
];

const TONES: Record<Mode, { opener: string; signoff: string }> = {
  business: { opener: "Direct plan, minimal fluff.",             signoff: "Onward. — EVA" },
  finance:  { opener: "Caution + clarity. Numbers first.",       signoff: "Steady as we go. — EVA" },
  health:   { opener: "Warm + practical. Sustainable > extreme.", signoff: "You've got this. — EVA" },
  friend:   { opener: "Empathy first. Then tiny wins.",           signoff: "Proud of you. — EVA" },
};

/* ========================= Small utilities ========================= */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

// Fallback instead of Array.prototype.findLast (keeps older lib targets happy)
function lastUserMessageContent(msgs: Msg[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return msgs[i].content;
  }
  return undefined;
}

// Heuristic action extraction from assistant text
function extractActions(text: string): string[] {
  const lines: string[] = text.split(/\r?\n/).map((l: string) => l.trim());
  const bullets: string[] = lines
    .filter((l: string) => /^([-*•]|\d+\.)\s+/.test(l))
    .map((l: string) => l.replace(/^([-*•]|\d+\.)\s+/, "").trim());

  if (bullets.length) return bullets.slice(0, 12);

  // fallback: sentence-split first 8 imperative-ish lines
  const sentences: string[] = text
    .split(/[.;]\s+/)
    .filter((s: string) => s.length > 0 && /\b(prepare|email|call|draft|review|log|plan|write|send|schedule|clean|walk|hydrate|stretch|update|research|set up|create)\b/i.test(s));
  return sentences.slice(0, 8);
}

// Naive section guesser
function guessSection(s: string): SectionKey {
  const t = s.toLowerCase();
  if (/(deadlift|squat|run|km|gym|workout|warm[- ]?up|sets?)/.test(t)) return "exercise";
  if (/(gratitude|thankful|appreciate|3 things)/.test(t)) return "gratitude";
  if (/(milestone|big goal|phase|roadmap|deliverable|stage)/.test(t)) return "big_goal";
  return "general";
}

/* ========================= Mini coach flows ========================= */
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

/* ========================= Component ========================= */
export default function EvaScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("business");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Action extraction & selection pane
  const [extracted, setExtracted] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [section, setSection] = useState<SectionKey>("general");
  const [celebrate, setCelebrate] = useState(false);

  // contextual hint
  const hour = new Date().getHours();
  const dayHint = hour >= 18 ? "Late? Park one thing for tomorrow and sleep well." :
                   hour <= 9 ? "Morning momentum: one Big Goal step first." :
                   "Keep it tight. Tiny steps count.";

  /* ---------- Auth ---------- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) setErr(error.message);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ---------- Persist conversations per mode ---------- */
  useEffect(() => {
    const saved = localStorage.getItem(lsKey(mode));
    setMessages(saved ? (JSON.parse(saved) as Msg[]) : []);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(lsKey(mode), JSON.stringify(messages));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mode]);

  function lsKey(m: Mode) { return `eva:conv:${m}`; }

  /* ---------- Chat send ---------- */
  async function send(customPrompt?: string) {
    const q = (customPrompt ?? input).trim();
    if (!q) return;
    setErr(null);
    setBusy(true);

    const preface = `${TONES[mode].opener}\nUser: ${q}\nAssistant style: ${mode}`;
    const payloadMsgs: Msg[] = [...messages, { role: "user", content: preface }];

    // show the clean user message in the UI (not the preface)
    setMessages(prev => [...prev, { role: "user", content: customPrompt ?? input }]);
    setInput("");

    try {
      // keep existing backend route to avoid server changes; you can rename later to /api/eva
      const res = await fetch("/api/alfred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: payloadMsgs }),
      });
      if (!res.ok) throw new Error(`EVA error: ${res.status}`);
      const data = await res.json();
      let text: string = (data.text || "…").trim();
      if (!text.endsWith(TONES[mode].signoff)) text += `\n\n${TONES[mode].signoff}`;

      setMessages(prev => [...prev, { role: "assistant", content: text }]);

      // extract actions for quick add
      const acts = extractActions(text);
      setExtracted(acts);
      setSelected(Object.fromEntries(acts.map((_, i) => [i, true])));

      // auto-choose section by majority guess
      const guesses = acts.map((a: string) => guessSection(a));
      const order: SectionKey[] = ["exercise", "gratitude", "big_goal", "general"];
      const winner = order
        .map((k) => ({ k, c: guesses.filter((g) => g === k).length }))
        .sort((a, b) => b.c - a.c)[0]?.k || "general";
      setSection(winner);
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Flows ---------- */
  async function runFlow(k: FlowKey) {
    const m = FLOWS[k];
    setMode(m.persona);
    await send(m.prompt);
  }

  /* ---------- Task/Goal writers ---------- */
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
    setTimeout(() => setCelebrate(false), 900);
    if ((navigator as any).vibrate) (navigator as any).vibrate(8);
  }

  // Treat “Add as Big Goal” as a kickoff task under big_goal (works with your Wins logic)
  async function addAsBigGoal(seed?: string) {
    if (!userId) { setErr("Not signed in."); return; }
    const title = (seed || lastUserMessageContent(messages) || "New Big Goal").trim();
    const iso = toISO(new Date());

    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title,
      due_date: iso,
      priority: 3,
      source: "big_goal",
      category: "big_goal",
      category_color: null,
      status: "todo",
    } as any);

    if (error) { setErr(error.message); return; }

    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 900);
    if ((navigator as any).vibrate) (navigator as any).vibrate(8);
  }

  /* ---------- UI helpers ---------- */
  const quickAdds = useMemo(() => extracted, [extracted]);
  const selectedTitles = useMemo(
    () => quickAdds.filter((_, i) => selected[i]),
    [quickAdds, selected]
  );
  function toggleSel(i: number) { setSelected(prev => ({ ...prev, [i]: !prev[i] })); }

  const chips = [
    { label: "Break into 3 steps", action: () => setInput(i => `${i.trim()} — break into 3 concrete steps for today.`) },
    { label: "Make it for today",  action: () => setInput(i => `${i.trim()} — restrict plan to what I can do today.`) },
    { label: "Turn into checklist", action: () => setInput(i => `${i.trim()} — output as a checklist with 3–6 bullets.`) },
    ...(mode === "business" ? [{ label: "Draft outreach email", action: () => setInput("Draft a 100-word cold email for our top ICP with one CTA.") }] : []),
    ...(mode === "health"   ? [{ label: "20-min workout",      action: () => setInput("Create a 20-minute dumbbell workout, 3 sets + short cardio finisher.") }] : []),
  ];

  /* ========================= Render ========================= */
  return (
    <div className="two-col" style={{ alignItems: "start" }}>
      {/* Sidebar */}
      <aside className="card sidebar-sticky" style={{ display: "grid", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Eva <span className="muted" style={{ fontWeight: 500 }}>(EVA — Enhanced Virtual Assistant)</span></h2>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Ask anything. Eva answers, then helps turn it into tasks or goals.
          </div>
        </div>

        <div>
          <div className="section-title">Choose a persona</div>
          <div style={{ display: "grid", gap: 6 }}>
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={mode === m.key ? "btn-primary" : ""}
                style={{ borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}
                aria-pressed={mode === m.key}
                title={m.label}
              >
                <span aria-hidden>{m.emoji}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Mini coach</div>
          {(Object.keys(FLOWS) as FlowKey[]).map((k) => (
            <button key={k} onClick={() => runFlow(k)} style={{ textAlign: "left" }}>
              {FLOWS[k].label}
            </button>
          ))}
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{dayHint}</div>
      </aside>

      {/* Chat pane */}
      <main className="card" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, minHeight: 420 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{MODES.find((m) => m.key === mode)?.label}</h3>
          <span className="muted">/ chat</span>
          {/* Conversion nudges (always available) */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="btn-soft"
              onClick={() => {
                const last = lastUserMessageContent(messages) || "";
                const q = (last || input).trim();
                setInput(`${q} — break this into staged milestones (3–6), each with 2–4 tasks for the first stage.`);
              }}
              title="Ask Eva to break your question/idea into stages"
            >
              Turn into staged plan
            </button>
            <button
              className="btn-soft"
              onClick={() => addAsBigGoal(lastUserMessageContent(messages))}
              title="Create a Big Goal kickoff task from the last question"
            >
              Add as Big Goal
            </button>
          </div>
        </div>

        <div ref={scrollRef} style={{ overflowY: "auto", maxHeight: "50vh", paddingRight: 4 }}>
          {messages.length === 0 && (
            <div className="muted">
              Try: “How would I build a website?” — Eva can answer, then stage it and add steps to your tasks.
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {messages.map((m: Msg, i: number) => (
              <div
                key={i}
                style={{
                  background: m.role === "assistant" ? "#f8fafc" : "#eef2ff",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  {m.role === "assistant" ? "Eva" : "You"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
          </div>
        </div>

        {/* One-tap chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c, i) => (
            <button
              key={i}
              onClick={c.action}
              style={{ borderRadius: 999, padding: "6px 10px", border: "1px solid var(--border)" }}
              title={c.label}
            >
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
                <label key={`${idx}-${t.slice(0,12)}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={!!selected[idx]} onChange={() => toggleSel(idx)} />
                  <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="muted">Section:</span>
              {(["general","big_goal","exercise","gratitude"] as SectionKey[]).map((k: SectionKey) => (
                <button
                  key={k}
                  onClick={() => setSection(k)}
                  aria-pressed={section === k}
                  style={{
                    borderRadius: 999,
                    padding: "6px 10px",
                    border: "1px solid var(--border)",
                    background: section === k ? "hsl(var(--pastel-hsl) / .45)" : "var(--card)",
                  }}
                  title={SECTION_LABELS[k]}
                >
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

      {/* confetti (simple) */}
      {celebrate && <ConfettiBurst />}
    </div>
  );
}

/* ========================= Confetti ========================= */
function ConfettiBurst() {
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:3000 }}>
      {pieces.map((_, i) => (
        <span
          key={i}
          style={{
            position:"absolute",
            left: `${(i / pieces.length) * 100}%`,
            top: -10,
            width:6, height:10, borderRadius:1,
            background:"hsl(var(--pastel-hsl))",
            animation: `fall ${600 + i*20}ms ease-out forwards`,
          }}
        />
      ))}
      <style>{`@keyframes fall{ to { transform: translateY(100vh) rotate(260deg); opacity:.2; } }`}</style>
    </div>
  );
}
