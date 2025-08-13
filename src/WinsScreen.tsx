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
  category: string | null;
  category_color: string | null;
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
function startOfWeekMonday(d: Date) {
  const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = tmp.getDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // Mon=0
  tmp.setDate(tmp.getDate() - diff);
  return tmp;
}
function endOfWeekMonday(d: Date) {
  const s = startOfWeekMonday(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Map timestamp -> local date string 'YYYY-MM-DD' */
function dateOnlyLocal(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return toISO(d);
}

export default function WinsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState<TaskRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // Load recent completions (last 365 days)
  async function load() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const since = new Date(); since.setDate(since.getDate() - 365);
      const { data, error } = await supabase
        .from("tasks")
        .select("id,user_id,title,status,completed_at,due_date,priority,source,category,category_color")
        .eq("user_id", userId)
        .eq("status", "done")
        .gte("completed_at", since.toISOString())
        .order("completed_at", { ascending: false });
      if (error) throw error;
      setDoneTasks((data as TaskRow[]) || []);
    } catch (e: any) {
      setErr(e.message || String(e));
      setDoneTasks([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (userId) load(); }, [userId]);

  // Group by completion date (local)
  const byDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of doneTasks) {
      const d = dateOnlyLocal(t.completed_at);
      if (!d) continue;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(t);
    }
    // sort tasks per day by priority desc
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
    return map;
  }, [doneTasks]);

  const today = new Date();

  // Streaks (current & best): days with >=1 completion
  const { currentStreak, bestStreak } = useMemo(() => {
    const dates = new Set<string>([...byDay.keys()]);
    // Current streak: consecutive days ending today
    let cur = 0;
    const probe = new Date(today);
    while (dates.has(toISO(probe))) {
      cur++;
      probe.setDate(probe.getDate() - 1);
    }
    // Best streak: scan last 365 days
    let best = 0, run = 0;
    const scan = new Date(today);
    for (let i = 0; i < 365; i++) {
      if (dates.has(toISO(scan))) {
        run++; best = Math.max(best, run);
      } else {
        run = 0;
      }
      scan.setDate(scan.getDate() - 1);
    }
    return { currentStreak: cur, bestStreak: best };
  }, [byDay]);

  // Totals
  const totals = useMemo(() => {
    let todayCount = 0;
    let weekCount = 0;
    let monthCount = 0;
    let allCount = doneTasks.length;
    let topToday = 0;
    let topWeek = 0;
    let topMonth = 0;

    const startW = startOfWeekMonday(today);
    const endW = endOfWeekMonday(today);
    const startM = new Date(today.getFullYear(), today.getMonth(), 1);
    const endM = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    for (const t of doneTasks) {
      const iso = dateOnlyLocal(t.completed_at);
      if (!iso) continue;
      const d = fromISO(iso);
      const isTop = (t.priority ?? 0) >= 2;

      if (isSameDay(d, today)) {
        todayCount++; if (isTop) topToday++;
      }
      if (d >= startW && d <= endW) {
        weekCount++; if (isTop) topWeek++;
      }
      if (d >= startM && d <= endM) {
        monthCount++; if (isTop) topMonth++;
      }
    }
    return { todayCount, weekCount, monthCount, allCount, topToday, topWeek, topMonth };
  }, [doneTasks]);

  // Recent 7 days list
  const last7 = useMemo(() => {
    const out: { dateISO: string; tasks: TaskRow[] }[] = [];
    const d = new Date(today);
    for (let i = 0; i < 7; i++) {
      const iso = toISO(d);
      out.push({ dateISO: iso, tasks: byDay.get(iso) || [] });
      d.setDate(d.getDate() - 1);
    }
    return out;
  }, [byDay]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 12 }}>
      {/* Left: stats + recent days */}
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card">
          <h1>Your Successes</h1>
          <div className="muted">Every completed task counts. Top-priority items are highlighted.</div>
        </div>

        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div className="card">
            <div className="section-title">Today</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{totals.todayCount}</div>
            <div className="muted">Top-priority: {totals.topToday}</div>
          </div>
          <div className="card">
            <div className="section-title">This week</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{totals.weekCount}</div>
            <div className="muted">Top-priority: {totals.topWeek}</div>
          </div>
          <div className="card">
            <div className="section-title">This month</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{totals.monthCount}</div>
            <div className="muted">Top-priority: {totals.topMonth}</div>
          </div>
          <div className="card">
            <div className="section-title">All time</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{totals.allCount}</div>
            <div className="muted">Keep going!</div>
          </div>
          <div className="card">
            <div className="section-title">Current streak</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{currentStreak} day{currentStreak === 1 ? "" : "s"}</div>
            <div className="muted">Best: {bestStreak}</div>
          </div>
        </div>

        {/* Last 7 days breakdown */}
        <div className="card">
          <h2 style={{ margin: 0 }}>Last 7 days</h2>
          <ul className="list" style={{ marginTop: 8 }}>
            {last7.map(({ dateISO, tasks }) => (
              <li key={dateISO} className="item">
                <div style={{ width: 110 }}>
                  <div style={{ fontWeight: 600 }}>{dateISO}</div>
                  <div className="muted">{tasks.length} done</div>
                </div>
                <div style={{ flex: 1 }}>
                  {tasks.length === 0 ? (
                    <span className="muted">No completions</span>
                  ) : (
                    <ul className="list">
                      {tasks.slice(0, 5).map(t => (
                        <li key={t.id} style={{ marginBottom: 6 }}>
                          <span style={{ fontWeight: (t.priority ?? 0) >= 2 ? 600 : 400 }}>
                            {(t.priority ?? 0) >= 2 ? "★ " : ""}
                            {t.title}
                          </span>
                          {t.source?.startsWith("big_goal") && <span className="muted"> · big goal</span>}
                        </li>
                      ))}
                      {tasks.length > 5 && <li className="muted">…and {tasks.length - 5} more</li>}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right: options & refresh */}
      <div className="card" style={{ display: "grid", gap: 10, height: "fit-content" }}>
        <h2 style={{ margin: 0 }}>Options</h2>
        <div className="muted">
          Wins are counted when a task’s status becomes <b>done</b>. We track the timestamp as <code>completed_at</code>.
        </div>
        <button onClick={load} disabled={loading} className="btn-primary" style={{ borderRadius: 8 }}>
          {loading ? "Refreshing…" : "Refresh data"}
        </button>
        <div className="muted">Tip: mark big-goal tasks as done to power your streak.</div>
      </div>

      {err && <div style={{ color: "red" }}>{err}</div>}
    </div>
  );
}
