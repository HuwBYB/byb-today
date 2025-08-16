import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types ---------- */
type TaskRow = {
  id: number;
  user_id: string;
  title: string;
  status: string;
  completed_at: string | null;
  due_date: string | null;
  priority: number | null;
  source: string | null;
  category: string | null;
  category_color: string | null;
};

type GratRow = {
  id: number;
  user_id: string;
  entry_date: string;   // 'YYYY-MM-DD'
  item_index: number;   // 1..8
  content: string;
};

type WorkoutSession = {
  id: number;
  user_id: string;
  session_date: string; // 'YYYY-MM-DD'
  notes: string | null;
};

type WorkoutItemRow = {
  id: number;
  user_id: string;
  session_id: number;
  kind: string;         // 'weights' | 'run' | ...
  title: string;
  metrics: Record<string, unknown>;
  session_date: string; // joined from workout_sessions
};

type BucketKey = "all" | "general" | "big" | "exercise" | "gratitude";

type Detail = {
  id: string;
  label: string;
  date: string;
  kind?: string;
};

/* ---------- Helpers ---------- */
function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function dateOnlyLocal(ts: string | null): string | null {
  if (!ts) return null;
  return toISO(new Date(ts));
}
function secondsToMMSS(sec?: number | null) {
  if (!sec || sec <= 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function paceStr(distanceKm?: number, durSec?: number) {
  if (!distanceKm || !durSec || distanceKm <= 0) return "";
  const secPerKm = Math.round(durSec / distanceKm);
  return `${secondsToMMSS(secPerKm)}/km`;
}

/* ---------- Classifiers (tasks table) ---------- */
function isBigGoal(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  return src.startsWith("big_goal") || cat === "big_goal" || cat === "goal" || title.includes("big goal");
}
// treat “exercise-like” task titles as exercise so we can EXCLUDE them from counts
function isExerciseishTask(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  if (src.includes("exercise_session")) return true;
  if (cat.includes("exercise") || cat.includes("workout") || cat.includes("fitness")) return true;
  return /\b(run|walk|jog|gym|workout|exercise|yoga|swim|cycle|cycling|ride|lift|weights|pilates|stretch)\b/.test(title);
}

/* ======================================================================= */

export default function WinsScreen() {
  const [userId, setUserId] = useState<string | null>(null);

  const [doneTasks, setDoneTasks] = useState<TaskRow[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [sessionItems, setSessionItems] = useState<Record<number, WorkoutItemRow[]>>({});
  const [grats, setGrats] = useState<GratRow[]>([]);

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<BucketKey>("all");

  /* Auth */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* Load data */
  useEffect(() => { if (userId) loadAll(); }, [userId]);

  async function loadAll() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const since = new Date();
      since.setDate(since.getDate() - 365);

      // 1) done tasks (exclude legacy exercise_session tasks so no double count)
      const { data: tdata, error: terror } = await supabase
        .from("tasks")
        .select("id,user_id,title,status,completed_at,due_date,priority,source,category,category_color")
        .eq("user_id", userId)
        .eq("status", "done")
        .neq("source", "exercise_session")
        .gte("completed_at", since.toISOString())
        .order("completed_at", { ascending: false });
      if (terror) throw terror;

      // 2) workout sessions (these drive the Exercise count)
      const { data: sData, error: sErr } = await supabase
        .from("workout_sessions")
        .select("id,user_id,session_date,notes")
        .eq("user_id", userId)
        .gte("session_date", toISO(since))
        .order("session_date", { ascending: false });
      if (sErr) throw sErr;
      const sess = (sData as WorkoutSession[]) || [];
      setSessions(sess);

      // fetch items for those sessions (to summarize in the list)
      let itemsBySession: Record<number, WorkoutItemRow[]> = {};
      if (sess.length) {
        const sessionIds = sess.map(s => s.id);
        const { data: iData, error: iErr } = await supabase
          .from("workout_items")
          .select("id,user_id,session_id,kind,title,metrics")
          .in("session_id", sessionIds)
          .order("id", { ascending: true });
        if (iErr) throw iErr;

        const idToDate: Record<number, string> = {};
        sess.forEach(s => { idToDate[s.id] = s.session_date; });

        ((iData as any[]) || []).forEach(i => {
          const row: WorkoutItemRow = {
            id: i.id, user_id: i.user_id, session_id: i.session_id,
            kind: i.kind, title: i.title, metrics: i.metrics || {}, session_date: idToDate[i.session_id] || ""
          };
          (itemsBySession[row.session_id] ||= []).push(row);
        });
      }
      setSessionItems(itemsBySession);

      // 3) gratitudes
      const { data: gdata, error: gerror } = await supabase
        .from("gratitude_entries")
        .select("id,user_id,entry_date,item_index,content")
        .eq("user_id", userId)
        .gte("entry_date", toISO(since))
        .order("entry_date", { ascending: false })
        .order("item_index", { ascending: true });
      if (gerror) throw gerror;

      setDoneTasks((tdata as TaskRow[]) || []);
      setGrats((gdata as GratRow[]) || []);
    } catch (e: any) {
      setErr(e.message || String(e));
      setDoneTasks([]); setSessions([]); setSessionItems({}); setGrats([]);
    } finally {
      setLoading(false);
    }
  }

  /* Buckets & counts */
  const generalTasks = useMemo(
    () => doneTasks.filter(t => !isBigGoal(t) && !isExerciseishTask(t)),
    [doneTasks]
  );
  const bigGoalTasks = useMemo(() => doneTasks.filter(isBigGoal), [doneTasks]);

  const counts = {
    general: generalTasks.length,
    big: bigGoalTasks.length,
    exercise: sessions.length,         // *** sessions only ***
    gratitude: grats.length,
    all: generalTasks.length + bigGoalTasks.length + sessions.length + grats.length,
  };

  /* Labels & details */
  function labelSession(session: WorkoutSession) {
    const items = sessionItems[session.id] || [];
    const weights = items.filter(i => i.kind === "weights").length;
    const cardioLabels = items.filter(i => i.kind !== "weights").map(i => labelWorkoutItem(i));
    const parts = [];
    if (weights) parts.push(`Weights: ${weights}`);
    if (cardioLabels.length) parts.push(`Cardio: ${cardioLabels.join(" · ")}`);
    return parts.join(" · ") || "Session";
  }

  function labelWorkoutItem(i: WorkoutItemRow) {
    const d = i.metrics?.["distance_km"] as number | undefined;
    const sec = i.metrics?.["duration_sec"] as number | undefined;
    const bits: string[] = [];
    bits.push(i.title || i.kind);
    if (d) bits.push(`${d} km`);
    if (sec) bits.push(secondsToMMSS(sec));
    if (d && sec) bits.push(paceStr(d, sec));
    return bits.join(" • ");
  }

  function listFor(k: BucketKey): Detail[] {
    if (k === "general") {
      return generalTasks.map(t => ({
        id: `task-${t.id}`,
        label: t.title,
        date: dateOnlyLocal(t.completed_at) || ""
      }));
    }
    if (k === "big") {
      return bigGoalTasks.map(t => ({
        id: `task-${t.id}`,
        label: t.title,
        date: dateOnlyLocal(t.completed_at) || ""
      }));
    }
    if (k === "exercise") {
      return sessions.map(s => ({
        id: `sess-${s.id}`,
        label: labelSession(s),
        date: s.session_date,
        kind: "Session"
      }));
    }
    if (k === "gratitude") {
      return grats.map(g => ({
        id: `grat-${g.id}`,
        label: g.content || "(empty)",
        date: g.entry_date
      }));
    }
    // all
    const a = generalTasks.map(t => ({
      id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "", kind: "General"
    }));
    const b = bigGoalTasks.map(t => ({
      id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "", kind: "Big goal"
    }));
    const c = sessions.map(s => ({
      id: `sess-${s.id}`, label: labelSession(s), date: s.session_date, kind: "Exercise"
    }));
    const d = grats.map(g => ({
      id: `grat-${g.id}`, label: g.content || "(empty)", date: g.entry_date, kind: "Gratitude"
    }));
    return [...a, ...b, ...c, ...d].sort((x, y) => y.date.localeCompare(x.date));
  }

  const details = useMemo(() => listFor(active), [active, doneTasks, sessions, sessionItems, grats]);

  /* Render */
  return (
    <div className="page-wins" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card">
          <h1>Your Wins</h1>
          <div className="muted">Exercise counts whole <b>workout sessions</b>, not individual exercises.</div>
        </div>

        {/* KPI cards */}
        <div className="wins-kpis" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10 }}>
          <KpiCard title="Everything"     count={counts.all}       active={active === "all"}       onClick={() => setActive("all")} />
          <KpiCard title="General tasks"  count={counts.general}   active={active === "general"}   onClick={() => setActive("general")} />
          <KpiCard title="Big goal tasks" count={counts.big}       active={active === "big"}       onClick={() => setActive("big")} />
          <KpiCard title="Exercise"       count={counts.exercise}  active={active === "exercise"}  onClick={() => setActive("exercise")} />
          <KpiCard title="Gratitudes"     count={counts.gratitude} active={active === "gratitude"} onClick={() => setActive("gratitude")} />
        </div>

        {/* Details */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0 }}>
            {active === "all" ? "All wins" :
             active === "general" ? "General tasks" :
             active === "big" ? "Big goal tasks" :
             active === "exercise" ? "Exercise sessions" :
             "Gratitudes"}
          </h2>

          {details.length === 0 ? (
            <div className="muted">Nothing here yet.</div>
          ) : (
            <ul className="list">
              {details.slice(0, 120).map(item => (
                <li key={item.id} className="item" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.kind ? `[${item.kind}] ` : ""}{item.label}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>{item.date}</div>
                  </div>
                </li>
              ))}
              {details.length > 120 && (
                <li className="muted">…and {details.length - 120} more</li>
              )}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="card" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={loadAll} disabled={loading} className="btn-primary" style={{ borderRadius: 8 }}>
            {loading ? "Refreshing…" : "Refresh data"}
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>
    </div>
  );
}

/* ---------- Tiny component ---------- */
function KpiCard({ title, count, onClick, active }:{
  title: string; count: number; onClick: ()=>void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        textAlign: "left",
        cursor: "pointer",
        borderColor: active ? "hsl(var(--pastel-hsl))" : "var(--border)",
        boxShadow: active ? "0 8px 22px rgba(0,0,0,.06)" : "var(--shadow)",
      }}
      aria-pressed={active}
    >
      <div className="section-title">{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{count}</div>
    </button>
  );
}
