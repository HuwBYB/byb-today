// src/WinsScreen.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

// ✅ Use the shared theme (colors, category styles, utility classes)
import "./theme.css";

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

/* ---------- Classifier ---------- */
function isBigGoal(t: TaskRow) {
  const cat = (t.category || "").toLowerCase();
  const src = (t.source || "").toLowerCase();
  const title = (t.title || "").toLowerCase();
  return src.startsWith("big_goal") || cat === "big_goal" || cat === "goal" || title.includes("big goal");
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

  if (period === "today") return toISO(target) === toISO(today);

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
/* ------------------------ Scoring & Streaks ----------------------------- */
const SCORE_WEIGHTS = {
  general: 1,
  big: 2,
  exercise: 2,
  gratitude: 0.5,
} as const;

const DAILY_TARGET_DEFAULT = 5; // tweakable per-user later

type DailyBucketCounts = {
  dateISO: string;
  general: number;
  big: number;
  exercise: number;
  gratitude: number;
};

function aggregateDailyCounts(
  tasks: TaskRow[],
  sessions: WorkoutSession[],
  grats: GratRow[]
): Record<string, DailyBucketCounts> {
  const map: Record<string, DailyBucketCounts> = {};
  const add = (d: string, key: keyof DailyBucketCounts) => {
    const row = (map[d] ||= { dateISO: d, general: 0, big: 0, exercise: 0, gratitude: 0 });
    // @ts-ignore
    row[key] += 1;
  };

  tasks.forEach(t => {
    const d = dateOnlyLocal(t.completed_at);
    if (!d) return;
    add(d, isBigGoal(t) ? "big" : "general");
  });

  sessions.forEach(s => add(s.session_date, "exercise"));
  grats.forEach(g => add(g.entry_date, "gratitude"));

  return map;
}

function scoreForDay(row: DailyBucketCounts) {
  return (
    row.general * SCORE_WEIGHTS.general +
    row.big * SCORE_WEIGHTS.big +
    row.exercise * SCORE_WEIGHTS.exercise +
    row.gratitude * SCORE_WEIGHTS.gratitude
  );
}

function buildCalendarWindow(days = 28) {
  const today = new Date();
  return Array.from({ length: days }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return toISO(d);
  });
}

function calcStreak(dailyScores: Record<string, number>, target: number) {
  // current streak (count back from today)
  const days = buildCalendarWindow(180).reverse(); // check last 6 months
  let current = 0;
  for (const iso of days) {
    const met = (dailyScores[iso] || 0) >= target;
    if (iso === toISO(new Date()) && met) current++;
    else if (iso < toISO(new Date())) {
      if (met) current++;
      else break;
    }
  }
  // best streak within window
  let best = 0, run = 0;
  for (const iso of days) {
    const met = (dailyScores[iso] || 0) >= target;
    run = met ? run + 1 : 0;
    if (run > best) best = run;
  }
  return { current, best };
}

/* ---------- UI: Progress Ring + Streak Chip + Heatmap + Confetti ---------- */
function ProgressRing({ value, target }: { value: number; target: number }) {
  const pct = Math.max(0, Math.min(1, value / Math.max(1, target)));
  const size = 120, stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;

  return (
    <div aria-label={`Daily progress ${Math.round(pct * 100)}%`} role="img"
         style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--muted)" strokeWidth={stroke} fill="none" opacity={0.25}/>
        <circle cx={size/2} cy={size/2} r={r} stroke="currentColor" strokeWidth={stroke} fill="none"
                strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round"/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
        <div className="muted" style={{ fontSize: 12 }}>/ {target}</div>
      </div>
    </div>
  );
}

function StreakChip({ current, best }:{ current:number; best:number }) {
  return (
    <div aria-label={`Current streak ${current} days, best ${best} days`}
      style={{
        display:"inline-flex", alignItems:"center", gap:8,
        padding:"8px 12px", borderRadius:999, border:"1px solid var(--border)",
        background:"var(--card)", fontWeight:700
      }}>
      🔥 {current} <span className="muted" style={{ fontWeight:500 }}>(best {best})</span>
    </div>
  );
}

function Heatmap28({ dailyScores, target }:{ dailyScores:Record<string,number>; target:number }) {
  const days = buildCalendarWindow(28);
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 12px)", gap:4 }}>
      {days.map(d => {
        const met = (dailyScores[d] || 0) >= target;
        return (
          <div key={d} title={`${d}: ${Math.round(dailyScores[d] || 0)} / ${target}`}
               style={{
                 width:12, height:12, borderRadius:2,
                 background: met ? "hsl(var(--pastel-hsl))" : "var(--muted-bg)",
                 border: "1px solid var(--border)"
               }}/>
        );
      })}
    </div>
  );
}

