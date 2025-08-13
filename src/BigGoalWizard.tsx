import { useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ------- categories & helpers ------- */
const CATS = [
  { key: "health",    label: "Health",    color: "#22c55e" },
  { key: "personal",  label: "Personal",  color: "#a855f7" },
  { key: "financial", label: "Financial", color: "#f59e0b" },
  { key: "career",    label: "Career",    color: "#3b82f6" },
  { key: "other",     label: "Other",     color: "#6b7280" },
] as const;
type CatKey = typeof CATS[number]["key"];
const colorOf = (k: CatKey) => CATS.find(c => c.key === k)?.color || "#6b7280";

function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) { const [y,m,d]=s.split("-").map(Number); return new Date(y,(m??1)-1,d??1); }
function clampDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function lastDOM(y:number,m0:number){ return new Date(y,m0+1,0).getDate(); }
function addMonthsClamped(base: Date, months: number, anchorDay?: number) {
  const anchor = anchorDay ?? base.getDate();
  const y = base.getFullYear(), m = base.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDOM(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, ld));
}

/* ------- component ------- */
type Props = { onClose: () => void; onCreated: () => void };

export default function BigGoalWizard({ onClose, onCreated }: Props) {
  const todayISO = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CatKey>("other");
  const [startDate, setStartDate] = useState(todayISO);
  const [targetDate, setTargetDate] = useState("");
  const [halfwayNote, setHalfwayNote] = useState("");

  // Multiple step lists
  const [monthly, setMonthly] = useState<string[]>([""]);
  const [weekly, setWeekly]   = useState<string[]>([""]);
  const [daily, setDaily]     = useState<string[]>([""]);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const catColor = colorOf(category);

  const computedHalfDate = useMemo(() => {
    if (!targetDate) return "";
    const a = fromISO(startDate), b = fromISO(targetDate);
    if (b < a) return "";
    return toISO(new Date((a.getTime()+b.getTime())/2));
  }, [startDate, targetDate]);

  function ListEditor({
    label, list, setList, hint
  }: {
    label: string; list: string[]; setList: (v: string[])=>void; hint?: string;
  }) {
    return (
      <div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>{label}</div>
        <div style={{ display:"grid", gap: 6 }}>
          {list.map((v, i) => (
            <div key={i} style={{ display:"flex", gap:6 }}>
              <input
                value={v}
                onChange={e => {
                  const copy = [...list]; copy[i] = e.target.value; setList(copy);
                }}
                placeholder={i===0 ? "e.g., Call 15 prospects" : ""}
                style={{ flex:1, padding:8, border:"1px solid #ccc", borderRadius:6 }}
              />
              <button onClick={() => setList(list.filter((_,k)=>k!==i))} disabled={list.length<=1}>Remove</button>
            </div>
          ))}
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={() => setList([...list, ""])}>+ Add another</button>
            {hint && <span className="muted">{hint}</span>}
          </div>
        </div>
      </div>
    );
  }

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

      // 1) insert goal
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
      const goalId = goal.id as number;
      const goalTitle = goal.title as string;

      // 2) save steps (filter blanks)
      const steps: {goal_id:number; cadence:'daily'|'weekly'|'monthly'; description:string}[] = [];
      for (const s of monthly.map(s=>s.trim()).filter(Boolean)) steps.push({goal_id:goalId, cadence:'monthly', description:s});
      for (const s of weekly.map(s=>s.trim()).filter(Boolean))   steps.push({goal_id:goalId, cadence:'weekly', description:s});
      for (const s of daily.map(s=>s.trim()).filter(Boolean))     steps.push({goal_id:goalId, cadence:'daily', description:s});

      if (steps.length) {
        const { error: serr } = await supabase.from("goal_steps").insert(steps);
        if (serr) throw serr;
      }

      // 3) seed tasks
      const start = fromISO(startDate), end = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: any[] = [];
      const cat = goal.category;
      const col = goal.category_color;

      // milestones
      tasks.push({
        user_id:userId, goal_id:goalId, goal_title:goalTitle,
        title:`BIG GOAL — Target: ${goalTitle}`,
        due_date: targetDate, source:"big_goal_target", priority:2, category:cat, category_color:col
      });
      if (computedHalfDate && halfwayNote.trim()) {
        tasks.push({
          user_id:userId, goal_id:goalId, goal_title:goalTitle,
          title:`BIG GOAL — Halfway: ${halfwayNote.trim()}`,
          due_date: computedHalfDate, source:"big_goal_halfway", priority:2, category:cat, category_color:col
        });
      }

      // monthly steps: start next month (anchor on start day-of-month)
      for (const s of steps.filter(x=>x.cadence==='monthly')) {
        let d = addMonthsClamped(start, 1, start.getDate());
        while (d <= end) {
          tasks.push({
            user_id:userId, goal_id:goalId, goal_title:goalTitle,
            title:`BIG GOAL — Monthly: ${s.description}`,
            due_date: toISO(d), source:"big_goal_monthly", priority:2, category:cat, category_color:col
          });
          d = addMonthsClamped(d, 1, start.getDate());
        }
      }

      // weekly steps: start next week same weekday as start
      for (const s of steps.filter(x=>x.cadence==='weekly')) {
        let d = new Date(start); d.setDate(d.getDate() + 7);
        while (d <= end) {
          tasks.push({
            user_id:userId, goal_id:goalId, goal_title:goalTitle,
            title:`BIG GOAL — Weekly: ${s.description}`,
            due_date: toISO(d), source:"big_goal_weekly", priority:2, category:cat, category_color:col
          });
          d.setDate(d.getDate() + 7);
        }
      }

      // daily steps: seed every day from today (or future start)
      for (const s of steps.filter(x=>x.cadence==='daily')) {
        let d = clampDay(new Date(Math.max(Date.now(), start.getTime())));
        while (d <= end) {
          tasks.push({
            user_id:userId, goal_id:goalId, goal_title:goalTitle,
            title:`BIG GOAL — Daily: ${s.description}`,
            due_date: toISO(d), source:"big_goal_daily", priority:2, category:cat, category_color:col
          });
          d.setDate(d.getDate() + 1);
        }
      }

      for (let i=0; i<tasks.length; i+=500) {
        const { error: terr } = await supabase.from("tasks").insert(tasks.slice(i, i+500));
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
        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Big goal title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Financial Freedom" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
        </label>

        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Category</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={category} onChange={e=>setCategory(e.target.value as CatKey)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span title="Category color" style={{ display:"inline-block", width:18, height:18, borderRadius:999, background:catColor, border:"1px solid #ccc" }} />
          </div>
        </label>

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

        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>How will you know you’re halfway?</div>
          <input value={halfwayNote} onChange={e=>setHalfwayNote(e.target.value)} placeholder="e.g., mortgage at £X or 15 customers" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          {computedHalfDate && <div style={{ fontSize:12, color:"#666", marginTop:6 }}>Halfway milestone will be placed on <b>{computedHalfDate}</b>.</div>}
        </label>

        <ListEditor label="Monthly steps (optional)" list={monthly} setList={setMonthly} hint="Starts next month on the same day-of-month." />
        <ListEditor label="Weekly steps (optional)"   list={weekly}  setList={setWeekly}  hint="Starts next week on the same weekday." />
        <ListEditor label="Daily steps (optional)"     list={daily}   setList={setDaily}   hint="Every day from today (or future start) through target." />

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={create} disabled={busy} style={{ padding:"8px 12px", border:"1px solid #333", borderRadius:6 }}>{busy?"Creating…":"Create Big Goal"}</button>
          <button onClick={onClose} disabled={busy} style={{ padding:"8px 12px", border:"1px solid #ddd", borderRadius:6, background:"#fafafa" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
