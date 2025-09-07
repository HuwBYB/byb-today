import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* =================== Categories (banked) =================== */
export type AllowedCategory = "business" | "financial" | "health" | "personal" | "relationships";

const CATS: ReadonlyArray<{ key: AllowedCategory; label: string; color: string }> = [
  { key: "business",      label: "Business",      color: "#C7D2FE" }, // pastel indigo
  { key: "financial",     label: "Financial",     color: "#A7F3D0" }, // pastel mint
  { key: "health",        label: "Health",        color: "#99F6E4" }, // pastel teal
  { key: "personal",      label: "Personal",      color: "#E9D5FF" }, // pastel purple
  { key: "relationships", label: "Relationships", color: "#FECDD3" }, // pastel rose
] as const;

const colorOf = (k: AllowedCategory) => CATS.find(s => s.key === k)?.color || "#E5E7EB";
function normalizeCat(x: string | null | undefined): AllowedCategory {
  const s = (x || "").toLowerCase().trim();
  if (s === "career") return "business";
  if (s === "finance") return "financial";
  if (s === "relationship") return "relationships";
  if (!s || s === "other") return "personal";
  if ((["business","financial","health","personal","relationships"] as const).includes(s as any)) return s as AllowedCategory;
  return "personal";
}

/* =================== Types =================== */
type PlanMeta = {
  kind: "task" | "goal";
  title: string;
  target_date?: string | null; // YYYY-MM-DD
  steps?: {
    daily?: string[];
    weekly?: string[];
    monthly?: string[];
  };
};

type TaskRow = {
  id?: number;
  user_id: string;
  title: string;
  due_date: string | null;
  status: "pending" | "done";
  priority?: number | null;
  source?: string | null;
  goal_id?: number | null;
  category?: string | null;
  category_color?: string | null;
};

type Goal = {
  id: number;
  user_id: string;
  title: string;
  category: string | null;
  category_color: string | null;
  start_date: string | null;
  target_date: string | null;
  status: string | null;
  halfway_date?: string | null;
  halfway_note?: string | null;
};

type Step = {
  id?: number;
  user_id: string;
  goal_id: number;
  cadence: "daily" | "weekly" | "monthly";
  description: string;
  active: boolean;
};

/* =================== Date helpers =================== */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) { const [y,m,d] = s.split("-").map(Number); return new Date(y,(m??1)-1,(d??1)); }
function clampDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function todayISO() { return toISO(clampDay(new Date())); }
function lastDayOfMonth(y:number,m0:number){ return new Date(y,m0+1,0).getDate(); }
function addMonthsClamped(base: Date, months: number, anchorDay?: number) {
  const anchor = anchorDay ?? base.getDate();
  const y = base.getFullYear(), m = base.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDayOfMonth(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, ld));
}

