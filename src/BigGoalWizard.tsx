import { useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

// Categories
const CATS = [
  { key: "health",    label: "Health",    color: "#22c55e" },
  { key: "personal",  label: "Personal",  color: "#a855f7" },
  { key: "financial", label: "Financial", color: "#f59e0b" },
  { key: "career",    label: "Career",    color: "#3b82f6" },
  { key: "other",     label: "Other",     color: "#6b7280" },
] as const;
type CatKey = typeof CATS[number]["key"];
const colorOf = (k: CatKey) => CATS.find(c=>c.key===k)?.color || "#6b7280";

// date helpers
const toISO = (d: Date) => {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
};
const fromISO = (s: string) => { const [y,m,d]=s.split("-").map(Number); return new Date(y,(m??1)-1,d??1); };

type Props = { onClose: () => void; onCreated: () => void };

export default function BigGoalWizard({ onClose, onCreated }: Props) {
  const todayISO = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CatKey>("other");
  const [startDate, setStartDate] = useState(todayISO);
  const [targetDate, setTargetDate] = useState("");

  // Milestones
  const [halfwayNote, setHalfwayNote] = useState("");

  // Multiple steps
  const [dailySteps, setDailySteps]     = useState<string[]>([""]);
  const [weeklySteps, setWeeklySteps]   = useState<string[]>([""]);
  const [monthlySteps, setMonthlySteps] = useState<string[]>([""]);

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string|null>(null);

  const halfISO = useMemo(() => {
    if (!targetDate) return "";
    const a = fromISO(startDate), b = fromISO(targetDate);
    if (b < a) return "";
    return toISO(new Date((a.getTime()+b.getTime())/2));
  }, [startDate,targetDate]);

  function addField(kind: "daily"|"weekly"|"monthly") {
    const add = (xs: string[]) => [...xs, ""];
    if (kind==="daily") setDailySteps(add(dailySteps));
    if (kind==="weekly") setWeeklySteps(add(weeklySteps));
    if (kind==="monthly") setMonthlySteps(add(monthlySteps));
  }
  function updateField(kind:"daily"|"weekly"|"monthly", i:number, v:string) {
    const upd = (xs:string[]) => xs.map((x,idx)=> idx===i? v : x);
    if (kind==="daily") setDailySteps(upd(dailySteps));
    if (kind==="weekly") setWeeklySteps(upd(weeklySteps));
    if (kind==="monthly") setMonthlySteps(upd(monthlySteps));
  }
  function removeField(kind:"daily"|"weekly"|"monthly", i:number) {
    const rm = (xs:string[]) => xs.filter((_,idx)=> idx!==i);
    if (kind==="daily") setDailySteps(rm(dailySteps));
    if (kind==="weekly") setWeeklySteps(rm(weeklySteps));
    if (kind==="monthly") setMonthlySteps(rm(monthlySteps));
  }

  async function create() {
    setErr(null);
    if (!title.trim()) { setErr("Please enter a goal title."); return; }
    if (!targetDate)   { setErr("Please choose a target date."); return; }

    setBusy(true);
    try {
      const { data: udat, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      const userId = udat.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const catColor = colorOf(category);

      // 1) create goal
      const { data: goal, error: gerr } = await supabase
        .from("goals")
        .insert({
          user_id: userId,
          title: title.trim(),
          goal_type: "big",
          category, category_color: catColor,
          start_date: startDate,
          target_date: targetDate,
          halfway_note: halfwayNote || null,
          halfway_date: halfISO || null,
          status: "active",
        })
        .select()
        .single();
      if (gerr) throw gerr;

      // 2) milestones as one-off tasks (kept as before)
      const milestoneTasks:any[] = [];
      milestoneTasks.push({
        user_id: userId, goal_id: goal.id,
        title: `BIG GOAL — Target: ${goal.title}`,
        due_date: targetDate, source: "big_goal_target", priority: 2,
        category: goal.category, category_color: goal.category_color
      });
      if (halfISO && halfwayNote.trim()) {
        milestoneTasks.push({
          user_id: userId, goal_id: goal.id,
          title: `BIG GOAL — Halfway: ${halfwayNote.trim()}`,
          due_date: halfISO, source: "big_goal_halfway", priority: 2,
          category: goal.category, category_color: goal.category_color
        });
      }
      if (milestoneTasks.length) {
        const { error: terr } = await supabase.from("tasks").insert(milestoneTasks);
        if (terr) throw terr;
      }

      // 3) steps (many per cadence)
      const steps: any[] = [];
      const push = (cadence:"daily"|"weekly"|"monthly", arr:string[]) => {
        for (const s of arr.map(x=>x.trim()).filter(Boolean)) {
          steps.push({ user_id: userId, goal_id: goal.id, cadence, description: s });
        }
      };
      push("daily",   dailySteps);
      push("weekly",  weeklySteps);
      push("monthly", monthlySteps);
      if (steps.length) {
        const { error: serr } = await supabase.from("big_goal_steps").insert(steps);
        if (serr) throw serr;
      }

      // 4) reseed future tasks from steps
      await supabase.rpc("reseed_big_goal_steps", { p_goal_id: goal.id });

      onCreated();
      onClose();
      alert("Big goal created and steps scheduled.");
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border:"1px solid #ddd", borderRadius:12, padding:16, background:"#fff" }}>
      <h2 style={{ fontSize:18, marginBottom:8 }}>Create a Big Goal (guided)</h2>

      <div style={{ display:"grid", gap:10 }}>
        <label>
          <div className="muted">Big goal title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Financial Freedom" />
        </label>

        <label>
          <div className="muted">Category</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <select value={category} onChange={e=>setCategory(e.target.value as CatKey)}>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span title="Color" style={{ width:18, height:18, borderRadius:999, background:colorOf(category), border:"1px solid #ccc" }} />
          </div>
        </label>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <label style={{ flex:1, minWidth:220 }}>
            <div className="muted">Start date</div>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </label>
          <label style={{ flex:1, minWidth:220 }}>
            <div className="muted">Target date</div>
            <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} />
          </label>
        </div>

        <label>
          <div className="muted">How will you know you’re halfway?</div>
          <input value={halfwayNote} onChange={e=>setHalfwayNote(e.target.value)} placeholder="e.g., halve the mortgage balance" />
          {halfISO && <div className="muted" style={{ marginTop:6 }}>Halfway milestone will be on <b>{halfISO}</b>.</div>}
        </label>

        {/* Multiple steps */}
        <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
          <legend>Daily steps</legend>
          {dailySteps.map((v,i)=>(
            <div key={`d${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
              <input value={v} onChange={e=>updateField("daily",i,e.target.value)} placeholder="e.g., Call or email 15 people" style={{ flex:1 }} />
              {dailySteps.length>1 && <button onClick={()=>removeField("daily",i)}>–</button>}
            </div>
          ))}
          <button onClick={()=>addField("daily")}>+ Add daily step</button>
        </fieldset>

        <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
          <legend>Weekly steps</legend>
          {weeklySteps.map((v,i)=>(
            <div key={`w${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
              <input value={v} onChange={e=>updateField("weekly",i,e.target.value)} placeholder="e.g., 5 new prospects" style={{ flex:1 }} />
              {weeklySteps.length>1 && <button onClick={()=>removeField("weekly",i)}>–</button>}
            </div>
          ))}
          <button onClick={()=>addField("weekly")}>+ Add weekly step</button>
        </fieldset>

        <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
          <legend>Monthly steps</legend>
          {monthlySteps.map((v,i)=>(
            <div key={`m${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
              <input value={v} onChange={e=>updateField("monthly",i,e.target.value)} placeholder="e.g., At least 4 new customers" style={{ flex:1 }} />
              {monthlySteps.length>1 && <button onClick={()=>removeField("monthly",i)}>–</button>}
            </div>
          ))}
          <button onClick={()=>addField("monthly")}>+ Add monthly step</button>
        </fieldset>

        {err && <div style={{ color:"red" }}>{err}</div>}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={create} disabled={busy}>{busy? "Creating…" : "Create Big Goal"}</button>
          <button onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
