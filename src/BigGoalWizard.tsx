import { useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

// Category options + colors
const CATS = [
  { key: "health",    label: "Health",    color: "#22c55e" }, // green
  { key: "personal",  label: "Personal",  color: "#a855f7" }, // purple
  { key: "financial", label: "Financial", color: "#f59e0b" }, // amber
  { key: "career",    label: "Career",    color: "#3b82f6" }, // blue
  { key: "other",     label: "Other",     color: "#6b7280" }, // gray
] as const;
type CatKey = typeof CATS[number]["key"];
function colorOf(cat: CatKey) { return CATS.find(c => c.key === cat)?.color || "#6b7280"; }

// ---- date helpers (local time) ----
function toISO(d: Date) { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dd}`; }
function fromISO(s: string) { const [y,m,d]=s.split("-").map(Number); return new Date(y,(m??1)-1,d??1); }
function clampDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function daysBetweenInclusive(a: Date, b: Date) { return Math.floor((clampDay(b).getTime()-clampDay(a).getTime())/86400000)+1; }
function lastDayOfMonth(y:number,m0:number){ return new Date(y,m0+1,0).getDate(); }
function addMonthsClamped(base: Date, months: number, anchorDay?: number) {
  const anchor = anchorDay ?? base.getDate();
  const y = base.getFullYear(), m = base.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDayOfMonth(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, ld));
}

type Props = { onClose: () => void; onCreated: () => void };

export default function BigGoalWizard({ onClose, onCreated }: Props) {
  const todayISO = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CatKey>("other");
  const [startDate, setStartDate] = useState(todayISO);
  const [targetDate, setTargetDate] = useState("");
  const [halfwayNote, setHalfwayNote] = useState("");
  const [monthlyCommit, setMonthlyCommit] = useState("");
  const [weeklyCommit, setWeeklyCommit] = useState("");
  const [dailyCommit, setDailyCommit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const catColor = colorOf(category);

  // halfway = midpoint
  const computedHalfDate = useMemo(() => {
    if (!targetDate) return "";
    const a = fromISO(startDate), b = fromISO(targetDate);
    if (b < a) return "";
    return toISO(new Date((a.getTime()+b.getTime())/2));
  }, [startDate, targetDate]);

  // preview counts
  
    if (!targetDate) return { total:0,daily:0,weekly:0,monthly:0,milestones:0 };
    const start = fromISO(startDate), end = fromISO(targetDate);
    if (end < start) return { total:0,daily:0,weekly:0,monthly:0,milestones:0 };
    let milestones = 1; if (computedHalfDate && halfwayNote.trim()) milestones++;
    let monthly = 0; if (monthlyCommit.trim()) { let d = addMonthsClamped(start,1,start.getDate()); while(d<=end){ monthly++; d = addMonthsClamped(d,1,start.getDate()); } }
    let weekly = 0;  if (weeklyCommit.trim())  { let d = new Date(start); d.setDate(d.getDate()+7); while(d<=end){ weekly++; d.setDate(d.getDate()+7); } }
    let daily  = 0;  if (dailyCommit.trim())   { const from = clampDay(new Date(Math.max(Date.now(), start.getTime()))); if (from<=end) daily = daysBetweenInclusive(from,end); }
    return { total: milestones+monthly+weekly+daily, daily, weekly, monthly, milestones };
  }, [startDate,targetDate,computedHalfDate,halfwayNote,monthlyCommit,weeklyCommit,dailyCommit]);

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

      // 1) insert goal with category + color
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
          monthly_commitment: monthlyCommit || null,
          weekly_commitment: weeklyCommit || null,
          daily_commitment: dailyCommit || null,
          status: "active",
        })
        .select()
        .single();
      if (gerr) throw gerr;

      // 2) seed tasks carrying category+color, all priority 2
      const start = fromISO(startDate), end = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: any[] = [];
      const cat = goal.category;
      const col = goal.category_color;

      // milestones
      tasks.push({ user_id:userId, title:`BIG GOAL — Target: ${goal.title}`, due_date: targetDate, source:"big_goal_target", priority:2, category:cat, category_color:col });
      if (computedHalfDate && halfwayNote.trim()) {
        tasks.push({ user_id:userId, title:`BIG GOAL — Halfway: ${halfwayNote.trim()}`, due_date: computedHalfDate, source:"big_goal_halfway", priority:2, category:cat, category_color:col });
      }

      // monthly — start next month
      if (monthlyCommit.trim()) {
        let d = addMonthsClamped(start, 1, start.getDate());
        while (d <= end) {
          tasks.push({ user_id:userId, title:`BIG GOAL — Monthly: ${monthlyCommit.trim()}`, due_date: toISO(d), source:"big_goal_monthly", priority:2, category:cat, category_color:col });
          d = addMonthsClamped(d, 1, start.getDate());
        }
      }
      // weekly — start next week
      if (weeklyCommit.trim()) {
        let d = new Date(start); d.setDate(d.getDate() + 7);
        while (d <= end) {
          tasks.push({ user_id:userId, title:`BIG GOAL — Weekly: ${weeklyCommit.trim()}`, due_date: toISO(d), source:"big_goal_weekly", priority:2, category:cat, category_color:col });
          d.setDate(d.getDate() + 7);
        }
      }
      // daily — from today (or future start)
      if (dailyCommit.trim()) {
        let d = clampDay(new Date(Math.max(Date.now(), start.getTime())));
        while (d <= end) {
          tasks.push({ user_id:userId, title:`BIG GOAL — Daily: ${dailyCommit.trim()}`, due_date: toISO(d), source:"big_goal_daily", priority:2, category:cat, category_color:col });
          d.setDate(d.getDate() + 1);
        }
      }

      // 3) insert in chunks
      for (let i = 0; i < tasks.length; i += 500) {
        const { error: terr } = await supabase.from("tasks").insert(tasks.slice(i, i + 500));
        if (terr) throw terr;
      }

      onCreated(); onClose();
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
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Big goal title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Get 30 new customers" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
        </label>

        {/* category */}
        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Category</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={category} onChange={e=>setCategory(e.target.value as CatKey)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span title="Category color" style={{ display:"inline-block", width:18, height:18, borderRadius:999, background:catColor, border:"1px solid #ccc" }} />
          </div>
        </label>

        {/* dates */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Start date</div>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Target date</div>
            <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          </label>
        </div>

        {/* halfway note */}
        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>How will you know you’re halfway?</div>
          <input value={halfwayNote} onChange={e=>setHalfwayNote(e.target.value)} placeholder="e.g., 15 new customers or £X MRR" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          {computedHalfDate && <div style={{ fontSize:12, color:"#666", marginTop:6 }}>Halfway milestone will be placed on <b>{computedHalfDate}</b>.</div>}
        </label>

        {/* commitments */}
        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Monthly commitment (optional)</div>
          <input value={monthlyCommit} onChange={e=>setMonthlyCommit(e.target.value)} placeholder="e.g., At least 2 new customers" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          <div style={{ fontSize:12, color:"#666", marginTop:6 }}>Starts next month on the same day-of-month.</div>
        </label>

        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Weekly commitment (optional)</div>
          <input value={weeklyCommit} onChange={e=>setWeeklyCommit(e.target.value)} placeholder="e.g., 5 new prospects" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          <div style={{ fontSize:12, color:"#666", marginTop:6 }}>Starts next week on the same weekday.</div>
        </label>

        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Daily commitment (optional)</div>
          <input value={dailyCommit} onChange={e=>setDailyCommit(e.target.value)} placeholder="e.g., Call or email 15 people" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          <div style={{ fontSize:12, color:"#666", marginTop:6 }}>Seeds every day from today (or future start) through target date.</div>
        </label>

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
          {/* preview */}
          {/* This stays simple to avoid layout noise */}
        </div>

        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={create} disabled={busy} style={{ padding:"8px 12px", border:"1px solid #333", borderRadius:6 }}>{busy?"Creating…":"Create Big Goal"}</button>
          <button onClick={onClose} disabled={busy} style={{ padding:"8px 12px", border:"1px solid #ddd", borderRadius:6, background:"#fafafa" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
