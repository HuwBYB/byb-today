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
  source: string | null;       // e.g., 'big_goal_daily'
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

type WorkoutItemRow = {
  id: number;
  user_id: string;
  session_id: number;
  kind: string;
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
function isExerciseTask(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  if (cat.includes("exercise") || cat.includes("workout") || cat.includes("fitness")) return true;
  if (src.includes("exercise") || src.includes("workout")) return true;
  return /\b(run|walk|jog|gym|workout|exercise|yoga|swim|cycle|cycling|ride|lift|weights|pilates|stretch)\b/.test(title);
}

/* ======================================================================= */

export default function WinsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState<TaskRow[]>([]);
  const [workoutItems, setWorkoutItems] = useState<WorkoutItemRow[]>([]);
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
      // 1) done tasks
      const { data: tdata, error: terror } = await supabase
        .from("tasks")
        .select("id,user_id,title,status,completed_at,due_date,priority,source,category,category_color")
        .eq("user_id", userId)
        .eq("status", "done")
        .order("completed_at", { ascending: false });
      if (terror) throw terror;

      // 2) workout items
      const { data: iData, error: iErr } = await supabase
        .from("workout_items")
        .select("id,user_id,session_id,kind,title,metrics")
        .eq("user_id", userId)
        .order("id", { ascending: false });
      if (iErr) throw iErr;

      // join to sessions to get the date
      const sessionIds = Array.from(new Set((iData || []).map((i: any) => i.session_id)));
      let idToDate: Record<number, string> = {};
      if (sessionIds.length) {
        const { data: sData, error: sErr } = await supabase
          .from("workout_sessions")
          .select("id,session_date")
          .in("id", sessionIds);
        if (sErr) throw sErr;
        (sData || []).forEach((s: any) => { idToDate[s.id] = s.sessio