function ConfettiBurst({ show }:{ show:boolean }) {
  if (!show) return null;
  const pieces = Array.from({ length: 16 });
  return (
    <div aria-hidden
      style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:3000 }}>
      {pieces.map((_, i) => (
        <span key={i}
          style={{
            position:"absolute",
            left: `${(i / pieces.length) * 100}%`,
            top: -10,
            width:6, height:10, borderRadius:1,
            background:"hsl(var(--pastel-hsl))",
            animation: `fall ${600 + i*20}ms ease-out forwards`,
          }}/>
      ))}
      <style>{`@keyframes fall{ to { transform: translateY(100vh) rotate(260deg); opacity:.2; } }`}</style>
    </div>
  );
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
      // 1) done tasks — exclude the auto exercise-session task (exercise is shown via sessions)
      const { data: tdata, error: terror } = await supabase
        .from("tasks")
        .select("id,user_id,title,status,completed_at,due_date,priority,source,category,category_color")
        .eq("user_id", userId)
        .eq("status", "done")
        .neq("source", "exercise_session")
        .order("completed_at", { ascending: false });
      if (terror) throw terror;

      // 2) workout sessions
      const { data: sData, error: sErr } = await supabase
        .from("workout_sessions")
        .select("id,user_id,session_date,notes")
        .eq("user_id", userId)
        .order("session_date", { ascending: false });
      if (sErr) throw sErr;
      const sess = (sData as WorkoutSession[]) || [];
      setSessions(sess);

      // items per session (for labels)
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

  /* Filtered by period */
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
    () => filtered.tasksInPeriod.filter(t => !isBigGoal(t)),
    [filtered.tasksInPeriod]
  );
  const bigGoalTasks = useMemo(
    () => filtered.tasksInPeriod.filter(isBigGoal),
    [filtered.tasksInPeriod]
  );

  const counts = {
    general: generalTasks.length,
    big: bigGoalTasks.length,
    exercise: filtered.sessionsInPeriod.length,   // sessions
    gratitude: filtered.gratsInPeriod.length,
    all:
      generalTasks.length +
      bigGoalTasks.length +
      filtered.sessionsInPeriod.length +
      filtered.gratsInPeriod.length,
  };

  /* “At a glance” totals */
  const glance = useMemo(() => {
    const calc = (p: PeriodKey) => {
      const tasksIn = doneTasks.filter(tt => {
        const d = dateOnlyLocal(tt.completed_at);
        return !!d && inPeriodISO(d, p);
      });
      const generalIn = tasksIn.filter(tt => !isBigGoal(tt)).length;
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
    const parts: string[] = [];
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

  const details = useMemo(
    () => listFor(active),
    [active, filtered, generalTasks, bigGoalTasks, sessionItems]
  );

  /* -------------------- Score & Streak derived -------------------- */
  const dailyAgg = useMemo(() => aggregateDailyCounts(doneTasks, sessions, grats), [doneTasks, sessions, grats]);
  const dailyScores = useMemo(() => {
    const m: Record<string, number> = {};
    Object.values(dailyAgg).forEach(row => { m[row.dateISO] = scoreForDay(row); });
    return m;
  }, [dailyAgg]);
  const todayScore = dailyScores[toISO(new Date())] || 0;
  const DAILY_TARGET = DAILY_TARGET_DEFAULT; // later per-user
  const streak = useMemo(() => calcStreak(dailyScores, DAILY_TARGET), [dailyScores]);

  /* Celebration + optional haptic */
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    const crossed = todayScore >= DAILY_TARGET;
    setCelebrate(crossed);
    if (crossed && (navigator as any).vibrate) (navigator as any).vibrate(10);
  }, [todayScore, DAILY_TARGET]);

  /* Render */
  return (
    <div className="page-wins" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card">
          <h1 style={{ margin: 0 }}>Your Wins</h1>
        </div>

        {/* Hero: Daily Score + Streak + Heatmap */}
        <div className="card" style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:12, alignItems:"center" }}>
          <ProgressRing value={Math.round(todayScore)} target={DAILY_TARGET} />
          <div style={{ display:"grid", gap:8 }}>
            <div className="section-title">Today’s Score</div>
            <StreakChip current={streak.current} best={streak.best} />
            <Heatmap28 dailyScores={dailyScores} target={DAILY_TARGET} />
            <div className="muted" style={{ fontSize:12 }}>Hit {DAILY_TARGET} points to keep your streak alive.</div>
          </div>
        </div>

        {/* At a glance (TOP) */}
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
            } · {PERIODS.find(p => p.key === period)?.label || ""}
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

      <ConfettiBurst show={celebrate} />
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
