// EvaScreen.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

type Mode = "business" | "finance" | "health" | "friend";
type Msg = { role: "user" | "assistant"; content: string };

const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: "business", label: "Business Coach",  emoji: "💼" },
  { key: "finance",  label: "Money Coach",     emoji: "💷" },
  { key: "health",   label: "Health Coach",    emoji: "💪" },
  { key: "friend",   label: "Friendly Support",emoji: "🧑‍🤝‍🧑" },
];

const TONES: Record<Mode, { opener: string; signoff: string }> = {
  business: { opener: "Direct plan, minimal fluff.",            signoff: "Onward. — Eva" },
  finance:  { opener: "Caution + clarity. Numbers first.",      signoff: "Steady as we go. — Eva" },
  health:   { opener: "Warm + practical. Sustainable > extreme.",signoff: "You've got this. — Eva" },
  friend:   { opener: "Empathy first. Then tiny wins.",         signoff: "Proud of you. — Eva" },
};

/* ---------- Utils ---------- */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

// pull bullet-ish action lines out of assistant text
function extractActions(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const bullets = lines.filter(l => /^([-*•]|\d+\.)\s+/.test(l))
    .map(l => l.replace(/^([-*•]|\d+\.)\s+/, "").trim());
  if (bullets.length) return bullets.slice(0, 12);
  return text.split(/[.;]\s+/)
    .filter(s => s.length > 0 && /\b(prepare|email|call|draft|review|log|plan|write|send|schedule|clean|walk|hydrate|stretch|update|design|setup|configure|build|launch|learn|research)\b/i.test(s))
    .slice(0, 8);
}

type SectionKey = "general" | "big_goal" | "exercise" | "gratitude";
const SECTION_LABELS: Record<SectionKey, string> = {
  general: "General",
  big_goal: "Big Goal",
  exercise: "Exercise",
  gratitude: "Gratitude",
};

// naive section guesser for extracted actions
function guessSection(s: string): SectionKey {
  const t = s.toLowerCase();
  if (/(deadlift|squat|run|km|gym|workout|warm[- ]?up|sets?)/.test(t)) return "exercise";
  if (/(gratitude|thankful|appreciate|3 things)/.test(t)) return "gratitude";
  if (/(milestone|big goal|phase|roadmap|deliverable|launch|build|website|course|app|plan)/.test(t)) return "big_goal";
  return "general";
}

/* ---------- New: project-like detection + staging ---------- */
function isProjectLike(s: string) {
  const t = s.trim().toLowerCase();
  return /^(how (do|would) i|how to|plan|build|create|learn|launch|start|make)\b/.test(t) || /\bproject|roadmap|milestone|phase|deliverable\b/.test(t);
}

type StagePlan = { title: string; notes?: string }[];

function quickStageHeuristic(from: string): StagePlan {
  // Split to 4–6 steps from extracted bullets or generic stages
  const bullets = extractActions(from);
  if (bullets.length >= 3) return bullets.slice(0, 6).map(b => ({ title: b }));
  return [
    { title: "Define scope & requirements" },
    { title: "Research tools & examples" },
    { title: "Draft structure / outline" },
    { title: "Build first version" },
    { title: "Test & refine" },
    { title: "Launch & feedback loop" },
  ];
}

