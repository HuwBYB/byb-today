import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* -------- categories + colours (match DB constraint) --------
   Allowed in DB: 'health' | 'personal' | 'financial' | 'career' | 'other'
---------------------------------------------------------------- */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" }, // purple
  { key: "health",    label: "Health",    color: "#22c55e" }, // green
  { key: "career",    label: "Business",  color: "#3b82f6" }, // blue
  { key: "financial", label: "Finance",   color: "#f59e0b" }, // amber
  { key: "other",     label: "Other",     color: "#6b7280" }, // gray
] as const;
type AllowedCategory = typeof CATS[number]["key"];
const colorOf = (k: AllowedCategory | null | undefined) =>
  CATS.find(c => c.key === k)?.color || "#6b7280";

/* -------- date helpers -------- */
function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y,(m??1)-1,d??1);
}
function clampDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function lastDayOfMonth(y:number,m0:number){ return new Date(y,m0+1,0).getDate(); }
function addMonthsClamped(base: Date, months: number, anchorDay?: number) {
  const anchor = anchorDay ?? base.getDate();
  const y = base.getFullYear(), m = base.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDayOfMonth(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, ld));
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ======================= BIG GOAL WIZARD (kept in-file, defined FIRST) ======================= */
type WizardProps = { onClose?: () => void; onCreated?: () => void };

