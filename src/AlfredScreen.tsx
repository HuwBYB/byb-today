// src/AlfredScreen.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* =============================================
   EVA (Alfred) — Actionable Chat
   ============================================= */

/* ---------- Categories (banked) ---------- */
export type AllowedCategory = "business" | "financial" | "health" | "personal" | "relationships";

const CATS: ReadonlyArray<{ key: AllowedCategory; label: string; color: string }> = [
  { key: "business",      label: "Business",      color: "#C7D2FE" }, // pastel indigo
  { key: "financial",     label: "Financial",     color: "#A7F3D0" }, // pastel mint
  { key: "health",        label: "Health",        color: "#99F6E4" }, // pastel teal
  { key: "personal",      label: "Personal",      color: "#E9D5FF" }, // pastel purple
  { key: "relationships", label: "Relationships", color: "#FECDD3" }, // pastel rose
] as const;

const colorOf = (k: AllowedCategory) => CATS.find(s => s.key === k)?.color || "#E5E7EB";

/* ---------- Types ---------- */
type ChatMessage = { role: "user" | "assistant"; content: string; ts: number };

/* ---------- Date helpers ---------- */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y,(m??1)-1,(d??1));
}
function halfwayDate(startISO: string, targetISO: string) {
  try {
    const s = fromISO(startISO); const t = fromISO(targetISO);
    const mid = new Date((s.getTime() + t.getTime()) / 2);
    return toISO(new Date(mid.getFullYear(), mid.getMonth(), mid.getDate()));
  } catch { return null; }
}

/* ---------- Local parsing helpers ---------- */
function extractBullets(txt: string): string[] {
  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bullets = lines
    .filter(l => /^([-*•]\s+|\d+\.\s+)/.test(l))
    .map(l => l.replace(/^([-*•]\s+|\d+\.\s+)/, "").trim());
  if (bullets.length) return bullets;
  // fallback: split by sentences and pick imperative-looking short items
  const sentences = txt.split(/(?<=[.!?])\s+/).map(s => s.trim());
  return sentences.filter(s => s.length > 0 && s.length <= 120);
}
function guessCadence(line: string): "daily" | "weekly" | "monthly" {
  const s = line.toLowerCase();
  if (/(daily|every day|each day|today)/.test(s)) return "daily";
  if (/(weekly|every week|per week|on mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)/.test(s)) return "weekly";
  if (/(monthly|every month|per month)/.test(s)) return "monthly";
  // heuristics: short habit-like → daily; longer project-like → weekly
  return line.split(/\s+/).length <= 6 ? "daily" : "weekly";
}

