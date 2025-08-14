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
  priority: number | null;
  source: string | null;        // e.g., 'big_goal_daily'
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

type WorkoutItemRow = {
  id: number;
  user_id: string;
  session_id: number;
  kind: string;
  title: string;
  metrics: any;           // {distance_km?:number, duration_sec?:number}
  session_date: string;   // joined from workout_sessions
};

/* ----- small helpers ----- */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function dateOnlyLocal(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return toISO(d);
}
function secondsToMMSS(sec?: number | null) {
  if (!sec || sec <= 0) return "00:00";
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function paceStr(distanceKm?: number, durSec?: number) {
  if (!distanceKm || !durSec || distanceKm <= 0) return "";
  const secPerKm = Math.round(durSec / distanceKm);
  return `${secondsToMMSS(secPerKm)}/km`;
}

/* ----- categorisers for tasks table ----- */
function isBigGoal(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  return src.startsWith("big_goal") || cat === "big_goal" || cat === "goal" || title.includes("big goal");
}
function isExerciseTask(t: TaskRow) {
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
  const [workoutItems, setWorkoutItems] = useState<WorkoutItemRow[]>([]);
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

  // Load tasks (done), workout items (+session dates), and gratitudes
  async function load() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      // 1) tasks
      const { data: tdata, error: terror } = await supabase
        .from("tasks")
        .select("id,user_id,title,status,completed_at,due_date,priority,source,category,category_color")
        .eq("user_id", userId)
        .eq("status", "done")
        .order("completed_at", { ascending: false });
      if (terror) throw terror;

      // 2) workout items + join to sessions to get session_date
      const { data: iData, error: iErr } = await supabase
        .from("workout_items")
        .select("id,user_id,session_id,kind,title,metrics")
        .eq("user_id", userId)
        .order("id", { ascending: false });
      if (iErr) throw iErr;

      const sessionIds = Array.from(new Set((iData || []).map((i:any) => i.session_id)));
      let idToDate: Record<number, string> = {};
      if (sessionIds.length) {
        const { data: sData, error: sErr } = await supabase
          .from("workout_sessions")
          .select("id,session_date")
          .in("id", sessionIds);
        if (sErr) throw sErr;
        (sData || []).forEach((s:any) => { idToDate[s.id] = s.session_date; });
      }

      const wItems: WorkoutItemRow[] = (iData as any[] || []).map(i => ({
        id: i.id, user_id: i.user_id, session_id: i.session_id,
        kind: i.kind, title: i.title, metrics: i.metrics || {},
        session_date: idToDate[i.session_id] || ""
      }));

      // 3) gratitudes
      const { data: gdata, error: gerror } = await supabase
        .from("gratitude_entries")
        .select("id,user_id,entry_date,item_index,content")
        .eq("user_id", userId)
        .order("entry_date", { ascending: false })
        .order("item_index", { ascending: true });
      if (gerror) throw gerror;

      setDoneTasks((tdata as TaskRow[]) || []);
      setWorkoutItems(wItems);
      setGrats((gdata as GratRow[]) || []);
    } catch (e: any) {
      setErr(e.message || String(e));
      setDoneTasks([]); setWorkoutItems([]); setGrats([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (userId) load(); }, [userId]);

  /* ----- buckets & counts ----- */
  const bigGoalTasks = useMemo(() => doneTasks.filter(isBigGoal), [doneTasks]);
  const exerciseTasks = useMemo(() => doneTasks.filter(isExerciseTask), [doneTasks]);
  const generalTasks = useMemo(
    () => doneTasks.filter(t => !isBigGoal(t) && !isExerciseTask(t)),
    [doneTasks]
  );

  const counts = {
    general: generalTasks.length,
    big: bigGoalTasks.length,
    // Exercise = tasks flagged as exercise + ALL workout items from the diary
    exercise: exerciseTasks.length + workoutItems.length,
    gratitude: grats.length,
    all: generalTasks.length + bigGoalTasks.length + (exerciseTasks.length + workoutItems.length) + grats.length,
  };

  // Format diary workout item to a nice label
  function labelWorkout(i: WorkoutItemRow) {
    const d = i.metrics?.distance_km as number | undefined;
    const sec = i.metrics?.duration_sec as number | undefined;
    const bits = [
      i.title || i.kind,
      d ? `${d} km` : null,
      sec ? secondsToMMSS(sec) : null,
      d && sec ? paceStr(d, sec) : null,
    ].filter(Boolean);
    return bits.join(" • ");
  }

  // Details for the active bucket
  type Detail = { id: string; label: string; date: string; kind?: string };
  const listFor = (k: BucketKey): Detail[] => {
    switch (k) {
      case "general": return generalTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "" }));
      case "big":     return bigGoalTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "" }));
      case "exercise": {
        const a = exerciseTasks.map(t => ({ id: `task-${t.id}`, label: t.title, date: dateOnlyLocal(t.completed_at) || "", kind: "Task" }));
        const b = workoutItems.map(i => ({ id: `workout-${i.id}`, label: labelWorkout(i), date: i.session_date || "", kind: "Diary" }));
        return [...a, ...b].sort((x, y) => (y.date > x.date ? 1 : -1));
      }
      case "gratitude": return grats.map(g => ({ id: `grat-${g.
