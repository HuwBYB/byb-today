import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import BigGoalWizard from "./BigGoalWizard";

type Goal = {
  id: number; // BIGINT
  user_id: string;
  title: string;
  category: string | null;
  category_color: string | null;
  start_date: string | null;
  target_date: string | null;
  status: string | null;
};

type Step = {
  id: number;
  user_id: string;
  goal_id: number; // BIGINT
  cadence: "daily"|"weekly"|"monthly";
  description: string;
  active: boolean;
};

export default function GoalsScreen() {
  const [userId, setUserId] = useState<string|null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selected, setSelected] = useState<Goal | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const [daily, setDaily]     = useState<string[]>([]);
  const [weekly, setWeekly]   = useState<string[]>([]);
  const [monthly, setMonthly] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  useEffect(()=> {
    supabase.auth.getUser().then(({data,error})=>{
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  },[]);

  async function loadGoals() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("goals")
      .select("id,user_id,title,category,category_color,start_date,target_date,status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) { setErr(error.message); setGoals([]); return; }
    setGoals(data as Goal[]);
  }
  useEffect(()=>{ if(userId) loadGoals(); },[userId]);

  async function openGoal(g: Goal) {
    setSelected(g);
    const { data, error } = await supabase
      .from("big_goal_steps")
      .select("*")
      .eq("goal_id", g.id)
      .eq("active", true)
      .order("id", { ascending: true });
    if (error) { setErr(error.message); setDaily([]); setWeekly([]); setMonthly([]); return; }
    const rows = (data as Step[]) || [];
    setDaily(rows.filter(r=>r.cadence==="daily").map(r=>r.description));
    setWeekly(rows.filter(r=>r.cadence==="weekly").map(r=>r.description));
    setMonthly(rows.filter(r=>r.cadence==="monthly").map(r=>r.description));
  }

  function add(setter: (xs:string[])=>void, xs:string[]) { setter([...xs, ""]); }
  function upd(setter:(xs:string[])=>void, xs:string[], i:number, v:string){ setter(xs.map((x,idx)=> idx===i? v : x)); }
  function rm(setter:(xs:string[])=>void, xs:string[], i:number){ setter(xs.filter((_,idx)=> idx!==i)); }

  async function saveSteps() {
    if (!userId || !selected) return;
    setBusy(true); setErr(null);
    try {
      const { error: de } = await supabase
        .from("big_goal_steps")
        .update({ active: false })
        .eq("goal_id", selected.id);
      if (de) throw de;

      const rows:any[] = [];
      const push = (cadence:"daily"|"weekly"|"monthly", arr:string[])=>{
        for (const s of arr.map(x=>x.trim()).filter(Boolean)) {
          rows.push({ user_id: userId, goal_id: selected.id, cadence, description: s, active: true });
        }
      };
      push("daily", daily); push("weekly", weekly); push("monthly", monthly);
      if (rows.length) {
        const { error: ie } = await supabase.from("big_goal_steps").insert(rows);
        if (ie) throw ie;
      }

      await supabase.rpc("reseed_big_goal_steps", { p_goal_id: selected.id });

      alert("Steps saved and future tasks updated.");
    } catch(e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display:"grid", gridTemplateColumns:"320px 1fr", gap:12 }}>
      <div className="card">
        <h1>Goals</h1>
        <button className="btn-primary" onClick={()=> setShowWizard(true)} style={{ marginTop:8, marginBottom:12 }}>
          + Create Big Goal
        </button>

        <div className="section-title">Your goals</div>
        <ul className="list">
          {goals.length===0 && <li className="muted">No goals yet.</li>}
          {goals.map(g=>(
            <li key={g.id} className="item">
              <button style={{ width:"100%", textAlign:"left" }} onClick={()=>openGoal(g)}>
                <div style={{ fontWeight:600 }}>{g.title}</div>
                <div className="muted">target • {g.target_date || "-"}</div>
              </button>
            </li>
          ))}
        </ul>
        {showWizard && (
          <div style={{ marginTop:12 }}>
            <BigGoalWizard onClose={()=> setShowWizard(false)} onCreated={()=> { setShowWizard(false); loadGoals(); }} />
          </div>
        )}
      </div>

      <div className="card">
        {!selected ? (
          <div className="muted">Select a goal to view and edit its steps.</div>
        ) : (
          <div style={{ display:"grid", gap:12 }}>
            <div>
              <h2 style={{ margin:0 }}>{selected.title}</h2>
              <div className="muted">
                {selected.start_date} → {selected.target_date}
                {selected.category ? ` • ${selected.category}` : ""}
              </div>
            </div>

            <div>
              <h3 style={{ marginTop:0 }}>Steps</h3>

              <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10, marginBottom:10 }}>
                <legend>Daily</legend>
                {daily.map((v,i)=>(
                  <div key={`d${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                    <input value={v} onChange={e=>upd(setDaily, daily, i, e.target.value)} placeholder="Daily step…" style={{ flex:1 }}/>
                    {daily.length>1 && <button onClick={()=>rm(setDaily, daily, i)}>–</button>}
                  </div>
                ))}
                <button onClick={()=>add(setDaily, daily)}>+ Add daily step</button>
              </fieldset>

              <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10, marginBottom:10 }}>
                <legend>Weekly</legend>
                {weekly.map((v,i)=>(
                  <div key={`w${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                    <input value={v} onChange={e=>upd(setWeekly, weekly, i, e.target.value)} placeholder="Weekly step…" style={{ flex:1 }}/>
                    {weekly.length>1 && <button onClick={()=>rm(setWeekly, weekly, i)}>–</button>}
                  </div>
                ))}
                <button onClick={()=>add(setWeekly, weekly)}>+ Add weekly step</button>
              </fieldset>

              <fieldset style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
                <legend>Monthly</legend>
                {monthly.map((v,i)=>(
                  <div key={`m${i}`} style={{ display:"flex", gap:6, marginBottom:6 }}>
                    <input value={v} onChange={e=>upd(setMonthly, monthly, i, e.target.value)} placeholder="Monthly step…" style={{ flex:1 }}/>
                    {monthly.length>1 && <button onClick={()=>rm(setMonthly, monthly, i)}>–</button>}
                  </div>
                ))}
                <button onClick={()=>add(setMonthly, monthly)}>+ Add monthly step</button>
              </fieldset>

              {err && <div style={{ color:"red", marginTop:8 }}>{err}</div>}
              <div style={{ display:"flex", gap:8, marginTop:8 }}>
                <button onClick={saveSteps} disabled={busy} className="btn-primary" style={{ borderRadius:8 }}>
                  {busy? "Saving…" : "Save steps & reseed"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
