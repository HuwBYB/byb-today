import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types ---------- */
type TaskRow = {
  id: number;
  user_id: string;
  title: string;
  status: string;              // "done", "pending", ...
  completed_at: string | null; // ISO timestamp
  due_date: string | null;
  priority: number | null;
  source: string | null;       // e.g., 'big_goal_daily', 'exercise_session'
  category: string | null;     // e.g., 'today','big_goal','exercise'
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
type PeriodKey = "today" | "week" | "month" | "year" | "all";

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
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function dateOnlyLocal(ts: string | null): string | null {
  if (!ts) return null;
  return toISO(new Date(ts));
}
function startOfWeekMonday(d: Date) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = t.getDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // Mon=0
  t.setDate(t.getDate() - diff);
  return t;
}
function endOfWeekMonday(d: Date) {
  const s = startOfWeekMonday(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
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
/** treat “exercise-like” task titles as exercise so we can EXCLUDE them from general/big */
function isExerciseishTask(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  if (src.includes("exercise_session")) return true;
  if (cat.includes("exercise") || cat.includes("workout") || cat.includes("fitness")) return true;
  return /\b(run|walk|jog|gym|workout|exercise|yoga|swim|cycle|cycling|ride|lift|weights|pilates|stretch)\b/.test(title);
}

/* ---------- Periods ---------- */
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week",  label: "This week" },
  { key: "month", label: "This month" },
  { key: "year",  label: "This year" },
  { key: "all",   label: "All time" },
];

function inPeriodISO(dateISO: string, period: PeriodKey) {
  if (period === "all") return true;
  const today = new Date();
  const target = fromISO(dateISO);

  if (period === "today") {
    return toISO(target) === toISO(today);
  }
  if (period === "week") {
    const s = startOfWeekMonday(today);
    const e = endOfWeekMonday(today);
    return target >= s && target <= e;
  }
  if (period === "month") {
    return target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
  }
  if (period === "year") {
    return target.getFullYear() === today.getFullYear();
  }
  return true;
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

  const [period, setPeriod] = useState<PeriodKey>("today");
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
      // 1) done tasks (exclude legacy exercise_session tasks so no double count)
      const { data: tdata, error: terror } = await supabase
        .from("tasks")
        .select("id,user_id,title,status,completed_at,due_date,priority,source,category,category_color")
        .eq("user_id", userId)
        .eq("status", "done")
        .neq("source", "exercise_session")
        .order("completed_at", { ascending: false });
      if (terror) throw terror;

      // 2) workout sessions (each is ONE exercise win)
      const { data: sData, error: sErr } = await supabase
        .from("workout_sessions")
        .select("id,user_id,session_date,notes")
        .eq("user_id", userId)
        .order("session_date", { ascending: false });
      if (sErr) throw sErr;
      const sess = (sData as WorkoutSession[]) || [];
      setSessions(sess);

      // fetch items per session (to summarize in the list)
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

  /* Filtered datasets by period */
  const filtered = useMemo(() => {
    const tasksInPeriod = doneTasks.filter(t => {
      const d = dateOnlyLocal(t.completed_at);
      return !!d && inPeriodISO(d, period);
    });

    const sessionsInPeriod = sessions.filter(s => inPeriodISO(s.session_date, period));

    const gratsInPeriod = grats.filter(g => inPeriodISO(g.entry_date, period));

    return { tasksInPeriod, sessionsInPeriod, gratsInPeriod };
  }, [doneTasks, sessions, grats, period]);

  /* Buckets & counts for current period */
  const generalTasks = useMemo(
    () => filtered.tasksInPeriod.filter(t => !isBigGoal(t) && !isExerciseishTask(t)),
    [filtered.tasksInPeriod]
  );
  const bigGoalTasks = useMemo(
    () => filtered.tasksInPeriod.filter(isBigGoal),
    [filtered.tasksInPeriod]
  );

  const counts = {
    general: generalTasks.length,
    big: bigGoalTasks.length,
    exercise: filtered.sessionsInPeriod.length,  // sessions only
    gratitude: filtered.gratsInPeriod.length,
    all: generalTasks.length + bigGoalTasks.length + filtered.sessionsInPeriod.length + filtered.gratsInPeriod.length,
  };

  /* “At a glance” values (Everything totals for each period) */
  const glance = useMemo(() => {
    const calc = (p: PeriodKey) => {
      const t = doneTasks.filter(tt => {
        const d = dateOnlyLocal(tt.completed_at);
        return !!d && inPeriodISO(d, p) && !isExerciseishTask(tt) && !isBigGoal(tt) ? true : !!d && inPeriodISO(d, p);
      }); // we'll compute categories below anyway
      const tasksIn = doneTasks.filter(tt => {
        const d = dateOnlyLocal(tt.completed_at);
        return !!d && inPeriodISO(d, p);
      });
      const generalIn = tasksIn.filter(tt => !isBigGoal(tt) && !isExerciseishTask(tt)).length;
      const bigIn = tasksIn.filter(isBigGoal).length;
      const sessIn = sessions.filter(s => inPeriodISO(s.session_date, p)).length;
      const gratIn = grats.filter(g => inPeriodISO(g.entry_date, p)).length;
      return generalIn + bigIn + sessIn + gratIn;
    };
    return {
      today: calc("today"),
      week:  calc("week"),
      month: calc("month"),
      year:  calc("year"),
      all:   calc("all"),
    };
  }, [doneTasks, sessions, grats]);

  /* Labels & details */
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
  function labelSession(session: WorkoutSession) {
    const items = sessionItems[session.id] || [];
    const weights = items.filter(i => i.kind === "weights").length;
    const cardioLabels = items.filter(i => i.kind !== "weights").map(i => labelWorkoutItem(i));
    const parts = [];
    if (weights) parts.push(`Weights: ${weights}`);
    if (cardioLabels.length) parts.push(`Cardio: ${cardioLabels.join(" · ")}`);
    return parts.join(" · ") || "Session";
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
      return filtered.sessionsInPeriod.map(s => ({
        id: `sess-${s.id}`,
        label: labelSession(s),
        date: s.session_date,
        kind: "Session"
      }));
    }
    if (k === "gratitude") {
      return filtered.gratsInPeriod.map(g => ({
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
    const c = filtered.sessionsInPeriod.map(s => ({
      id: `sess-${s.id}`, label: labelSession(s), date: s.session_date, kind: "Exercise"
    }));
    const d = filtered.gratsInPeriod.map(g => ({
      id: `grat-${g.id}`, label: g.content || "(empty)", date: g.entry_date, kind: "Gratitude"
    }));
    return [...a, ...b, ...c, ...d].sort((x, y) => y.date.localeCompare(x.date));
  }

  const details = useMemo(() => listFor(active), [active, filtered, generalTasks, bigGoalTasks, sessionItems]);

  /* Render */
  return (
    <div className="page-wins" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card">
          <h1>Your Wins</h1>
          <div className="muted">Exercise counts whole <b>workout sessions</b>, not individual exercises.</div>
        </div>

        {/* At a glance: Everything totals by period (clickable, highlights active) */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="section-title">At a glance</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:8 }}>
            {PERIODS.map(p => {
              const isActive = period === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className="card"
                  aria-pressed={isActive}
                  title={`View ${p.label.toLowerCase()}`}
                  style={{
                    padding: 10,
                    textAlign: "left",
                    cursor: "pointer",
                    borderColor: isActive ? "hsl(var(--pastel-hsl))" : "var(--border)",
                    background: isActive ? "hsl(var(--pastel-hsl) / .45)" : "var(--card)",
                    color: isActive ? "var(--on-pastel)" : "var(--text)",
                    boxShadow: isActive ? "0 8px 22px rgba(0,0,0,.06)" : "var(--shadow)",
                    transition: "filter .2s ease, background .2s ease, border-color .2s ease",
                  }}
                >
                  <div className="section-title">{p.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{glance[p.key]}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* KPI cards (respect current period) */}
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
            {(active === "all" ? "All wins" :
              active === "general" ? "General tasks" :
              active === "big" ? "Big goal tasks" :
              active === "exercise" ? "Exercise sessions" :
              "Gratitudes")
            } · {
              PERIODS.find(p => p.key === period)?.label || ""
            }
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
        background: active ? "hsl(var(--pastel-hsl) / .45)" : "var(--card)",
        color: active ? "var(--on-pastel)" : "var(--text)",
        boxShadow: active ? "0 8px 22px rgba(0,0,0,.06)" : "var(--shadow)",
        transition: "filter .2s ease, background .2s ease, border-color .2s ease",
      }}
      aria-pressed={active}
    >
      <div className="section-title">{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{count}</div>
    </button>
  );
}