/* ---------- Minimal Modal ---------- */
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.35)", zIndex:1000, display:"grid", placeItems:"center", padding:16 }}>
      <div onClick={(e)=>e.stopPropagation()} className="card"
        style={{ width:"100%", maxWidth:720, borderRadius:12, padding:16, display:"grid", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <h3 style={{ margin:0 }}>{title}</h3>
          <button onClick={onClose} className="btn-soft" aria-label="Close">Close</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

/* =============================================
   Component
   ============================================= */
export default function AlfredScreen() {
  const [userId, setUserId] = useState<string | null>(null);

  // chat state
  const [cat, setCat] = useState<AllowedCategory>("personal");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // extracted actions from last reply
  const lastAssistant = useMemo(
    () => [...messages].reverse().find(m => m.role === "assistant")?.content ?? "",
    [messages]
  );
  const actionItems = useMemo(() => extractBullets(lastAssistant).slice(0, 8), [lastAssistant]);

  // task quick-add
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue,   setTaskDue]   = useState(todayISO());
  const [addingTask, setAddingTask] = useState(false);

  // goal creator
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTarget, setGoalTarget] = useState<string>("");
  const [monthly, setMonthly] = useState<string[]>([]);
  const [weekly, setWeekly]   = useState<string[]>([]);
  const [daily, setDaily]     = useState<string[]>([]);
  const [creatingGoal, setCreatingGoal] = useState(false);

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  /* ----- ask EVA ----- */
  async function askEva() {
    const q = input.trim();
    if (!q) return;
    setErr(null);
    setBusy(true);
    const now = Date.now();
    const userMsg: ChatMessage = { role: "user", content: q, ts: now };
    setMessages(prev => [...prev, userMsg]);
    setInput("");

    try {
      // nudge EVA to produce concise, actionable answers
      const sysHint =
        `Context: User category=${cat}. If advice implies one clear action, bullet it. ` +
        `If it's a multi-step outcome, list 3–6 steps (tag daily/weekly/monthly implicitly). ` +
        `Keep under ~10 bullets.`;

      const payload = {
        mode: "friend",
        messages: [
          { role: "system", content: sysHint },
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: q },
        ],
      };

      const res = await fetch("/api/eva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`EVA error: ${res.status}`);
      const data = await res.json();
      const text = (data.reply || data.text || "").trim();
      const aiMsg: ChatMessage = { role: "assistant", content: text || "(no reply)", ts: Date.now() };
      setMessages(prev => [...prev, aiMsg]);

      // pre-fill quick creators from the new reply
      const bullets = extractBullets(text);
      if (bullets.length === 1) {
        setTaskTitle(bullets[0]);
      } else if (bullets.length > 1) {
        setGoalTitle(q[0].toUpperCase() + q.slice(1));
        fillStepsFrom(bullets);
      }
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function fillStepsFrom(bullets: string[]) {
    const d: string[] = [], w: string[] = [], m: string[] = [];
    bullets.forEach(b => {
      const c = guessCadence(b);
      if (c === "daily") d.push(b);
      else if (c === "weekly") w.push(b);
      else m.push(b);
    });
    setDaily(d.length ? d : []);
    setWeekly(w.length ? w : []);
    setMonthly(m.length ? m : []);
  }

  /* ----- quick task ----- */
  async function addTask() {
    if (!userId || !taskTitle.trim()) return;
    setAddingTask(true);
    setErr(null);
    try {
      const row = {
        user_id: userId,
        title: taskTitle.trim(),
        due_date: taskDue || todayISO(),
        status: "pending",
        priority: 0,
        source: "eva_quick",
        category: cat,
        category_color: colorOf(cat),
      };
      const { error } = await supabase.from("tasks").insert(row as any);
      if (error) throw error;
      setAddTaskOpen(false);
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setAddingTask(false);
    }
  }

  /* ----- goal from steps ----- */
  async function createGoalFromSteps() {
    if (!userId || !goalTitle.trim()) return;
    setCreatingGoal(true);
    setErr(null);
    try {
      const startISO = todayISO();
      const targetISO = goalTarget || null;
      const halfISO = targetISO ? halfwayDate(startISO, targetISO) : null;

      // 1) create goal
      const { data: gins, error: gerr } = await supabase
        .from("goals")
        .insert({
          user_id: userId,
          title: goalTitle.trim(),
          goal_type: "big",
          start_date: startISO,
          target_date: targetISO,
          halfway_date: halfISO,
          status: "active",
          category: cat,
          category_color: colorOf(cat),
        })
        .select("id")
        .single();
      if (gerr) throw gerr;
      const goalId = (gins as any).id as number;

      // 2) steps (active)
      const stepRows: any[] = [];
      daily.forEach(d => stepRows.push({ user_id: userId, goal_id: goalId, cadence: "daily",   description: d.trim(), active: true }));
      weekly.forEach(w => stepRows.push({ user_id: userId, goal_id: goalId, cadence: "weekly",  description: w.trim(), active: true }));
      monthly.forEach(m => stepRows.push({ user_id: userId, goal_id: goalId, cadence: "monthly", description: m.trim(), active: true }));
      if (stepRows.length) {
        const { error: serr } = await supabase.from("big_goal_steps").insert(stepRows);
        if (serr) throw serr;
      }

      // 3) seed tasks via RPC (soft-fail)
      try { await supabase.rpc("reseed_big_goal_steps", { p_goal_id: goalId }); } catch {}

      setGoalOpen(false);
      alert("Goal created. Steps saved and tasks seeded.");
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setCreatingGoal(false);
    }
  }

  /* ---------- UI helpers ---------- */
  const canOfferTask = actionItems.length === 1;
  const canOfferGoal = actionItems.length > 1;

  // keep modals in sync with suggestions
  useEffect(() => {
    if (canOfferTask) {
      setTaskTitle(actionItems[0] || "");
      setTaskDue(todayISO());
    }
    if (canOfferGoal) {
      setGoalTitle(messages.find(m => m.role === "user")?.content ?? "New Goal");
      fillStepsFrom(actionItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAssistant]);

  /* ----- Styles (soft) ----- */
  const headerColor = colorOf(cat);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="card" style={{ position:"relative" }}>
        <h1 style={{ margin: 0 }}>Ask EVA</h1>
        <div className="muted">Ask for help in a life area — then action it.</div>
        <div style={{ position:"absolute", top:10, right:10, width:12, height:12, borderRadius:999, background: headerColor, border:"1px solid #d1d5db" }} />
      </div>

      {/* Category tabs */}
      <div className="card" style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {CATS.map(c => {
          const active = c.key === cat;
          return (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              aria-pressed={active}
              className="btn-soft"
              style={{
                borderRadius: 999,
                border: `1px solid ${active ? "#c7cbd6" : "var(--border)"}`,
                background: active ? `${c.color}` : "#fff",
                fontWeight: active ? 700 : 500
              }}
              title={c.label}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Composer */}
      <div className="card" style={{ display:"grid", gap:8 }}>
        <label style={{ display:"grid", gap:6 }}>
          <div className="muted">Your question to EVA ({CATS.find(x=>x.key===cat)?.label})</div>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={3}
            placeholder={`e.g., In ${CATS.find(x=>x.key===cat)?.label}, I want to... What should I do next?`}
            style={{ resize:"vertical" }}
          />
        </label>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
          {err && <div style={{ color:"red", marginRight:"auto" }}>{err}</div>}
          <button onClick={() => setInput("")} disabled={!input.trim() || busy}>Clear</button>
          <button onClick={askEva} className="btn-primary" disabled={!input.trim() || busy} style={{ borderRadius:10 }}>
            {busy ? "Thinking…" : "Ask EVA"}
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div className="card" style={{ display:"grid", gap:10 }}>
        {messages.length === 0 ? (
          <div className="muted">No messages yet. Ask EVA anything above.</div>
        ) : (
          <ul style={{ listStyle:"none", margin:0, padding:0, display:"grid", gap:8 }}>
            {messages.map((m,i)=>(
              <li key={m.ts+i} style={{ display:"grid", gap:6 }}>
                <div style={{ fontSize:12, color:"#6b7280" }}>{m.role === "user" ? "You" : "EVA"}</div>
                <div
                  style={{
                    whiteSpace:"pre-wrap",
                    background: m.role === "assistant" ? "#f8fafc" : "#fff",
                    border:"1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: 10
                  }}
                >
                  {m.content}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Action bar for last reply */}
      {lastAssistant && (canOfferTask || canOfferGoal) && (
        <div className="card" style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <div className="muted">Make it real:</div>
          {canOfferTask && (
            <button className="btn-primary" onClick={() => setAddTaskOpen(true)} style={{ borderRadius: 10 }}>
              Add as task
            </button>
          )}
          {canOfferGoal && (
            <button className="btn-primary" onClick={() => setGoalOpen(true)} style={{ borderRadius: 10 }}>
              Create goal from these
            </button>
          )}
        </div>
      )}

      {/* Quick Task Modal */}
      <Modal open={addTaskOpen} onClose={() => setAddTaskOpen(false)} title="Add as task">
        <div style={{ display:"grid", gap:10 }}>
          <label style={{ display:"grid", gap:6 }}>
            <div className="muted">Title</div>
            <input value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} />
          </label>
          <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            <label>
              <div className="muted">Due</div>
              <input type="date" value={taskDue} onChange={e=>setTaskDue(e.target.value)} />
            </label>
            <label style={{ marginLeft:"auto" }}>
              <div className="muted">Category</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <select value={cat} onChange={e=>setCat(e.target.value as AllowedCategory)}>
                  {CATS.map(c=> <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <span style={{ width:14, height:14, borderRadius:999, background: colorOf(cat), border:"1px solid #d1d5db" }} />
              </div>
            </label>
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
            <button onClick={()=>setAddTaskOpen(false)} className="btn-soft">Cancel</button>
            <button onClick={addTask} className="btn-primary" disabled={addingTask || !taskTitle.trim()}>
              {addingTask ? "Adding…" : "Add task"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Goal Creator Modal */}
      <Modal open={goalOpen} onClose={() => setGoalOpen(false)} title="Create goal from EVA’s steps">
        <div style={{ display:"grid", gap:12 }}>
          <label style={{ display:"grid", gap:6 }}>
            <div className="muted">Goal title</div>
            <input value={goalTitle} onChange={e=>setGoalTitle(e.target.value)} placeholder="e.g., Launch the new offer" />
          </label>

          <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            <label style={{ display:"grid", gap:6 }}>
              <div className="muted">Target date (optional)</div>
              <input type="date" value={goalTarget} onChange={e=>setGoalTarget(e.target.value)} />
            </label>
            <label style={{ marginLeft:"auto" }}>
              <div className="muted">Category</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <select value={cat} onChange={e=>setCat(e.target.value as AllowedCategory)}>
                  {CATS.map(c=> <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <span style={{ width:14, height:14, borderRadius:999, background: colorOf(cat), border:"1px solid #d1d5db" }} />
              </div>
            </label>
          </div>

          {/* Steps editor */}
          <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
            <legend>Monthly</legend>
            {(monthly.length ? monthly : [""]).map((v,i)=>(
              <div key={`m${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                <input value={v}
                  onChange={e=>setMonthly(monthly.length? monthly.map((x,idx)=>idx===i?e.target.value:x):[e.target.value])}
                  placeholder="e.g., Publish a case study" style={{ flex:1 }} />
                {(monthly.length>1 || (monthly.length===1 && monthly[0])) && (
                  <button onClick={()=>setMonthly(monthly.filter((_,idx)=>idx!==i))}>–</button>
                )}
              </div>
            ))}
            <button onClick={()=>setMonthly([...monthly, ""])}>+ Add monthly</button>
          </fieldset>

          <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
            <legend>Weekly</legend>
            {(weekly.length ? weekly : [""]).map((v,i)=>(
              <div key={`w${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                <input value={v}
                  onChange={e=>setWeekly(weekly.length? weekly.map((x,idx)=>idx===i?e.target.value:x):[e.target.value])}
                  placeholder="e.g., Book 3 outreach calls" style={{ flex:1 }} />
                {(weekly.length>1 || (weekly.length===1 && weekly[0])) && (
                  <button onClick={()=>setWeekly(weekly.filter((_,idx)=>idx!==i))}>–</button>
                )}
              </div>
            ))}
            <button onClick={()=>setWeekly([...weekly, ""])}>+ Add weekly</button>
          </fieldset>

          <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
            <legend>Daily</legend>
            {(daily.length ? daily : [""]).map((v,i)=>(
              <div key={`d${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                <input value={v}
                  onChange={e=>setDaily(daily.length? daily.map((x,idx)=>idx===i?e.target.value:x):[e.target.value])}
                  placeholder="e.g., 30 min focus block" style={{ flex:1 }} />
                {(daily.length>1 || (daily.length===1 && daily[0])) && (
                  <button onClick={()=>setDaily(daily.filter((_,idx)=>idx!==i))}>–</button>
                )}
              </div>
            ))}
            <button onClick={()=>setDaily([...daily, ""])}>+ Add daily</button>
          </fieldset>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
            <button className="btn-soft" onClick={()=>setGoalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={createGoalFromSteps} disabled={creatingGoal || !goalTitle.trim()}>
              {creatingGoal ? "Creating…" : "Create goal"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
