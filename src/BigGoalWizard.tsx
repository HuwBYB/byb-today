import { useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* -------- categories + colours (match DB constraint) --------
   Allowed in DB: 'health' | 'personal' | 'financial' | 'career' | 'other'
---------------------------------------------------------------- */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" }, // purple
  { key: "health",    label: "Health",    color: "#22c55e" }, // green
  { key: "career",    label: "Business",  color: "#3b82f6" }, // blue (stored as 'career')
  { key: "financial", label: "Finance",   color: "#f59e0b" }, // amber (stored as 'financial')
  { key: "other",     label: "Other",     color: "#6b7280" }, // gray
] as const;
type AllowedCategory = typeof CATS[number]["key"]; // 'personal'|'health'|'career'|'financial'|'other'
const colorOf = (k: AllowedCategory) => CATS.find(c => c.key === k)?.color || "#6b7280";

/* -------- date helpers (local) -------- */
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

/* -------- props (optional so parent can pass or not) -------- */
export type BigGoalWizardProps = {
  onClose?: () => void;
  onCreated?: () => void;
};

export default function BigGoalWizard({ onClose, onCreated }: BigGoalWizardProps) {
  const todayISO = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AllowedCategory>("other"); // matches DB
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

      // 1) create goal (store DB-allowed category key)
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

      // 2) seed tasks (Top Priorities) — monthly, weekly, daily + milestones
      const start = fromISO(startDate), end = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: any[] = [];
      const cat = goal.category as AllowedCategory;
      const col = goal.category_color;

      // Milestones (TARGET)
      tasks.push({
        user_id:userId,
        goal_id: goal.id,
        title:`BIG GOAL — Target: ${goal.title}`,
        due_date: targetDate,
        source:"big_goal_target",
        priority:2,
        category:cat,
        category_color:col
      });

      // Explicit midpoint review (ALWAYS create; note optional)
      if (computedHalfDate) {
        tasks.push({
          user_id: userId,
          goal_id: goal.id,
          title: `BIG GOAL — Midpoint Review${halfwayNote.trim() ? `: ${halfwayNote.trim()}` : ""}`,
          due_date: computedHalfDate,
          source: "big_goal_midpoint_review",
          priority: 2,
          category: cat,
          category_color: col
        });
      }

      // Monthly — start next month, same DOM
      if (monthlyCommit.trim()) {
        let d = addMonthsClamped(start, 1, start.getDate());
        while (d <= end) {
          tasks.push({
            user_id:userId,
            goal_id: goal.id,
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
            goal_id: goal.id,
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
            goal_id: goal.id,
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

      // 3) bulk insert
      for (let i = 0; i < tasks.length; i += 500) {
        const slice = tasks.slice(i, i + 500);
        const { error: terr } = await supabase.from("tasks").insert(slice);
        if (terr) throw terr;
      }

      onCreated?.();
      onClose?.();
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

        {/* commitments — ORDER: Monthly → Weekly → Daily */}
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
