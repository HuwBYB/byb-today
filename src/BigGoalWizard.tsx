import { useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

function toISO(d: Date) { const yyyy=d.getFullYear(); const mm=String(d.getMonth()+1).padStart(2,"0"); const dd=String(d.getDate()).padStart(2,"0"); return `${yyyy}-${mm}-${dd}`; }
function fromISO(s: string) { const [y,m,d]=s.split("-").map(Number); return new Date(y,(m??1)-1,d??1); }
function clampToLocalDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function daysBetweenInclusive(a: Date,b: Date){const ms=clampToLocalDay(b).getTime()-clampToLocalDay(a).getTime();return Math.floor(ms/86400000)+1;}

type Props={ onClose:()=>void; onCreated:()=>void; };

export default function BigGoalWizard({ onClose, onCreated }: Props) {
  const todayISO = useMemo(()=>toISO(new Date()),[]);
  const [title,setTitle]=useState(""); const [startDate,setStartDate]=useState(todayISO);
  const [targetDate,setTargetDate]=useState(""); const [halfwayNote,setHalfwayNote]=useState("");
  const [monthlyCommit,setMonthlyCommit]=useState(""); const [weeklyCommit,setWeeklyCommit]=useState("");
  const [dailyCommit,setDailyCommit]=useState(""); const [err,setErr]=useState<string|null>(null); const [busy,setBusy]=useState(false);

  const computedHalfDate = useMemo(()=>{ if(!targetDate) return ""; const a=fromISO(startDate), b=fromISO(targetDate); if(b<a) return ""; const mid=new Date((a.getTime()+b.getTime())/2); return toISO(mid); },[startDate,targetDate]);

  const previewCounts = useMemo(()=>{ if(!targetDate) return {total:0,daily:0,weekly:0,monthly:0,milestones:0};
    const start=fromISO(startDate), end=fromISO(targetDate); if(end<start) return {total:0,daily:0,weekly:0,monthly:0,milestones:0};
    let milestones=1; if(computedHalfDate&&halfwayNote.trim()) milestones+=1;
    let monthly=0; if(monthlyCommit.trim()){ let d=new Date(start); while(d<=end){ monthly+=1; d.setMonth(d.getMonth()+1);} }
    let weekly=0; if(weeklyCommit.trim()){ let d=new Date(start); while(d<=end){ weekly+=1; d.setDate(d.getDate()+7);} }
    let daily=0; if(dailyCommit.trim()){ const from=clampToLocalDay(new Date(Math.max(new Date().getTime(), start.getTime()))); if(from<=end) daily=daysBetweenInclusive(from,end); }
    return {total:milestones+monthly+weekly+daily, daily, weekly, monthly, milestones};
  },[startDate,targetDate,computedHalfDate,halfwayNote,monthlyCommit,weeklyCommit,dailyCommit]);

  async function create(){
    setErr(null); if(!title.trim()) {setErr("Please enter a goal title."); return;} if(!targetDate){setErr("Please choose a target date."); return;} setBusy(true);
    try{
      const {data:userData,error:uerr}=await supabase.auth.getUser(); if(uerr) throw uerr; const userId=userData.user?.id; if(!userId) throw new Error("Not signed in.");
      const {data:goal,error:gerr}=await supabase.from("goals").insert({
        user_id:userId,title:title.trim(),goal_type:"big",start_date:startDate,target_date:targetDate,
        halfway_note:halfwayNote||null,halfway_date:computedHalfDate||null,
        monthly_commitment:monthlyCommit||null,weekly_commitment:weeklyCommit||null,daily_commitment:dailyCommit||null,status:"active",
      }).select().single(); if(gerr) throw gerr;

      const start=fromISO(startDate), end=fromISO(targetDate); if(end<start) throw new Error("Target date is before start date.");
      const tasks:any[]=[];
      tasks.push({user_id:userId,title:goal.title,due_date:targetDate,source:"big_goal_target",priority:2});
      if(computedHalfDate&&halfwayNote.trim()){
        tasks.push({user_id:userId,title:`Halfway: ${halfwayNote.trim()}`,due_date:computedHalfDate,source:"big_goal_halfway",priority:2});
      }
      if(monthlyCommit.trim()){
        let d=new Date(start); while(d<=end){
          tasks.push({user_id:userId,title:`Monthly: ${monthlyCommit.trim()}`,due_date:toISO(d),source:"big_goal_monthly",priority:2});
          d.setMonth(d.getMonth()+1);
        }
      }
      if(weeklyCommit.trim()){
        let d=new Date(start); while(d<=end){
          tasks.push({user_id:userId,title:`Weekly: ${weeklyCommit.trim()}`,due_date:toISO(d),source:"big_goal_weekly",priority:2});
          d.setDate(d.getDate()+7);
        }
      }
      if(dailyCommit.trim()){
        let d=clampToLocalDay(new Date(Math.max(new Date().getTime(), start.getTime())));
        while(d<=end){
          tasks.push({user_id:userId,title:`Daily: ${dailyCommit.trim()}`,due_date:toISO(d),source:"big_goal_daily",priority:2});
          d.setDate(d.getDate()+1);
        }
      }
      const chunk=500; for(let i=0;i<tasks.length;i+=chunk){ const {error:terr}=await supabase.from("tasks").insert(tasks.slice(i,i+chunk)); if(terr) throw terr; }

      onCreated(); onClose();
      alert(`Big goal created! Seeded ${tasks.length} item(s).\nDaily ${previewCounts.daily}, Weekly ${previewCounts.weekly}, Monthly ${previewCounts.monthly}, Milestones ${previewCounts.milestones}`);
    }catch(e:any){ setErr(e.message||String(e)); } finally{ setBusy(false); }
  }

  return (
    <div style={{ border:"1px solid #ddd", borderRadius:12, padding:16, background:"#fff" }}>
      <h2 style={{ fontSize:18, marginBottom:8 }}>Create a Big Goal (guided)</h2>
      <div style={{ display:"grid", gap:10 }}>
        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Big goal title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Get 30 new customers" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/></label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <label style={{ flex:1, minWidth:220 }}><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Start date</div>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/></label>
          <label style={{ flex:1, minWidth:220 }}><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Target date</div>
            <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/></label>
        </div>
        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>How will you know you’re halfway?</div>
          <input value={halfwayNote} onChange={e=>setHalfwayNote(e.target.value)} placeholder="e.g., 15 new customers or £X MRR" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/></label>
        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Monthly commitment (optional)</div>
          <input value={monthlyCommit} onChange={e=>setMonthlyCommit(e.target.value)} placeholder="e.g., At least 2 new customers" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/></label>
        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Weekly commitment (optional)</div>
          <input value={weeklyCommit} onChange={e=>setWeeklyCommit(e.target.value)} placeholder="e.g., 5 new prospects" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/></label>
        <label><div style={{ fontSize:12, color:"#666", marginBottom:4 }}>Daily commitment (optional)</div>
          <input value={dailyCommit} onChange={e=>setDailyCommit(e.target.value)} placeholder="e.g., Call or email 15 people" style={{ width:"100%", padding:8, border:"1px solid #ccc", borderRadius:6 }}/>
          <div style={{ fontSize:12, color:"#666", marginTop:6 }}>We’ll seed every day from today (or start date if in the future) to the target date.</div></label>
        {err && <div style={{ color:"red" }}>{err}</div>}
        <div style={{ fontSize:12, color:"#666", marginTop:6 }}>
          {previewCounts.total>0 && <>Will create about <b>{previewCounts.total}</b> items — Daily {previewCounts.daily}, Weekly {previewCounts.weekly}, Monthly {previewCounts.monthly}, Milestones {previewCounts.milestones}.</>}
        </div>
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={create} disabled={busy} style={{ padding:"8px 12px", border:"1px solid #333", borderRadius:6 }}>{busy?"Creating…":"Create Big Goal"}</button>
          <button onClick={onClose} disabled={busy} style={{ padding:"8px 12px", border:"1px solid #ddd", borderRadius:6, background:"#fafafa" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