/* =================== Client reseed (fallback if RPC missing) =================== */
async function clientReseedTasksForGoal(
  supabaseClient: typeof supabase,
  userId: string,
  goalId: number,
  startISO: string,
  targetISO: string,
  steps: Step[],
  cat: AllowedCategory,
  color: string,
  seedFromISO?: string
) {
  const start = fromISO(startISO);
  const end = fromISO(targetISO);
  if (end < start) throw new Error("Target date is before start date.");
  const fromISOVal = seedFromISO || todayISO();
  const fromDate = fromISO(fromISOVal);

  // wipe ONLY future big_goal_* tasks from fromISO forward (leave milestone + review)
  await supabaseClient
    .from("tasks")
    .delete()
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .in("source", ["big_goal_monthly", "big_goal_weekly", "big_goal_daily"])
    .gte("due_date", fromISOVal);

  const queue: any[] = [];

  // monthly — DOM cadence based on start date
  const monthSteps = steps.filter(s => s.cadence === "monthly");
  if (monthSteps.length) {
    let cursor = addMonthsClamped(start, 0, start.getDate());
    while (cursor < fromDate) cursor = addMonthsClamped(cursor, 1, start.getDate());
    while (cursor <= end) {
      const due = toISO(cursor);
      for (const s of monthSteps) {
        queue.push({
          user_id: userId, goal_id: goalId,
          title: `BIG GOAL — Monthly: ${s.description}`,
          due_date: due, source: "big_goal_monthly", priority: 2,
          category: cat, category_color: color,
        });
      }
      cursor = addMonthsClamped(cursor, 1, start.getDate());
    }
  }

  // weekly — cadence every 7 days from (start + 7)
  const weekSteps = steps.filter(s => s.cadence === "weekly");
  if (weekSteps.length) {
    let cursor = new Date(start);
    cursor.setDate(cursor.getDate() + 7);
    while (cursor < fromDate) cursor.setDate(cursor.getDate() + 7);
    while (cursor <= end) {
      const due = toISO(cursor);
      for (const s of weekSteps) {
        queue.push({
          user_id: userId, goal_id: goalId,
          title: `BIG GOAL — Weekly: ${s.description}`,
          due_date: due, source: "big_goal_weekly", priority: 2,
          category: cat, category_color: color,
        });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  // daily — from max(fromDate, start)
  const daySteps = steps.filter(s => s.cadence === "daily");
  if (daySteps.length) {
    let cursor = new Date(Math.max(fromDate.getTime(), start.getTime()));
    cursor = clampDay(cursor);
    while (cursor <= end) {
      const due = toISO(cursor);
      for (const s of daySteps) {
        queue.push({
          user_id: userId, goal_id: goalId,
          title: `BIG GOAL — Daily: ${s.description}`,
          due_date: due, source: "big_goal_daily", priority: 2,
          category: cat, category_color: color,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (let i = 0; i < queue.length; i += 500) {
    const slice = queue.slice(i, i + 500);
    const { error: terr } = await supabaseClient.from("tasks").insert(slice);
    if (terr) throw terr;
  }
  return queue.length;
}

/* =================== EVA page =================== */
export default function EvaScreen() {
  /* --- UI state --- */
  const [userId, setUserId] = useState<string | null>(null);
  const [active, setActive] = useState<AllowedCategory>("personal");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [reply, setReply] = useState<string>("");
  const [meta, setMeta] = useState<PlanMeta | null>(null);

  // Action controls
  const [dueISO, setDueISO] = useState<string>(todayISO());               // for single task
  const [targetISO, setTargetISO] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 84); return toISO(d);   // default 12 weeks
  });
  const [goalTitle, setGoalTitle] = useState<string>("");

  // Steps editor (pre-filled from meta if any)
  const [daily, setDaily] = useState<string[]>([]);
  const [weekly, setWeekly] = useState<string[]>([]);
  const [monthly, setMonthly] = useState<string[]>([]);

  /* --- auth --- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  /* --- small styles --- */
  const styleTag = (
    <style>{`
      .eva-tabs { display:flex; gap:8px; flex-wrap:wrap }
      .eva-chip { padding:8px 12px; border-radius:10px; border:1px solid #e5e7eb; background:#fff }
      .eva-chip[aria-pressed="true"]{ border-color: #a5b4fc; background: #eef2ff }
      .eva-cta { display:flex; gap:8px; flex-wrap:wrap; align-items:center }
      .col { display:grid; gap:8px }
      .steps { display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) }
      fieldset { border:1px solid #eee; border-radius:10px; padding:10px }
      legend { padding:0 6px; color:#64748b }
    `}</style>
  );

  /* --- helpers --- */
  const color = useMemo(() => colorOf(active), [active]);
  const startISO = todayISO();
  const halfwayISO = useMemo(() => {
    try {
      const s = fromISO(startISO), t = fromISO(targetISO);
      const ms = s.getTime() + Math.floor((t.getTime() - s.getTime()) / 2);
      return toISO(new Date(ms));
    } catch { return null; }
  }, [startISO, targetISO]);

  function parseMetaFromReply(text: string): PlanMeta | null {
    // Look for ```json ... ``` block
    const m = text.match(/```json([\s\S]*?)```/i);
    if (m) {
      try {
        const obj = JSON.parse(m[1].trim());
        // Normalize/validate
        const kind = obj.kind === "task" ? "task" : "goal";
        const title = String(obj.title || "").trim() || "";
        const target_date = obj.target_date ? String(obj.target_date).slice(0,10) : null;
        const steps = obj.steps ? {
          daily: Array.isArray(obj.steps.daily) ? obj.steps.daily.map(String) : [],
          weekly: Array.isArray(obj.steps.weekly) ? obj.steps.weekly.map(String) : [],
          monthly: Array.isArray(obj.steps.monthly) ? obj.steps.monthly.map(String) : [],
        } : undefined;
        return { kind, title, target_date, steps };
      } catch { /* fallthrough */ }
    }

    // Heuristic fallback: 2+ bullets ⇒ goal, else task
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const bullets = lines.filter(l => /^(\*|-|•|\d+\.)\s+/.test(l)).map(l => l.replace(/^(\*|-|•|\d+\.)\s+/, "").trim());
    if (bullets.length >= 2) {
      return { kind: "goal", title: (prompt || "").trim(), steps: { weekly: bullets.slice(0, 5) } };
    }
    const single = bullets[0] || lines.find(l => l && !/^(\*|-|•|\d+\.)\s+/.test(l)) || (prompt || "").trim();
    return { kind: "task", title: single };
  }

  function applyMetaToEditors(pm: PlanMeta | null) {
    if (!pm) return;
    setGoalTitle(pm.title || "");
    setDaily(pm.steps?.daily || []);
    setWeekly(pm.steps?.weekly || []);
    setMonthly(pm.steps?.monthly || []);
    if (pm.target_date) setTargetISO(pm.target_date);
  }

  /* --- ask EVA --- */
  async function askEva() {
    if (!prompt.trim()) return;
    setBusy(true); setErr(null); setReply(""); setMeta(null);

    // Ask EVA for both conversational help AND a tiny machine-readable block.
    // The block is fenced ```json and looks like:
    // { "kind":"task"|"goal","title":"...", "target_date":"YYYY-MM-DD", "steps": { "daily":[],"weekly":[],"monthly":[] } }
    const instruction = `
You are EVA inside a goal & task app. 
1) Answer naturally to help the user.
2) Then append a JSON "meta" block in a fenced code block like:

\`\`\`json
{ "kind":"goal","title":"Title", "target_date":"YYYY-MM-DD",
  "steps": { "daily":["..."], "weekly":["..."], "monthly":["..."] } }
\`\`\`

Rules:
- If the user asks for one actionable thing, use kind "task" and provide a concise "title".
- If the request is a process or multi-step plan, use kind "goal" and provide steps split by cadences when possible. If unsure, put items under "weekly".
- Keep "title" under 12 words. Dates in YYYY-MM-DD format.`;

    const catHint = `Life area: ${CATS.find(c => c.key === active)?.label}`;
    const fullPrompt = `${instruction}\n\n${catHint}\n\nUser: ${prompt.trim()}`;

    try {
      const res = await fetch("/api/eva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "friend", messages: [{ role: "user", content: fullPrompt }] }),
      });
      if (!res.ok) throw new Error(`EVA error: ${res.status}`);
      const data = await res.json();
      const text = (data.reply || data.text || "").trim();
      setReply(text);
      const pm = parseMetaFromReply(text);
      setMeta(pm);
      applyMetaToEditors(pm);
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* --- DB actions --- */
  async function addAsTask() {
    if (!userId || !meta) return;
    const title = (meta.title || prompt).trim();
    if (!title) return;
    try {
      const row: TaskRow = {
        user_id: userId,
        title,
        due_date: dueISO || todayISO(),
        status: "pending",
        priority: 0,
        source: "eva_task",
        category: active,
        category_color: colorOf(active),
      };
      const { error } = await supabase.from("tasks").insert([row] as any);
      if (error) throw error;
      alert("Task added ✔︎");
    } catch (e:any) { setErr(e.message || String(e)); }
  }

  async function createGoalAndSeed() {
    if (!userId || !meta) return;
    const title = (goalTitle || meta.title || prompt).trim();
    if (!title) return;

    const start = startISO;
    const target = targetISO || startISO;
    const half = halfwayISO;

    const cat = active;
    const col = colorOf(cat);

    try {
      // 1) Create goal
      const { data: gins, error: gerr } = await supabase
        .from("goals")
        .insert({
          user_id: userId,
          title,
          goal_type: "big",
          start_date: start,
          target_date: target,
          halfway_date: half,
          category: cat,
          category_color: col,
          status: "active",
        })
        .select("id")
        .limit(1);
      if (gerr) throw gerr;
      const goalId = (gins as any)?.[0]?.id as number;

      // 2) Insert steps (if any)
      const stepsPayload: Step[] = [];
      for (const s of (monthly || [])) if (s.trim()) stepsPayload.push({ user_id:userId, goal_id:goalId, cadence:"monthly", description:s.trim(), active:true });
      for (const s of (weekly  || [])) if (s.trim()) stepsPayload.push({ user_id:userId, goal_id:goalId, cadence:"weekly",  description:s.trim(), active:true });
      for (const s of (daily   || [])) if (s.trim()) stepsPayload.push({ user_id:userId, goal_id:goalId, cadence:"daily",   description:s.trim(), active:true });

      if (stepsPayload.length) {
        const { error: se } = await supabase.from("big_goal_steps").insert(stepsPayload as any);
        if (se) throw se;
      }

      // 3) Seed tasks via RPC, fallback to client
      const { error: rerr } = await supabase.rpc("reseed_big_goal_steps", { p_goal_id: goalId });
      if (rerr) {
        await clientReseedTasksForGoal(
          supabase, userId, goalId, start, target, stepsPayload, cat, col, todayISO()
        );
      }

      alert("Goal created and tasks seeded ✔︎");
    } catch (e:any) {
      setErr(e.message || String(e));
    }
  }

  /* --- UI --- */
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {styleTag}

      {/* Header */}
      <div className="card" style={{ display:"grid", gap:8 }}>
        <h1 style={{ margin: 0 }}>Ask EVA</h1>
        <div className="muted">Get help by area, then turn insights into tasks or auto-seeded goals.</div>
      </div>

      {/* Category tabs */}
      <div className="card">
        <div className="eva-tabs">
          {CATS.map(c => {
            const on = c.key === active;
            return (
              <button
                key={c.key}
                onClick={() => setActive(c.key)}
                aria-pressed={on}
                className="eva-chip"
                style={{
                  borderColor: on ? "#a5b4fc" : "#e5e7eb",
                  background: on ? "#eef2ff" : "#fff",
                  display: "inline-flex",
                  gap: 8,
                  alignItems: "center"
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color, border: "1px solid #d1d5db" }} />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Prompt box */}
      <div className="card" style={{ display:"grid", gap:8 }}>
        <label className="col">
          <span className="muted">Your question or idea</span>
          <textarea
            rows={4}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`e.g., Plan a ${CATS.find(c=>c.key===active)?.label.toLowerCase()} reset for the next 3 months`}
          />
        </label>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
          {err && <div style={{ color:"red", marginRight:"auto" }}>{err}</div>}
          <button onClick={() => { setPrompt(""); setReply(""); setMeta(null); setDaily([]); setWeekly([]); setMonthly([]); }} disabled={busy}>Clear</button>
          <button className="btn-primary" onClick={askEva} disabled={!prompt.trim() || busy} style={{ borderRadius:10 }}>
            {busy ? "Thinking…" : "Ask EVA"}
          </button>
        </div>
      </div>

      {/* Answer + actions */}
      {!!reply && (
        <div className="card" style={{ display:"grid", gap:10 }}>
          <div className="section-title">EVA says</div>
          <div style={{ whiteSpace:"pre-wrap", lineHeight:1.5 }}>{reply}</div>

          {/* Action bar */}
          {meta && (
            <div style={{ borderTop:"1px solid #eee", paddingTop:10, display:"grid", gap:10 }}>
              <div className="section-title">Make it real</div>

              {meta.kind === "task" ? (
                <div className="eva-cta">
                  <input
                    type="date"
                    value={dueISO}
                    onChange={(e) => setDueISO(e.target.value)}
                    title="Due date"
                  />
                  <button className="btn-primary" onClick={addAsTask} style={{ borderRadius:10 }}>
                    Add as task
                  </button>
                </div>
              ) : (
                <>
                  {/* Goal details */}
                  <div className="col">
                    <label className="col">
                      <span className="muted">Goal title</span>
                      <input
                        value={goalTitle}
                        onChange={e => setGoalTitle(e.target.value)}
                        placeholder={meta.title || "Goal title"}
                      />
                    </label>

                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                      <label>
                        <div className="muted">Target date</div>
                        <input type="date" value={targetISO} onChange={e => setTargetISO(e.target.value)} />
                      </label>
                      {halfwayISO && (
                        <div className="muted">Halfway will be <b>{halfwayISO}</b></div>
                      )}
                      <span className="muted" style={{ marginLeft:"auto" }}>
                        Area: <b>{CATS.find(c=>c.key===active)?.label}</b>{" "}
                        <span style={{ display:"inline-block", width:12, height:12, borderRadius:999, background: color, border:"1px solid #d1d5db" }} />
                      </span>
                    </div>
                  </div>

                  {/* Steps editor */}
                  <div className="steps">
                    <fieldset>
                      <legend>Monthly</legend>
                      {monthly.map((v,i)=>(
                        <div key={`m${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                          <input value={v} onChange={e=>setMonthly(monthly.map((x,idx)=>idx===i?e.target.value:x))} placeholder="Monthly step…" style={{ flex:1 }} />
                          <button onClick={()=>setMonthly(monthly.filter((_,idx)=>idx!==i))}>–</button>
                        </div>
                      ))}
                      <button onClick={()=>setMonthly([...monthly, ""])}>+ Add monthly</button>
                    </fieldset>
                    <fieldset>
                      <legend>Weekly</legend>
                      {weekly.map((v,i)=>(
                        <div key={`w${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                          <input value={v} onChange={e=>setWeekly(weekly.map((x,idx)=>idx===i?e.target.value:x))} placeholder="Weekly step…" style={{ flex:1 }} />
                          <button onClick={()=>setWeekly(weekly.filter((_,idx)=>idx!==i))}>–</button>
                        </div>
                      ))}
                      <button onClick={()=>setWeekly([...weekly, ""])}>+ Add weekly</button>
                    </fieldset>
                    <fieldset>
                      <legend>Daily</legend>
                      {daily.map((v,i)=>(
                        <div key={`d${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                          <input value={v} onChange={e=>setDaily(daily.map((x,idx)=>idx===i?e.target.value:x))} placeholder="Daily step…" style={{ flex:1 }} />
                          <button onClick={()=>setDaily(daily.filter((_,idx)=>idx!==i))}>–</button>
                        </div>
                      ))}
                      <button onClick={()=>setDaily([...daily, ""])}>+ Add daily</button>
                    </fieldset>
                  </div>

                  <div className="eva-cta" style={{ justifyContent:"flex-end" }}>
                    <button className="btn-primary" onClick={createGoalAndSeed} style={{ borderRadius:10 }}>
                      Create goal & seed tasks
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
