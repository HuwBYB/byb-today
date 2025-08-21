import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Categories (match DB) ---------- */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" }, // purple
  { key: "health",    label: "Health",    color: "#22c55e" }, // green
  { key: "career",    label: "Business",  color: "#3b82f6" }, // blue (stored as 'career')
  { key: "financial", label: "Finance",   color: "#f59e0b" }, // amber
  { key: "other",     label: "Other",     color: "#6b7280" }, // gray
] as const;
type AllowedCategory = typeof CATS[number]["key"];
const colorOf = (k?: AllowedCategory | null) => CATS.find(c => c.key === k)?.color || "#6b7280";

/* ---------- Date utils ---------- */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
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

/* ---------- DB row types (subset) ---------- */
type GoalRow = {
  id: number;
  user_id: string;
  title: string;
  goal_type: string | null;
  category: AllowedCategory;
  category_color: string | null;
  start_date: string;   // YYYY-MM-DD
  target_date: string;  // YYYY-MM-DD
  halfway_note: string | null;
  halfway_date: string | null;
  status: "active" | "paused" | "done" | string;
};

type TaskRow = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null;
  status: "pending" | "done" | string;
  priority: number | null;
  source: string | null;
  category: AllowedCategory | null;
  category_color: string | null;
  completed_at: string | null;
};

/* ---------- Modal ---------- */
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div
      role="dialog" aria-modal="true" aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.35)",
        display: "grid", placeItems: "center", padding: 16, zIndex: 2500
      }}
    >
      <div className="card" style={{ width: "min(840px, 94vw)", maxHeight: "86vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ marginTop: 10 }}>{children}</div>
      </div>
    </div>
  );
}

/* =========================================================================
   Big Goal Wizard (implementation)
   ========================================================================= */
type WizardProps = { onClose?: () => void; onCreated?: () => void };

