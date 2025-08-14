import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/** Minimal shape pulled from tasks */
type TaskRow = {
  id: number;
  user_id: string;
  title: string;
  status: "pending" | "done" | "archived" | string;
  completed_at: string | null;  // ISO timestamp
  due_date: string | null;      // 'YYYY-MM-DD'
  priority: number | null;      // we treat >=2 as "Top"
  source: string | null;        // e.g., 'alfred', 'big_goal_daily'
  category: string | null;      // e.g., 'today','big_goal','exercise'
  category_color: string | null;
};

type GratRow = {
  id: number;
  user_id: string;
  entry_date: string;   // 'YYYY-MM-DD'
  item_index: number;   // 1..8
  content: string;
};

/* ----- date helpers (local time) ----- */
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
  const d = new Date(ts);
  return toISO(d);
}

/* ----- categorisers ----- */
function isBigGoal(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  return (
    src.startsWith("big_goal") ||
    cat === "big_goal" ||
    cat === "goal" ||
    title.includes("big goal")
  );
}
function isExercise(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  if (cat.includes("exercise") || cat.includes("workout") || cat.includes("fitness")) return true;
  if (src.includes("exercise") || src.includes("workout")) return true;
  return /\b(run|walk|jog|gym|workout|exercise|yoga|swim|cycle|cycling|ride|lift|weights|pilates|stretch)\b/.test(title);
}

type BucketKey = "all" | "general" | "big" | "exercise" | "gratitude";

export default function WinsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState<TaskRow[]>([]);
  const [grats, setGrats] = useState<GratRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<BucketKey>("all");

  // auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // Load all completed tasks + all gratitudes
  async function load() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      // tasks (status=done, all-time)
      const { data: tdata, error: terror } = await supabase
        .from("tasks")
        .select("id,user_id,title,status,completed_at,due_date,priority,source,category,category_color")
        .eq("user_id", userId)
        .eq("status", "done")
        .order("completed_at", { ascending: false });
      if (terror) throw terror;

      // gratitudes (all-time)
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
      setDoneTasks([]); setGrats([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (userId) load(); }, [userId]);

  /* ----- buckets & counts ----- */
  const bigGoalTasks = useMemo(() => doneTasks.filter(isBigGoal), [doneTasks]);
  const exerciseTasks = useMemo(() => doneTasks.filter(isExercise), [doneTasks]);
  const generalTasks = useMemo(
    () => doneTasks.filter(t => !isBigGoal(t) && !isExercise(t)),
    [doneTasks]
  );

  const counts = {
    general: generalTasks.length,
    big: bigGoalTasks.length,
    exercise: exerciseTasks.length,
    gratitude: grats.length,
    all: generalTasks.length + bigGoalTasks.length + exerciseTasks.length + grats.length,
  };

  // Details for the active bucket
  const listFor = (k: BucketKey) => {
    switch (k) {
      case "general": return generalTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "" }));
      case "big":     return bigGoalTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "" }));
      case "exercise":return exerciseTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "" }));
      case "gratitude": return grats.map(g => ({ id: `grat-${g.id}`, label: g.content || "(empty)", date: g.entry_date }));
      case "all": default: {
        const a = generalTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "", kind: "General" as const }));
        const b = bigGoalTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "", kind: "Big goal" as const }));
        const c = exerciseTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "", kind: "Exercise" as const }));
        const d = grats.map(g => ({ id: `grat-${g.id}`, label: g.content || "(empty)", date: g.entry_date, kind: "Gratitude" as const }));
        return [...a, ...b, ...c, ...d].sort((x, y) => (y.date > x.date ? 1 : -1));
      }
    }
  };

  const details = useMemo(() => listFor(active), [active, doneTasks, grats]);

  return (
    <div className="page-wins">
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card">
          <h1>Your Wins</h1>
          <div className="muted">Tap a card to see the items behind the count.</div>
        </div>

        {/* KPI cards */}
        <div className="wins-kpis">
          <KpiCard
            title="Everything"
            count={counts.all}
            active={active === "all"}
            onClick={() => setActive("all")}
          />
          <KpiCard
            title="General tasks"
            count={counts.general}
            active={active === "general"}
            onClick={() => setActive("general")}
          />
          <KpiCard
            title="Big goal tasks"
            count={counts.big}
            active={active === "big"}
            onClick={() => setActive("big")}
          />
          <KpiCard
            title="Exercise"
            count={counts.exercise}
            active={active === "exercise"}
            onClick={() => setActive("exercise")}
          />
          <KpiCard
            title="Gratitudes"
            count={counts.gratitude}
            active={active === "gratitude"}
            onClick={() => setActive("gratitude")}
          />
        </div>

        {/* Details for selected bucket */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0 }}>
            {active === "all" ? "All wins" :
             active === "general" ? "General tasks" :
             active === "big" ? "Big goal tasks" :
             active === "exercise" ? "Exercise" :
             "Gratitudes"}
          </h2>

          {details.length === 0 ? (
            <div className="muted">Nothing here yet.</div>
          ) : (
            <ul className="list">
              {details.slice(0, 60).map(item => (
                <li key={item.id} className="item" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {"kind" in item ? `[${item.kind}] ` : ""}{item.label}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>{item.date}</div>
                  </div>
                </li>
              ))}
              {details.length > 60 && (
                <li className="muted">…and {details.length - 60} more</li>
              )}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="card" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={load} disabled={loading} className="btn-primary" style={{ borderRadius: 8 }}>
            {loading ? "Refreshing…" : "Refresh data"}
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>
    </div>
  );
}

/* ---- tiny components ---- */
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
    >
      <div className="section-title">{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{count}</div>
    </button>
  );
}