function BigGoalWizard({ onClose, onCreated }: WizardProps) {
  const todayISO = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AllowedCategory>("other");
  const [startDate, setStartDate] = useState(todayISO);
  const [targetDate, setTargetDate] = useState("");
  const [halfwayNote, setHalfwayNote] = useState("");
  const [monthlyCommit, setMonthlyCommit] = useState("");
  const [weeklyCommit, setWeeklyCommit] = useState("");
  const [dailyCommit, setDailyCommit] = useState("");
  const [autoReviews, setAutoReviews] = useState<"" | "weekly" | "monthly">("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const catColor = colorOf(category);

  const computedHalfDate = useMemo(() => {
    if (!targetDate) return "";
    const a = fromISO(startDate), b = fromISO(targetDate);
    if (b < a) return "";
    return toISO(new Date((a.getTime() + b.getTime()) / 2));
  }, [startDate, targetDate]);

  async function create() {
    setErr(null);
    if (!title.trim()) { setErr("Please enter a goal title."); return; }
    if (!targetDate)   { setErr("Please choose a target date."); return; }
    if (!userId) { setErr("Not signed in."); return; }

    setBusy(true);
    try {
      // 1) create goal
      const { data: goal, error: gerr } = await supabase.from("goals")
        .insert({
          user_id: userId,
          title: title.trim(),
          goal_type: "big",
          category,
          category_color: catColor,
          start_date: startDate,
          target_date: targetDate,
          halfway_note: halfwayNote || null,
          halfway_date: computedHalfDate || null,
          status: "active",
        })
        .select()
        .single();
      if (gerr) throw gerr;

      // 2) seed tasks linked to goal_id
      const start = fromISO(startDate), end = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: any[] = [];
      const cat = goal.category as AllowedCategory;
      const col = goal.category_color;

      // Milestones
      tasks.push({
        user_id:userId, title:`BIG GOAL — Target: ${goal.title}`, due_date: targetDate,
        source:"big_goal_target", status:"pending", priority:2, goal_id: goal.id,
        category:cat, category_color:col
      });
      if (computedHalfDate && halfwayNote.trim()) {
        tasks.push({
          user_id:userId, title:`BIG GOAL — Halfway: ${halfwayNote.trim()}`, due_date: computedHalfDate,
          source:"big_goal_halfway", status:"pending", priority:2, goal_id: goal.id,
          category:cat, category_color:col
        });
      }

      // Monthly commitment
      if (monthlyCommit.trim()) {
        let d = addMonthsClamped(start, 1, start.getDate());
        while (d <= end) {
          tasks.push({
            user_id:userId, title:`BIG GOAL — Monthly: ${monthlyCommit.trim()}`, due_date: toISO(d),
            source:"big_goal_monthly", status:"pending", priority:2, goal_id: goal.id,
            category:cat, category_color:col
          });
          d = addMonthsClamped(d, 1, start.getDate());
        }
      }

      // Weekly commitment
      if (weeklyCommit.trim()) {
        let d = new Date(start); d.setDate(d.getDate() + 7);
        while (d <= end) {
          tasks.push({
            user_id:userId, title:`BIG GOAL — Weekly: ${weeklyCommit.trim()}`, due_date: toISO(d),
            source:"big_goal_weekly", status:"pending", priority:2, goal_id: goal.id,
            category:cat, category_color:col
          });
          d.setDate(d.getDate() + 7);
        }
      }

      // Daily commitment
      if (dailyCommit.trim()) {
        let d = clampDay(new Date(Math.max(Date.now(), start.getTime())));
        while (d <= end) {
          tasks.push({
            user_id:userId, title:`BIG GOAL — Daily: ${dailyCommit.trim()}`, due_date: toISO(d),
            source:"big_goal_daily", status:"pending", priority:2, goal_id: goal.id,
            category:cat, category_color:col
          });
          d.setDate(d.getDate() + 1);
        }
      }

      // Auto-schedule reviews (optional)
      if (autoReviews) {
        let d = clampDay(new Date());
        const count = autoReviews === "weekly" ? 8 : 6;
        for (let i = 0; i < count; i++) {
          tasks.push({
            user_id:userId, title:`Review: ${goal.title}`, due_date: toISO(d),
            source:`goal_review_${autoReviews}`, status:"pending", priority:2, goal_id: goal.id,
            category:cat, category_color:col
          });
          d = autoReviews === "weekly" ? addDays(d, 7) : addMonthsClamped(d, 1, d.getDate());
        }
      }

      // 3) bulk insert
      for (let i = 0; i < tasks.length; i += 500) {
        const slice = tasks.slice(i, i + 500);
        const { error: terr } = await supabase.from("tasks").insert(slice);
        if (terr) throw terr;
      }

      onCreated && onCreated();
      onClose && onClose();
      alert(`Big goal created! Seeded ${tasks.length} item(s).`);
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, background: "#fff" }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Create a Big Goal (guided)</h2>

      <div style={{ display: "grid", gap: 10 }}>
        {/* title */}
        <label>
          <div className="muted">Big goal title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Get 30 new customers" />
        </label>

        {/* category */}
        <label>
          <div className="muted">Category</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={category} onChange={e=>setCategory(e.target.value as AllowedCategory)}>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span title="Category color" style={{ display:"inline-block", width:18, height:18, borderRadius:999, background:colorOf(category), border:"1px solid #ccc" }} />
          </div>
        </label>

        {/* dates */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="muted">Start date</div>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="muted">Target date</div>
            <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} />
          </label>
        </div>

        {/* halfway note */}
        <label>
          <div className="muted">How will you know you’re halfway?</div>
          <input value={halfwayNote} onChange={e=>setHalfwayNote(e.target.value)} placeholder="e.g., 15 customers or £X MRR" />
          {computedHalfDate && <div className="muted" style={{ marginTop:6 }}>Halfway milestone: <b>{computedHalfDate}</b></div>}
        </label>

        {/* commitments — Monthly → Weekly → Daily */}
        <label>
          <div className="muted">Monthly commitment (optional)</div>
          <input value={monthlyCommit} onChange={e=>setMonthlyCommit(e.target.value)} placeholder="e.g., At least 2 new customers" />
          <div className="muted" style={{ marginTop:6 }}>Starts next month on same day-of-month.</div>
        </label>

        <label>
          <div className="muted">Weekly commitment (optional)</div>
          <input value={weeklyCommit} onChange={e=>setWeeklyCommit(e.target.value)} placeholder="e.g., 5 new prospects" />
          <div className="muted" style={{ marginTop:6 }}>Starts next week on same weekday.</div>
        </label>

        <label>
          <div className="muted">Daily commitment (optional)</div>
          <input value={dailyCommit} onChange={e=>setDailyCommit(e.target.value)} placeholder="e.g., Call or email 15 people" />
          <div className="muted" style={{ marginTop:6 }}>Seeds every day from today (or future start) through target date.</div>
        </label>

        {/* review cadence */}
        <label>
          <div className="muted">Auto-schedule reviews (optional)</div>
          <select value={autoReviews} onChange={e => setAutoReviews(e.target.value as "" | "weekly" | "monthly")}>
            <option value="">None</option>
            <option value="weekly">Weekly (next 8)</option>
            <option value="monthly">Monthly (next 6)</option>
          </select>
        </label>

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div style={{ display:"flex", gap:8, marginTop:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={create} disabled={busy} className="btn-primary" style={{ borderRadius:8 }}>{busy?"Creating…":"Create Big Goal"}</button>
        </div>
      </div>
    </div>
  );
}

/* ========================= MAIN SCREEN ========================= */
type Goal = {
  id: number;
  user_id: string;
  title: string;
  goal_type: string | null;
  category: AllowedCategory;
  category_color: string | null;
  start_date: string;
  target_date: string;
  halfway_date: string | null;
  halfway_note: string | null;
  status: string | null;
};
type TaskLite = {
  id: number;
  goal_id: number | null;
  status: string | null; // 'pending' | 'done'
  source: string | null;
};

export default function GoalsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [progressByGoal, setProgressByGoal] = useState<Record<number, { total: number; done: number }>>({});

  // New Goal wizard toggle
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => { if (userId) loadAll(); }, [userId]);

  async function loadAll() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      // load active (or all non-archived) goals
      const { data: gRows, error: gErr } = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", userId)
        .neq("status", "archived")
        .order("id", { ascending: true });
      if (gErr) throw gErr;
      const gs = (gRows || []) as Goal[];
      setGoals(gs);

      // link to tasks via goal_id
      const ids = gs.map(g => g.id);
      if (ids.length) {
        const { data: tRows, error: tErr } = await supabase
          .from("tasks")
          .select("id,goal_id,status,source")
          .in("goal_id", ids);
        if (tErr) throw tErr;
        const map: Record<number, { total: number; done: number }> = {};
        (tRows || []).forEach((t: TaskLite) => {
          if (!t.goal_id) return;
          const key = t.goal_id;
          (map[key] ||= { total: 0, done: 0 }).total += 1;
          if ((t.status || "") === "done") map[key].done += 1;
        });
        setProgressByGoal(map);
      } else {
        setProgressByGoal({});
      }
    } catch (e: any) {
      setErr(e.message || String(e));
      setGoals([]); setProgressByGoal({});
    } finally {
      setLoading(false);
    }
  }

  /* ----- Balance metrics ----- */
  const balance = useMemo(() => {
    const active = goals.filter(g => (g.status || "active") !== "archived");
    const total = active.length || 1;
    const counts: Record<AllowedCategory, number> = { personal:0, health:0, career:0, financial:0, other:0 };
    active.forEach(g => { counts[g.category] = (counts[g.category] ?? 0) + 1; });
    const entries = CATS.map(c => ({ key: c.key as AllowedCategory, label: c.label, color: c.color, count: counts[c.key], pct: Math.round((counts[c.key] / total) * 100) }));
    const dominant = entries.reduce((a,b)=> b.count > a.count ? b : a, entries[0]);
    const nonZeroCats = entries.filter(e => e.count > 0).length;
    const isBalanced = dominant.pct <= 40 && nonZeroCats >= 3; // simple heuristic
    return { entries, dominant, total: active.length, isBalanced, nonZeroCats };
  }, [goals]);

  /* ----- Actions: schedule review tasks ----- */
  async function scheduleReviews(g: Goal, cadence: "weekly" | "monthly", count = cadence === "weekly" ? 8 : 6) {
    if (!userId) return;
    setErr(null);
    try {
      const start = clampDay(new Date()); // from today
      const rows: any[] = [];
      let d = new Date(start);
      for (let i = 0; i < count; i++) {
        const due = toISO(d);
        rows.push({
          user_id: userId,
          title: `Review: ${g.title}`,
          due_date: due,
          status: "pending",
          priority: 2,
          source: `goal_review_${cadence}`,
          goal_id: g.id,
          category: g.category,
          category_color: colorOf(g.category),
        });
        if (cadence === "weekly") d = addDays(d, 7);
        else d = addMonthsClamped(d, 1, d.getDate());
      }
      const { error } = await supabase.from("tasks").insert(rows as any);
      if (error) throw error;
      await loadAll();
      alert(`${cadence === "weekly" ? "Weekly" : "Monthly"} reviews scheduled for “${g.title}”.`);
    } catch (e:any) {
      setErr(e.message || String(e));
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="card" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Goals</h1>
          <div className="muted">Plan → Commit → Review</div>
        </div>
        <button className="btn-primary" onClick={() => setShowWizard(true)} style={{ borderRadius: 8 }}>
          New Goal
        </button>
      </div>

      {/* Balance card */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
          <h2 style={{ margin:0, fontSize:18 }}>Goal Balance</h2>
          <div className="muted">{balance.total} active goal{balance.total === 1 ? "" : "s"}</div>
        </div>

        {/* Segmented bar */}
        <div style={{ border:"1px solid var(--border)", borderRadius: 10, overflow:"hidden" }}>
          <div style={{ display:"flex", height: 16 }}>
            {balance.entries.map(e => (
              <div key={e.key} title={`${e.label}: ${e.count} (${e.pct}%)`} style={{ width: `${e.pct}%`, background: e.color }} />
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
          {balance.entries.map(e => (
            <span key={e.key} className="muted" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <span style={{ width:10, height:10, borderRadius:999, background:e.color, border:"1px solid #d1d5db" }} />
              {e.label} {e.count ? `· ${e.count}` : ""}
            </span>
          ))}
        </div>

        {/* Nudge */}
        {!balance.isBalanced && balance.total > 0 && (
          <div className="card card--wash" style={{ borderRadius: 8 }}>
            <strong>Heads up:</strong> most of your goals are in <b>{balance.dominant.label}</b>.
            Consider adding one in {suggestOtherCats(balance.dominant.key)} for better balance.
          </div>
        )}
      </div>

      {/* Goals list */}
      <div className="card" style={{ display:"grid", gap: 10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
          <h2 style={{ margin:0, fontSize:18 }}>Your Goals</h2>
          <button onClick={loadAll} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>

        {goals.length === 0 ? (
          <div className="muted">No goals yet. Click <b>New Goal</b> to create one.</div>
        ) : (
          <ul className="list">
            {goals.map(g => {
              const timePct = timeProgressPct(g.start_date, g.target_date);
              const tp = progressByGoal[g.id] || { total: 0, done: 0 };
              const taskPct = tp.total > 0 ? Math.round((tp.done / tp.total) * 100) : null;
              return (
                <li key={g.id} className="item" style={{ alignItems:"flex-start" }}>
                  <div style={{ display:"grid", gap:6, flex: 1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <span
                        title={g.category}
                        style={{ width:12, height:12, borderRadius:999, background: colorOf(g.category), border:"1px solid #d1d5db" }}
                      />
                      <div style={{ fontWeight:700 }}>{g.title}</div>
                      <span className="badge">{labelOf(g.category)}</span>
                      <span className="muted">→ Target: {g.target_date}</span>
                    </div>

                    {/* Time progress */}
                    <Bar label="Time" pct={timePct} tone="time" />

                    {/* Task progress (if linked tasks exist) */}
                    {taskPct != null && <Bar label={`Tasks (${tp.done}/${tp.total})`} pct={taskPct} tone="tasks" />}

                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <button className="btn-soft" onClick={() => scheduleReviews(g, "weekly")}>Schedule weekly reviews (8)</button>
                      <button className="btn-soft" onClick={() => scheduleReviews(g, "monthly")}>Schedule monthly reviews (6)</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {err && <div style={{ color:"red" }}>{err}</div>}
      </div>

      {/* Wizard modal */}
      {showWizard && (
        <div
          onClick={() => setShowWizard(false)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"grid", placeItems:"center", zIndex:2100 }}
        >
          <div className="card" style={{ width: "min(760px, 92vw)", maxHeight:"90vh", overflow:"auto" }} onClick={e => e.stopPropagation()}>
            <BigGoalWizard
              onClose={() => setShowWizard(false)}
              onCreated={() => { setShowWizard(false); loadAll(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================= SUB COMPONENTS ======================= */

function Bar({ label, pct, tone }: { label: string; pct: number; tone?: "time" | "tasks" }) {
  const bg = tone === "tasks" ? "#dcfce7" : "#e0f2fe";
  const fill = tone === "tasks" ? "#16a34a" : "#0ea5e9";
  return (
    <div>
      <div className="muted" style={{ fontSize:12, marginBottom:4 }}>{label}: {pct}%</div>
      <div style={{ height:10, borderRadius:999, background:bg, border:"1px solid var(--border)", overflow:"hidden" }}>
        <div style={{ width:`${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: fill, transition:"width .35s ease" }} />
      </div>
    </div>
  );
}

function labelOf(k: AllowedCategory) {
  return CATS.find(c => c.key === k)?.label || k;
}
function suggestOtherCats(dominant: AllowedCategory) {
  const others = CATS.filter(c => c.key !== dominant).map(c => c.label);
  if (others.length <= 2) return others.join(", ");
  return `${others[0]}, ${others[1]} or ${others[2]}`;
}
function timeProgressPct(startISO?: string, targetISO?: string) {
  const now = new Date();
  const start = startISO ? fromISO(startISO) : now;
  const end = targetISO ? fromISO(targetISO) : now;
  const total = Math.max(0, end.getTime() - start.getTime());
  if (total <= 0) return 100;
  const elapsed = Math.min(Math.max(0, now.getTime() - start.getTime()), total);
  return Math.round((elapsed / total) * 100);
}