function GoalWizardView({ onClose, onCreated }: WizardProps) {
  const todayISO = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AllowedCategory>("other");
  const [startDate, setStartDate] = useState(todayISO);
  const [targetDate, setTargetDate] = useState("");
  const [halfwayNote, setHalfwayNote] = useState("");
  const [monthlyCommit, setMonthlyCommit] = useState("");
  const [weeklyCommit, setWeeklyCommit] = useState("");
  const [dailyCommit, setDailyCommit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const catColor = colorOf(category);

  // halfway = exact midpoint between start and target
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
    setBusy(true);
    try {
      const { data: userData, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in.");

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

      // 2) seed tasks (Top Priorities) — monthly, weekly, daily
      const start = fromISO(startDate), end = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: Partial<TaskRow & { user_id: string }>[] = [];
      const cat = goal.category as AllowedCategory;
      const col = goal.category_color || colorOf(cat);

      // Milestones
      tasks.push({
        user_id:userId,
        title:`BIG GOAL — Target: ${goal.title}`,
        due_date: targetDate,
        source:"big_goal_target",
        priority:2,
        category:cat,
        category_color:col
      });
      if (computedHalfDate && halfwayNote.trim()) {
        tasks.push({
          user_id:userId,
          title:`BIG GOAL — Halfway: ${halfwayNote.trim()}`,
          due_date: computedHalfDate,
          source:"big_goal_halfway",
          priority:2,
          category:cat,
          category_color:col
        });
      }

      // Monthly — start next month, same DOM
      if (monthlyCommit.trim()) {
        let d = addMonthsClamped(start, 1, start.getDate());
        while (d <= end) {
          tasks.push({
            user_id:userId,
            title:`BIG GOAL — Monthly: ${monthlyCommit.trim()}`,
            due_date: toISO(d),
            source:"big_goal_monthly",
            priority:2,
            category:cat,
            category_color:col
          });
          d = addMonthsClamped(d, 1, start.getDate());
        }
      }

      // Weekly — start next week (same weekday)
      if (weeklyCommit.trim()) {
        let d = new Date(start); d.setDate(d.getDate() + 7);
        while (d <= end) {
          tasks.push({
            user_id:userId,
            title:`BIG GOAL — Weekly: ${weeklyCommit.trim()}`,
            due_date: toISO(d),
            source:"big_goal_weekly",
            priority:2,
            category:cat,
            category_color:col
          });
          d.setDate(d.getDate() + 7);
        }
      }

      // Daily — from today (or future start) through end
      if (dailyCommit.trim()) {
        let d = clampDay(new Date(Math.max(Date.now(), start.getTime())));
        while (d <= end) {
          tasks.push({
            user_id:userId,
            title:`BIG GOAL — Daily: ${dailyCommit.trim()}`,
            due_date: toISO(d),
            source:"big_goal_daily",
            priority:2,
            category:cat,
            category_color:col
          });
          d.setDate(d.getDate() + 1);
        }
      }

      // 3) bulk insert tasks
      for (let i = 0; i < tasks.length; i += 500) {
        const slice = tasks.slice(i, i + 500);
        const { error: terr } = await supabase.from("tasks").insert(slice as any);
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
      <h3 style={{ fontSize: 18, marginBottom: 8 }}>Create a Big Goal (guided)</h3>

      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <div className="muted">Big goal title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Get 30 new customers" />
        </label>

        <label>
          <div className="muted">Category</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={category} onChange={e=>setCategory(e.target.value as AllowedCategory)}>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span title="Category color" style={{ display:"inline-block", width:18, height:18, borderRadius:999, background:colorOf(category), border:"1px solid #ccc" }} />
          </div>
        </label>

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

        <label>
          <div className="muted">How will you know you’re halfway?</div>
          <input value={halfwayNote} onChange={e=>setHalfwayNote(e.target.value)} placeholder="e.g., 15 customers or £X MRR" />
          {computedHalfDate && <div className="muted" style={{ marginTop:6 }}>Halfway milestone: <b>{computedHalfDate}</b></div>}
        </label>

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

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={create} disabled={busy} className="btn-primary" style={{ borderRadius:8 }}>{busy?"Creating…":"Create Big Goal"}</button>
          <button onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* 🔗 Explicitly typed wrapper so <BigGoalWizard …/> props are recognized */
const BigGoalWizard: React.FC<WizardProps> = (props) => <GoalWizardView {...props} />;

/* =========================================================================
   Goals Screen
   ========================================================================= */
export default function GoalsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // UI
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
      const { data, error } = await supabase
        .from("goals")
        .select("id,user_id,title,goal_type,category,category_color,start_date,target_date,halfway_note,halfway_date,status")
        .eq("user_id", userId)
        .order("id", { ascending: true });
      if (error) throw error;
      setGoals((data as GoalRow[]) || []);
    } catch (e:any) {
      setErr(e.message || String(e));
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }

  // Balance / distribution across categories (active goals)
  const activeGoals = goals.filter(g => g.status !== "done");
  const catCounts = useMemo(() => {
    const map: Record<AllowedCategory, number> = { personal:0, health:0, career:0, financial:0, other:0 };
    for (const g of activeGoals) map[g.category] = (map[g.category] ?? 0) + 1;
    return map;
  }, [activeGoals]);

  const imbalanceNote = useMemo(() => {
    const total = activeGoals.length;
    if (total === 0) return "";
    const entries = Object.entries(catCounts) as Array<[AllowedCategory, number]>;
    const max = Math.max(...entries.map(([,n]) => n));
    const min = Math.min(...entries.map(([,n]) => n));
    if (max <= 2 || max - min <= 1) return ""; // reasonably balanced
    const topCats = entries.filter(([,n]) => n === max).map(([k]) => CATS.find(c=>c.key===k)!.label).join(", ");
    const lowCats = entries.filter(([,n]) => n === min).map(([k]) => CATS.find(c=>c.key===k)!.label).join(", ");
    return `Heavily focused on ${topCats}. Consider adding a goal in ${lowCats} for better balance.`;
  }, [catCounts, activeGoals.length]);

  // Time-based progress % for each goal (simple + robust)
  function timeProgress(g: GoalRow) {
    const start = fromISO(g.start_date);
    const end = fromISO(g.target_date);
    const now = new Date();
    if (end <= start) return 0;
    const pct = ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  // Optional: Seed a weekly "Review goals" task (nice cadence)
  async function seedWeeklyReview() {
    if (!userId) return;
    try {
      const title = "Weekly Goals Review";
      const today = clampDay(new Date());
      // create 12 weekly occurrences
      const rows: Omit<TaskRow,"id">[] = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(today); d.setDate(d.getDate() + 7 * (i + 1));
        return {
          user_id: userId,
          title,
          due_date: toISO(d),
          status: "pending",
          priority: 2,
          source: "goals_weekly_review",
          category: "other",
          category_color: colorOf("other"),
          completed_at: null,
        } as any;
      });
      const { error } = await supabase.from("tasks").insert(rows as any);
      if (error) throw error;
      alert("Weekly review tasks created for the next 12 weeks.");
    } catch (e:any) {
      setErr(e.message || String(e));
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="card" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap: 8, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Goals</h1>
          <div className="muted">{loading ? "Loading…" : `${goals.length} total · ${activeGoals.length} active`}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-soft" onClick={loadAll} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          <button className="btn-soft" onClick={seedWeeklyReview}>Seed Weekly Review</button>
          <button className="btn-primary" onClick={() => setShowWizard(true)} style={{ borderRadius: 8 }}>
            New Big Goal
          </button>
        </div>
      </div>

      {/* Balance panel */}
      <div className="card" style={{ display:"grid", gap: 10 }}>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap: 8, flexWrap:"wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Balance</h2>
          <div className="muted">Active goals by category</div>
        </div>

        {/* Distribution bar */}
        <div style={{ border:"1px solid var(--border)", borderRadius: 12, overflow:"hidden" }}>
          <div style={{ display:"flex", height: 16 }}>
            {CATS.map(cat => {
              const n = catCounts[cat.key] || 0;
              const pct = activeGoals.length ? (n / activeGoals.length) * 100 : 0;
              return (
                <div key={cat.key} title={`${cat.label}: ${n}`} style={{ width: `${pct}%`, background: cat.color }} />
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display:"flex", gap: 12, flexWrap:"wrap" }}>
          {CATS.map(cat => (
            <span key={cat.key} className="muted" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: cat.color, border:"1px solid #d1d5db" }} />
              {cat.label}: <b>{catCounts[cat.key] || 0}</b>
            </span>
          ))}
        </div>

        {!!imbalanceNote && (
          <div className="card card--wash" style={{ borderRadius: 10 }}>
            {imbalanceNote}
          </div>
        )}
      </div>

      {/* Active goals list */}
      <div className="card" style={{ display:"grid", gap: 10 }}>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap: 8, flexWrap:"wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Active Goals</h2>
          <div className="muted">{activeGoals.length} active</div>
        </div>

        {activeGoals.length === 0 ? (
          <div className="muted">No active goals yet. Create your first Big Goal.</div>
        ) : (
          <ul className="list">
            {activeGoals.map(g => {
              const pct = timeProgress(g);
              const start = g.start_date;
              const end = g.target_date;
              const catLabel = CATS.find(c => c.key === g.category)?.label || g.category;
              return (
                <li key={g.id} className="item">
                  <div style={{ display:"grid", gap:6, flex: 1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap: 8, flexWrap:"wrap" }}>
                      <span style={{
                        display:"inline-block", width:10, height:10, borderRadius:999,
                        background: g.category_color || colorOf(g.category), border: "1px solid #d1d5db"
                      }} />
                      <div style={{ fontWeight: 700 }}>{g.title}</div>
                      <span className="badge">{catLabel}</span>
                      <span className="muted">{start} → {end}</span>
                    </div>

                    {/* Progress bar (time-based) */}
                    <div style={{ border:"1px solid var(--border)", borderRadius:999, overflow:"hidden", background:"#f8fafc" }}>
                      <div style={{
                        height: 10,
                        width: `${pct}%`,
                        background: g.category_color || colorOf(g.category),
                        transition: "width .4s ease"
                      }} />
                    </div>
                    <div className="muted">{pct}% of time elapsed</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Completed goals */}
      {goals.some(g => g.status === "done") && (
        <div className="card" style={{ display:"grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Completed</h2>
          <ul className="list">
            {goals.filter(g => g.status === "done").map(g => (
              <li key={g.id} className="item">
                <div style={{ display:"flex", alignItems:"center", gap: 8 }}>
                  <span style={{
                    display:"inline-block", width:10, height:10, borderRadius:999,
                    background: g.category_color || colorOf(g.category), border: "1px solid #d1d5db"
                  }} />
                  <span style={{ textDecoration: "line-through" }}>{g.title}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {err && <div style={{ color: "red" }}>{err}</div>}

      {/* Wizard modal */}
      <Modal open={showWizard} onClose={() => setShowWizard(false)} title="New Big Goal">
        {/* Keep using the same JSX tag name */}
        <BigGoalWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => { setShowWizard(false); loadAll(); }}
        />
      </Modal>
    </div>
  );
}