/* ---------- Help modal (kept, reworded for Eva) ---------- */
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
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, zIndex:2000 }}>
      <div onClick={(e)=>e.stopPropagation()}
        style={{ maxWidth:760, width:"100%", background:"#fff", borderRadius:12, boxShadow:"0 10px 30px rgba(0,0,0,.2)", padding:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", gap:12, marginBottom:8 }}>
          <h3 style={{ margin:0, fontSize:18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close" title="Close" style={{ borderRadius:8 }}>✕</button>
        </div>
        <div style={{ maxHeight:"70vh", overflow:"auto" }}>{children}</div>
      </div>
    </div>
  );
}

function EvaHelpContent() {
  return (
    <div style={{ display:"grid", gap:12, lineHeight:1.5 }}>
      <p><em>Eva (EVA — Enhanced Virtual Assistant) helps you think, then turns ideas into plans, goals, and tasks.</em></p>
      <ul style={{ paddingLeft:18, margin:0 }}>
        <li><b>Ask anything</b> — from strategy to workouts.</li>
        <li><b>Extract steps</b> — Eva pulls action bullets you can add to Today.</li>
        <li><b>Make a plan</b> — if it’s a big ask, Eva offers to break it into stages and add as a Goal.</li>
      </ul>
    </div>
  );
}

/* ======================================================================= */

export default function EvaScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("business");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Help
  const [showHelp, setShowHelp] = useState(false);

  // Extraction & quick add
  const [extracted, setExtracted] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [section, setSection] = useState<SectionKey>("general");

  // Plan builder
  const [projectCandidate, setProjectCandidate] = useState<{question: string} | null>(null);
  const [stages, setStages] = useState<StagePlan>([]);
  const [stagingBusy, setStagingBusy] = useState(false);

  // Celebration
  const [celebrate, setCelebrate] = useState(false);

  // Hints
  const hour = new Date().getHours();
  const dayHint = hour >= 18 ? "Late? Park one thing for tomorrow and sleep well."
                 : hour <= 9 ? "Morning momentum: one Big Goal step first."
                 : "Keep it tight. Tiny steps count.";

  /* Auth */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) setErr(error.message);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* Persist per persona */
  useEffect(() => {
    const saved = localStorage.getItem(lsKey(mode));
    setMessages(saved ? JSON.parse(saved) : []);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(lsKey(mode), JSON.stringify(messages));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mode]);

  function lsKey(m: Mode) { return `eva:conv:${m}`; }

  /* ---------------- API send ---------------- */
  async function send(customPrompt?: string) {
    const q = (customPrompt ?? input).trim();
    if (!q) return;
    setErr(null);
    setBusy(true);

    // Detect project-like intent pre-send (so the banner can show after reply)
    const projLike = isProjectLike(q);

    const preface = `${TONES[mode].opener}\nUser: ${q}\nAssistant style: ${mode}`;
    const apiMsgs = [...messages, { role: "user", content: preface } as Msg];
    setMessages(prev => [...prev, { role: "user", content: input || customPrompt || "" }]);
    setInput("");

    try {
      const res = await fetch("/api/eva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: apiMsgs }),
      });
      if (!res.ok) throw new Error(`Eva error: ${res.status}`);
      const data = await res.json();
      let text: string = (data.text || "…").trim();
      if (!text.endsWith(TONES[mode].signoff)) text += `\n\n${TONES[mode].signoff}`;
      setMessages(prev => [...prev, { role: "assistant", content: text }]);

      // Extract steps
      const acts = extractActions(text);
      setExtracted(acts);
      setSelected(Object.fromEntries(acts.map((_, i) => [i, true])));

      // Auto section
      const guesses = acts.map(guessSection);
      const winner = (["exercise","gratitude","big_goal","general"] as SectionKey[])
        .sort((a,b) => guesses.filter(g=>g===b).length - guesses.filter(g=>g===a).length)[0] as SectionKey;
      setSection(winner);

      // Offer plan banner if project-y
      setProjectCandidate(projLike ? { question: q } : null);
      // Start with a quick heuristic; user can refine/regenerate
      setStages(quickStageHeuristic(text));
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* -------- Mini flows (reuse send) -------- */
  type FlowKey = "sales" | "money" | "health" | "reset";
  const FLOWS: Record<FlowKey, { label: string; prompt: string; persona: Mode }> = {
    sales:  { label: "Sales Sprint (15m)",   persona: "business", prompt: "Create a compact 3-step sales sprint for today: 1) 3 ICP leads to reach 2) one follow-up 3) one nurture touch. Each step 1 sentence, actionable, starting with a verb. End with a brief pep line." },
    money:  { label: "Money Check-in (10m)", persona: "finance",  prompt: "Give me a 3-step 10-minute finance check-in for today: one expense to review, one saving to action, one number to update. Each step imperative, one line." },
    health: { label: "Health Micro-plan (20m)", persona: "health",prompt: "Design a simple 20-minute dumbbell-only workout: warm-up (1 line), 3 sets (each 1 line), cooldown (1 line). Include reps/time. Keep it encouraging." },
    reset:  { label: "Reset Ritual (5m)",    persona: "friend",   prompt: "Create a 5-minute reset ritual: 1) 1 gratitude 2) 1 easy win (2 min) 3) 1 tidy/clear step. Keep calm and kind." },
  };
  async function runFlow(k: FlowKey) {
    const m = FLOWS[k];
    setMode(m.persona);
    await send(m.prompt);
  }

  /* -------- Tasks & Goals wiring -------- */
  async function addTasks(titles: string[], sec: SectionKey, dueToday = true) {
    if (!userId) { setErr("Not signed in."); return; }
    if (titles.length === 0) return;
    const iso = toISO(new Date());

    const rows = titles.map(title => ({
      user_id: userId,
      title,
      due_date: dueToday ? iso : null,
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

  async function createGoalWithStages(goalTitle: string, plan: StagePlan) {
    if (!userId) { setErr("Not signed in."); return; }
    const iso = toISO(new Date());
    let goalId: number | null = null;

    // Try a goals table; if it doesn't exist, fallback silently
    try {
      const { data, error } = await supabase
        .from("goals")
        .insert({ user_id: userId, title: goalTitle, created_at: new Date().toISOString(), notes: "Added via Eva" } as any)
        .select("id")
        .single();
      if (error) throw error;
      goalId = (data as any)?.id ?? null;
    } catch {
      // No goals table — that's fine; we'll just seed tasks below.
    }

    const titles = plan.map(s => s.title.trim()).filter(Boolean);
    if (titles.length === 0) return;

    const rows = titles.map((title, idx) => ({
      user_id: userId,
      title,
      due_date: iso, // seed for today; user can reschedule
      priority: 3,
      source: "eva_big_goal",
      category: "big_goal",
      category_color: null,
      status: "todo",
      ...(goalId ? { goal_id: goalId } as any : {}),
      order_index: idx,
    }));

    const { error } = await supabase.from("tasks").insert(rows);
    if (error) { setErr(error.message); return; }

    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 900);
    if ((navigator as any).vibrate) (navigator as any).vibrate(12);
  }

  /* -------- Plan helpers -------- */
  async function regenerateStages() {
    // Ask Eva to output a staged plan explicitly, using last user message
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
    if (!lastUser) return;
    setStagingBusy(true);
    try {
      const prompt = `${lastUser}\n\nTurn this into a concise staged plan with 4–8 milestones. Output only a numbered list of stage titles.`;
      const res = await fetch("/api/eva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: [...messages, { role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Eva error: ${res.status}`);
      const data = await res.json();
      const text = (data.text || "").trim();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const titles = lines
        .map(l => l.replace(/^\d+\.\s*/, "").replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 8);
      if (titles.length) setStages(titles.map(t => ({ title: t })));
      else setStages(quickStageHeuristic(text || lastUser));
    } catch (e: any) {
      setErr(e.message || String(e));
      setStages(quickStageHeuristic(lastUser));
    } finally {
      setStagingBusy(false);
    }
  }

  /* -------- UI helpers -------- */
  const quickAdds = useMemo(() => extracted, [extracted]);
  const selectedTitles = useMemo(() => quickAdds.filter((_, i) => selected[i]), [quickAdds, selected]);
  function toggleSel(i: number) { setSelected(prev => ({ ...prev, [i]: !prev[i] })); }

  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant")?.content ?? "";

  return (
    <div className="two-col" style={{ alignItems: "start" }}>
      {/* Sidebar */}
      <aside className="card sidebar-sticky" style={{ display:"grid", gap:10 }}>
        <h2 style={{ margin:0 }}>Eva <span className="muted">· EVA — Enhanced Virtual Assistant</span></h2>
        <div className="muted" style={{ fontSize:12 }}>Choose a persona</div>
        <div style={{ display:"grid", gap:6 }}>
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={mode === m.key ? "btn-primary" : ""}
              style={{ borderRadius:10, display:"flex", alignItems:"center", gap:8 }}
              aria-pressed={mode === m.key}
            >
              <span aria-hidden>{m.emoji}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="card" style={{ display:"grid", gap:6 }}>
          <div className="section-title">Mini coach</div>
          <button onClick={() => runFlow("sales")}  style={{ textAlign:"left" }}>Sales Sprint (15m)</button>
          <button onClick={() => runFlow("money")}  style={{ textAlign:"left" }}>Money Check-in (10m)</button>
          <button onClick={() => runFlow("health")} style={{ textAlign:"left" }}>Health Micro-plan (20m)</button>
          <button onClick={() => runFlow("reset")}  style={{ textAlign:"left" }}>Reset Ritual (5m)</button>
        </div>

        <div className="muted" style={{ fontSize:12, marginTop:6 }}>{dayHint}</div>

        <button className="btn-soft" onClick={() => setShowHelp(true)} style={{ marginTop:8 }}>About Eva</button>
      </aside>

      {/* Chat pane */}
      <main className="card" style={{ display:"grid", gridTemplateRows:"auto 1fr auto", gap:10, minHeight:420 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
          <h3 style={{ margin:0 }}>{MODES.find(m => m.key === mode)?.label}</h3>
          <span className="muted">/ chat</span>
        </div>

        <div ref={scrollRef} style={{ overflowY:"auto", maxHeight:"50vh", paddingRight:4 }}>
          {messages.length === 0 && (
            <div className="muted">
              Try: “How would I build a website?” — Eva will answer and offer to turn it into a staged plan you can add as a Goal.
            </div>
          )}
          <div style={{ display:"grid", gap:8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                background: m.role === "assistant" ? "#f8fafc" : "#eef2ff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10
              }}>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:4 }}>
                  {m.role === "assistant" ? "Eva" : "You"}
                </div>
                <div style={{ whiteSpace:"pre-wrap" }}>{m.content}</div>
              </div>
            ))}
          </div>
        </div>

        {/* One-tap chips */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          <button onClick={() => setInput(i => `${i.trim()} — break into 3–6 concrete steps for today.`)} style={{ borderRadius:999, padding:"6px 10px", border:"1px solid var(--border)" }}>
            Break into steps
          </button>
          <button onClick={() => setInput(i => `${i.trim()} — restrict plan to what I can do today.`)} style={{ borderRadius:999, padding:"6px 10px", border:"1px solid var(--border)" }}>
            Make it for today
          </button>
          <button onClick={() => setInput(i => `${i.trim()} — output as a checklist with 3–6 bullets.`)} style={{ borderRadius:999, padding:"6px 10px", border:"1px solid var(--border)" }}>
            Turn into checklist
          </button>
        </div>

        {/* New: Project plan banner */}
        {projectCandidate && (
          <div className="card" style={{ display:"grid", gap:8, borderTop:"1px solid var(--border)", paddingTop:8 }}>
            <div className="section-title">Turn this into a plan?</div>
            <div className="muted">Eva can break this into stages and add them to your tasks — or create a Goal with these stages.</div>

            {/* Editable stages preview */}
            <div style={{ display:"grid", gap:6 }}>
              {stages.map((s, idx) => (
                <div key={idx} style={{ display:"grid", gap:4 }}>
                  <input
                    value={s.title}
                    onChange={e => setStages(prev => prev.map((p, i) => i === idx ? ({ ...p, title: e.target.value }) : p))}
                    placeholder={`Stage ${idx+1}`}
                  />
                </div>
              ))}
            </div>

            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <button className="btn-soft" onClick={regenerateStages} disabled={stagingBusy}>
                {stagingBusy ? "Refining…" : "Regenerate stages"}
              </button>
              <div style={{ flex:1 }} />
              <button
                onClick={() => addTasks(stages.map(s => s.title), "big_goal")}
                className="btn-primary"
                style={{ borderRadius:10 }}
                disabled={stages.length === 0}
              >
                Add stages as tasks
              </button>
              <button
                onClick={() => createGoalWithStages(projectCandidate.question, stages)}
                className="btn-primary"
                style={{ borderRadius:10 }}
                disabled={stages.length === 0}
              >
                Create Goal + stages
              </button>
            </div>
          </div>
        )}

        {/* Extraction → Add to Today */}
        {quickAdds.length > 0 && (
          <div className="card" style={{ borderTop:"1px solid var(--border)", paddingTop:8, display:"grid", gap:8 }}>
            <div className="section-title" style={{ marginBottom:2 }}>Actions from Eva</div>
            <div style={{ display:"grid", gap:6 }}>
              {quickAdds.map((t, idx) => (
                <label key={idx} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <input type="checkbox" checked={!!selected[idx]} onChange={() => toggleSel(idx)} />
                  <div style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t}</div>
                </label>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <span className="muted">Section:</span>
              {(["general","big_goal","exercise","gratitude"] as SectionKey[]).map(k => (
                <button key={k} onClick={() => setSection(k)} aria-pressed={section===k}
                        style={{
                          borderRadius:999, padding:"6px 10px",
                          border:"1px solid var(--border)",
                          background: section===k ? "hsl(var(--pastel-hsl) / .45)" : "var(--card)"
                        }}>
                  {SECTION_LABELS[k]}
                </button>
              ))}
              <div style={{ flex:1 }} />
              <button onClick={() => addTasks(selectedTitles, section)} className="btn-primary" style={{ borderRadius:10 }}>
                ＋ Add {selectedTitles.length || "0"} to Today
              </button>
            </div>
          </div>
        )}

        {/* Input row */}
        <div style={{ display:"grid", gap:6 }}>
          {err && <div style={{ color:"red" }}>{err}</div>}
          <textarea
            rows={3}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) send(); } }}
            placeholder="Ask Eva… e.g., How would I build a website? (Shift+Enter for newline)"
          />
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button onClick={() => setMessages([])} disabled={busy}>Clear</button>
            <button className="btn-primary" onClick={() => send()} disabled={busy || !input.trim()} style={{ borderRadius:10 }}>
              {busy ? "Thinking…" : "Send"}
            </button>
          </div>
        </div>
      </main>

      {/* Help */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Meet Eva (EVA — Enhanced Virtual Assistant)">
        <EvaHelpContent />
      </Modal>

      {/* confetti */}
      {celebrate && <ConfettiBurst />}
    </div>
  );
}

/* ---------- Confetti ---------- */
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
