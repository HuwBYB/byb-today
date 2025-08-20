import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null;
  status: "pending" | "done" | string;
  priority: number | null;
  source: string | null;
  goal_id: number | null;       // BIGINT
  completed_at: string | null;
};

type GoalLite = { id: number; title: string };
type Props = { externalDateISO?: string };

/* ===== date helpers ===== */
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/* ===== repeat config ===== */
type Repeat = "" | "daily" | "weekdays" | "weekly" | "monthly" | "annually";
const REPEAT_COUNTS: Record<Exclude<Repeat, "">, number> = {
  daily: 14,     // 2 weeks
  weekdays: 20,  // ~4 work weeks
  weekly: 12,    // 12 weeks
  monthly: 12,   // 12 months
  annually: 5,   // 5 years
};

function generateOccurrences(startISO: string, repeat: Repeat): string[] {
  if (!repeat) return [startISO];

  if (repeat === "weekdays") {
    // include start date if it is Mon–Fri, then add weekdays until we hit the target count
    const count = REPEAT_COUNTS.weekdays;
    const out: string[] = [];
    const d = fromISO(startISO);
    while (out.length < count) {
      const dow = d.getDay(); // Sun=0 .. Sat=6
      if (dow >= 1 && dow <= 5) out.push(toISO(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  const count = REPEAT_COUNTS[repeat];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = fromISO(startISO);
    if (repeat === "daily") d.setDate(d.getDate() + i);
    else if (repeat === "weekly") d.setDate(d.getDate() + 7 * i);
    else if (repeat === "monthly") d.setMonth(d.getMonth() + i);
    else if (repeat === "annually") d.setFullYear(d.getFullYear() + i);
    out.push(toISO(d));
  }
  return out;
}

export default function TodayScreen({ externalDateISO }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(externalDateISO || todayISO());

  const [tasks, setTasks] = useState<Task[]>([]);
  const [goalMap, setGoalMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newTop, setNewTop] = useState(false);
  const [newRepeat, setNewRepeat] = useState<Repeat>(""); // NEW
  const [adding, setAdding] = useState(false);

  useEffect(() => { if (externalDateISO) setDateISO(externalDateISO); }, [externalDateISO]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /** Helpers */
  function isOverdue(t: Task) {
    return !!t.due_date && t.due_date < dateISO && t.status !== "done";
  }

  async function load() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      // Pull everything due on/before the selected date
      const { data, error } = await supabase
        .from("tasks")
        .select("id,user_id,title,due_date,status,priority,source,goal_id,completed_at")
        .eq("user_id", userId)
        .lte("due_date", dateISO)
        .order("priority", { ascending: false })
        .order("id", { ascending: true });

      if (error) throw error;

      // Show current day + overdue (pending)
      const raw = (data as Task[]) || [];
      const list = raw.filter(t =>
        t.due_date === dateISO || (t.due_date! < dateISO && t.status !== "done")
      );

      setTasks(list);

      const ids = Array.from(new Set(list.map(t => t.goal_id).filter((v): v is number => typeof v === "number")));
      if (ids.length) {
        const { data: gs, error: ge } = await supabase
          .from("goals")
          .select("id,title")
          .in("id", ids);
        if (ge) throw ge;
        const map: Record<number,string> = {};
        (gs as GoalLite[]).forEach(g => map[g.id] = g.title);
        setGoalMap(map);
      } else {
        setGoalMap({});
      }
    } catch (e:any) {
      setErr(e.message || String(e));
      setTasks([]); setGoalMap({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (userId && dateISO) load(); }, [userId, dateISO]);

  function displayTitle(t: Task) {
    const base = (t.title || "").trim();
    const g = (t.goal_id != null) ? goalMap[t.goal_id] : "";
    return g ? `${base} (${g})` : base;
  }

  async function toggleDone(t: Task) {
    try {
      const markDone = t.status !== "done";
      const { error } = await supabase
        .from("tasks")
        .update({ status: markDone ? "done" : "pending", completed_at: markDone ? new Date().toISOString() : null })
        .eq("id", t.id);
      if (error) throw error;
      await load();
    } catch (e:any) { setErr(e.message || String(e)); }
  }

  async function moveToSelectedDate(taskId: number) {
    try {
      const { error } = await supabase.from("tasks").update({ due_date: dateISO }).eq("id", taskId);
      if (error) throw error;
      await load();
    } catch (e:any) { setErr(e.message || String(e)); }
  }

  async function moveAllOverdueHere() {
    try {
      const overdueIds = tasks.filter(isOverdue).map(t => t.id);
      if (overdueIds.length === 0) return;
      const { error } = await supabase.from("tasks").update({ due_date: dateISO }).in("id", overdueIds);
      if (error) throw error;
      await load();
    } catch (e:any) { setErr(e.message || String(e)); }
  }

  async function addTask() {
    const title = newTitle.trim();
    if (!userId || !title) return;
    setAdding(true); setErr(null);
    try {
      const occurrences = generateOccurrences(dateISO, newRepeat);
      const rows = occurrences.map(iso => ({
        user_id: userId,
        title,
        due_date: iso,
        status: "pending",
        priority: newTop ? 2 : 0,
        source: newRepeat ? `today_repeat_${newRepeat}` : "manual",
      }));
      const { error } = await supabase.from("tasks").insert(rows as any);
      if (error) throw error;
      setNewTitle(""); setNewTop(false); setNewRepeat("");
      await load();
    } catch (e:any) { setErr(e.message || String(e)); } finally { setAdding(false); }
  }

  const top  = tasks.filter(t => (t.priority ?? 0) >= 2);
  const rest = tasks.filter(t => (t.priority ?? 0) < 2);
  const overdueCount = tasks.filter(isOverdue).length;

  function Section({ title, children, right }: { title:string; children:any; right?:React.ReactNode }) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8, gap:8, flexWrap:"wrap" }}>
          <h2 style={{ margin:0, fontSize:18 }}>{title}</h2>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginLeft:"auto" }}>
            {right}
            <button onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
        {children}
      </div>
    );
  }

  function todayString() { return todayISO(); }

  return (
    <div style={{ display:"grid", gap:12 }}>
      <div className="card" style={{ display:"flex", alignItems:"center", gap:10, justifyContent:"space-between", flexWrap:"wrap" }}>
        <div>
          <h1 style={{ margin:0 }}>Today</h1>
          <div className="muted">{dateISO}</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          {overdueCount > 0 && (
            <button onClick={moveAllOverdueHere} className="btn-soft" title="Change due date for all overdue pending tasks to this day">
              Move all overdue here ({overdueCount})
            </button>
          )}
          <input type="date" value={dateISO} onChange={e=>setDateISO(e.target.value)} />
          <button onClick={()=>setDateISO(todayString())}>Today</button>
        </div>
      </div>

      <Section title="Top Priorities">
        {top.length === 0 ? (
          <div className="muted">Nothing marked top priority for this day.</div>
        ) : (
          <ul className="list">
            {top.map(t => {
              const overdue = isOverdue(t);
              return (
                <li key={t.id} className="item">
                  <label style={{ display:"flex", gap:10, alignItems:"flex-start", flex:1 }}>
                    <input type="checkbox" checked={t.status==="done"} onChange={()=>toggleDone(t)} />
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span>{displayTitle(t)}</span>
                        {overdue && <span className="badge">Overdue</span>}
                      </div>
                      {overdue && (
                        <div className="muted" style={{ marginTop:4 }}>
                          Due {t.due_date} · <button className="btn-ghost" onClick={()=>moveToSelectedDate(t.id)}>Move to {dateISO}</button>
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Everything Else"
        right={overdueCount > 0 ? <span className="muted">{overdueCount} overdue</span> : null}
      >
        {rest.length === 0 ? (
          <div className="muted">Nothing else scheduled.</div>
        ) : (
          <ul className="list">
            {rest.map(t => {
              const overdue = isOverdue(t);
              return (
                <li key={t.id} className="item">
                  <label style={{ display:"flex", gap:10, alignItems:"flex-start", flex:1 }}>
                    <input type="checkbox" checked={t.status==="done"} onChange={()=>toggleDone(t)} />
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span>{displayTitle(t)}</span>
                        {overdue && <span className="badge">Overdue</span>}
                      </div>
                      {overdue && (
                        <div className="muted" style={{ marginTop:4 }}>
                          Due {t.due_date} · <button className="btn-ghost" onClick={()=>moveToSelectedDate(t.id)}>Move to {dateISO}</button>
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="card" style={{ display:"grid", gap:8 }}>
        <h2 style={{ margin:0 }}>Add Task</h2>
        <label style={{ display:"grid", gap:6 }}>
          <div className="section-title">Task title</div>
          <input
            type="text"
            placeholder="e.g., Buy gift for Carys"
            value={newTitle}
            onChange={e=>setNewTitle(e.target.value)}
            onKeyDown={(e)=>{ if (e.key === "Enter" && newTitle.trim() && !adding) addTask(); }}
          />
        </label>

        <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
          <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
            <input type="checkbox" checked={newTop} onChange={e=>setNewTop(e.target.checked)} />
            Mark as Top Priority
          </label>

          {/* NEW: repeat picker */}
          <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
            <span className="muted">Repeat</span>
            <select value={newRepeat} onChange={e=>setNewRepeat(e.target.value as Repeat)} title="Repeat (optional)">
              <option value="">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Daily (Mon–Fri)</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>
          </label>

          <div className="muted">Will be created for {dateISO}{newRepeat ? " + future repeats" : ""}</div>

          <button onClick={addTask} disabled={!newTitle.trim() || adding} className="btn-primary" style={{ marginLeft:"auto", borderRadius:8 }}>
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {err && <div style={{ color:"red" }}>{err}</div>}
      </div>
    </div>
  );
}
