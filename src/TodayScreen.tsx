import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null;
  status: "pending" | "done" | string;
  priority: number | null; // 2 => Top
  source: string | null;   // e.g., today_repeat_daily
  goal_id: number | null;
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
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function addDays(iso: string, n: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/* ===== repeat config ===== */
type Repeat = "" | "daily" | "weekdays" | "weekly" | "monthly" | "annually";
const REPEAT_COUNTS: Record<Exclude<Repeat, "">, number> = {
  daily: 14,
  weekdays: 20,
  weekly: 12,
  monthly: 12,
  annually: 5
};
const REPEAT_PREFIX = "today_repeat_";

function generateOccurrences(startISO: string, repeat: Repeat): string[] {
  if (!repeat) return [startISO];

  if (repeat === "weekdays") {
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
function getRepeatFromSource(source: string | null): Repeat {
  if (!source || !source.startsWith(REPEAT_PREFIX)) return "";
  const suffix = source.slice(REPEAT_PREFIX.length) as Repeat;
  if (["daily", "weekdays", "weekly", "monthly", "annually"].includes(suffix)) return suffix;
  return "";
}
function makeSeriesKey(repeat: Repeat) {
  return repeat ? `${REPEAT_PREFIX}${repeat}` : "manual";
}

/* ===== display-name helper (pulls from onboarding localStorage) ===== */
const LS_NAME = "byb:display_name";
const LS_POOL = "byb:display_pool";
function chooseGreetingName(): string {
  try {
    const rawName = (localStorage.getItem(LS_NAME) || "").trim();
    const pool = JSON.parse(localStorage.getItem(LS_POOL) || "[]") as string[];
    const cleanPool = Array.isArray(pool) ? pool.filter(Boolean) : [];
    // If there are nicknames, pick one randomly; otherwise fall back to your name.
    if (cleanPool.length > 0) {
      return cleanPool[Math.floor(Math.random() * cleanPool.length)];
    }
    return rawName || "";
  } catch {
    return "";
  }
}

/* ===== summary types ===== */
type Summary = {
  doneToday: number;
  pendingToday: number;
  topDone: number;
  topTotal: number;
  isWin: boolean;
  streak: number;
  bestStreak: number;
};

export default function TodayScreen({ externalDateISO }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(externalDateISO || todayISO());

  const [tasks, setTasks] = useState<Task[]>([]);
  const [goalMap, setGoalMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Bottom "add task" form
  const [newTitle, setNewTitle] = useState("");
  const [newTop, setNewTop] = useState(false);
  const [newRepeat, setNewRepeat] = useState<Repeat>("");
  const [adding, setAdding] = useState(false);

  // Sticky "Now" widget: clock + quick capture
  const [now, setNow] = useState<Date>(new Date());
  const [quickTitle, setQuickTitle] = useState("");
  const [quickTop, setQuickTop] = useState(false);
  const [savingQuick, setSavingQuick] = useState(false);

  // Greeting (stable per page load)
  const [greetName, setGreetName] = useState<string>("");

  // Lightweight daily summary
  const [summary, setSummary] = useState<Summary>({
    doneToday: 0,
    pendingToday: 0,
    topDone: 0,
    topTotal: 0,
    isWin: false,
    streak: 0,
    bestStreak: 0
  });

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTop, setEditTop] = useState(false);
  const [editDue, setEditDue] = useState<string | null>(null);
  const [editRepeat, setEditRepeat] = useState<Repeat>("");
  const [applyFuture, setApplyFuture] = useState(false); // apply title/top to future in series
  const [busyEdit, setBusyEdit] = useState(false);

  useEffect(() => {
    if (externalDateISO) setDateISO(externalDateISO);
  }, [externalDateISO]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        setErr(error.message);
        return;
      }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    // pick a greeting name once on mount
    setGreetName(chooseGreetingName());
  }, []);

  // keep clock fresh
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  function isOverdue(t: Task) {
    return !!t.due_date && t.due_date < dateISO && t.status !== "done";
  }

  async function load() {
    if (!userId) return;
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,user_id,title,due_date,status,priority,source,goal_id,completed_at")
        .eq("user_id", userId)
        .lte("due_date", dateISO)
        .order("priority", { ascending: false })
        .order("id", { ascending: true });

      if (error) throw error;

      const raw = (data as Task[]) || [];
      const list = raw.filter(
        (t) => t.due_date === dateISO || (t.due_date! < dateISO && t.status !== "done")
      );
      setTasks(list);

      const ids = Array.from(
        new Set(list.map((t) => t.goal_id).filter((v): v is number => typeof v === "number"))
      );
      if (ids.length) {
        const { data: gs, error: ge } = await supabase
          .from("goals")
          .select("id,title")
          .in("id", ids);
        if (ge) throw ge;
        const map: Record<number, string> = {};
        (gs as GoalLite[]).forEach((g) => (map[g.id] = g.title));
        setGoalMap(map);
      } else {
        setGoalMap({});
      }

      // compute daily summary
      const doneToday = list.filter(
        (t) => t.due_date === dateISO && t.status === "done"
      ).length;
      const pendingToday = list.filter(
        (t) => t.due_date === dateISO && t.status !== "done"
      ).length;
      const topToday = list.filter(
        (t) => t.due_date === dateISO && (t.priority ?? 0) >= 2
      );
      const topDone = topToday.filter((t) => t.status === "done").length;
      const topTotal = topToday.length;
      const isWin = topDone >= 1 || doneToday >= 3;

      setSummary((s) => ({ ...s, doneToday, pendingToday, topDone, topTotal, isWin }));
    } catch (e: any) {
      setErr(e.message || String(e));
      setTasks([]);
      setGoalMap({});
    } finally {
      setLoading(false);
    }
  }

  // compute streaks over the last 180 days
  async function loadStreaks() {
    if (!userId) return;
    try {
      const since = new Date();
      since.setDate(since.getDate() - 180);
      const { data, error } = await supabase
        .from("tasks")
        .select("completed_at,status,user_id")
        .eq("user_id", userId)
        .eq("status", "done")
        .not("completed_at", "is", null)
        .gte("completed_at", since.toISOString());

      if (error) throw error;

      const days = new Set<string>();
      for (const r of (data as Array<{ completed_at: string }>)) {
        const d = new Date(r.completed_at);
        days.add(toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate())));
      }

      // current streak up to today
      let streak = 0;
      let cursor = todayISO();
      while (days.has(cursor)) {
        streak += 1;
        cursor = addDays(cursor, -1);
      }

      // best streak
      const sorted = Array.from(days).sort();
      let best = 0;
      let run = 0;
      let prev: string | null = null;
      for (const d of sorted) {
        if (!prev) run = 1;
        else {
          const nextOfPrev = addDays(prev, 1);
          run = d === nextOfPrev ? run + 1 : 1;
        }
        best = Math.max(best, run);
        prev = d;
      }

      setSummary((s) => ({ ...s, streak, bestStreak: best }));
    } catch {
      // ignore
    }
  }

  async function loadAll() {
    await load();
    await loadStreaks();
  }

  useEffect(() => {
    if (userId && dateISO) loadAll();
  }, [userId, dateISO]);

  function displayTitle(t: Task) {
    const base = (t.title || "").trim();
    const g = t.goal_id != null ? goalMap[t.goal_id] : "";
    return g ? `${base} (${g})` : base;
  }

  async function toggleDone(t: Task) {
    try {
      const markDone = t.status !== "done";
      const { error } = await supabase
        .from("tasks")
        .update({
          status: markDone ? "done" : "pending",
          completed_at: markDone ? new Date().toISOString() : null
        })
        .eq("id", t.id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function moveToSelectedDate(taskId: number) {
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ due_date: dateISO })
        .eq("id", taskId);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function moveAllOverdueHere() {
    try {
      const overdueIds = tasks.filter(isOverdue).map((t) => t.id);
      if (overdueIds.length === 0) return;
      const { error } = await supabase
        .from("tasks")
        .update({ due_date: dateISO })
        .in("id", overdueIds);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function addTaskWithArgs(title: string, top: boolean, repeat: Repeat) {
    if (!userId || !title.trim()) return;
    const clean = title.trim();
    const occurrences = generateOccurrences(dateISO, repeat);
    const rows = occurrences.map((iso) => ({
      user_id: userId,
      title: clean,
      due_date: iso,
      status: "pending",
      priority: top ? 2 : 0,
      source: repeat ? makeSeriesKey(repeat) : "manual"
    }));
    const { error } = await supabase.from("tasks").insert(rows as any);
    if (error) throw error;
  }

  async function addTask() {
    if (!userId || !newTitle.trim()) return;
    setAdding(true);
    setErr(null);
    try {
      await addTaskWithArgs(newTitle, newTop, newRepeat);
      setNewTitle("");
      setNewTop(false);
      setNewRepeat("");
      await loadAll();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setAdding(false);
    }
  }

  async function addQuick() {
    if (!userId || !quickTitle.trim()) return;
    setSavingQuick(true);
    try {
      await addTaskWithArgs(quickTitle, quickTop, "");
      setQuickTitle("");
      setQuickTop(false);
      await loadAll();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSavingQuick(false);
    }
  }

  const top = tasks.filter((t) => (t.priority ?? 0) >= 2);
  const rest = tasks.filter((t) => (t.priority ?? 0) < 2);
  const overdueCount = tasks.filter(isOverdue).length;

  function Section({
    title,
    children,
    right
  }: {
    title: string;
    children: ReactNode;
    right?: ReactNode;
  }) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
            gap: 8,
            flexWrap: "wrap"
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
            {right}
            <button onClick={loadAll} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {children}
      </div>
    );
  }

  function todayString() {
    return todayISO();
  }

  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  /* =========================
     Edit modal helpers
     ========================= */
  function openEdit(t: Task) {
    setEditing(t);
    setEditTitle(t.title || "");
    setEditTop((t.priority ?? 0) >= 2);
    setEditDue(t.due_date);
    setEditRepeat(getRepeatFromSource(t.source));
    setApplyFuture(false);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editing || !userId) return;
    setBusyEdit(true);
    setErr(null);

    const originalRepeat = getRepeatFromSource(editing.source);
    const originalSeriesKey = editing.source?.startsWith(REPEAT_PREFIX) ? editing.source : null;
    const newSeriesKey = editRepeat ? makeSeriesKey(editRepeat) : "manual";
    const title = editTitle.trim();
    const top = editTop ? 2 : 0;
    const due = editDue || editing.due_date || dateISO;

    try {
      // 1) Update this task
      {
        const { error } = await supabase
          .from("tasks")
          .update({ title, priority: top, due_date: due, source: newSeriesKey })
          .eq("id", editing.id);
        if (error) throw error;
      }

      // 2) If applyFuture for a series: update future rows' title/priority
      if (applyFuture && originalSeriesKey) {
        const { error } = await supabase
          .from("tasks")
          .update({ title, priority: top })
          .eq("user_id", userId)
          .eq("source", originalSeriesKey)
          .gte("due_date", (editing.due_date || due) as string);
        if (error) throw error;
      }

      // 3) Handle repeat changes (delete old future; insert new future)
      if (originalSeriesKey && editRepeat !== originalRepeat) {
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("user_id", userId)
          .eq("source", originalSeriesKey)
          .gte("due_date", (editing.due_date || due) as string)
          .neq("id", editing.id);
        if (error) throw error;
      }

      if (editRepeat && editRepeat !== originalRepeat) {
        const occurrences = generateOccurrences(due as string, editRepeat).slice(1); // future only
        if (occurrences.length) {
          const rows = occurrences.map((iso) => ({
            user_id: userId,
            title,
            due_date: iso,
            status: "pending",
            priority: top,
            source: makeSeriesKey(editRepeat)
          }));
          const { error } = await supabase.from("tasks").insert(rows as any);
          if (error) throw error;
        }
      }

      setEditOpen(false);
      setEditing(null);
      await loadAll();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusyEdit(false);
    }
  }

  async function deleteTask(scope: "one" | "future" | "all") {
    if (!editing || !userId) return;
    setBusyEdit(true);
    setErr(null);
    try {
      const originalSeriesKey = editing.source?.startsWith(REPEAT_PREFIX) ? editing.source : null;

      if (scope === "one") {
        const { error } = await supabase.from("tasks").delete().eq("id", editing.id);
        if (error) throw error;
      } else if (scope === "future" && originalSeriesKey) {
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("user_id", userId)
          .eq("source", originalSeriesKey)
          .gte("due_date", editing.due_date || dateISO);
        if (error) throw error;
      } else if (scope === "all" && originalSeriesKey) {
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("user_id", userId)
          .eq("source", originalSeriesKey);
        if (error) throw error;
      } else {
        // fallback to single delete if no series
        const { error } = await supabase.from("tasks").delete().eq("id", editing.id);
        if (error) throw error;
      }

      setEditOpen(false);
      setEditing(null);
      await loadAll();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusyEdit(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* ===== Sticky NOW widget ===== */}
      <div
        className="card"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "grid",
          gap: 8,
          border: "1px solid var(--border)",
          background: "#fff"
        }}
      >
        {/* Row 1: Clock + date */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "baseline",
            justifyContent: "space-between",
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>{timeStr}</div>
            <div className="muted">{dateISO}</div>
          </div>

          {/* Summary badges (stay right on wide screens, wrap on small) */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span
              className="badge"
              title="Win if 1+ top priority done or 3+ tasks done"
              style={{
                background: summary.isWin ? "#dcfce7" : "#fee2e2",
                border: "1px solid var(--border)"
              }}
            >
              {summary.isWin ? "Win" : "Keep going"}
            </span>
            <span className="badge" title="Tasks done today">
              Done: {summary.doneToday}
            </span>
            {summary.topTotal > 0 && (
              <span className="badge" title="Top priorities done / total">
                Top: {summary.topDone}/{summary.topTotal}
              </span>
            )}
            <span className="badge" title="Current streak (best)">
              🔥 {summary.streak} {summary.bestStreak > 0 ? `(best ${summary.bestStreak})` : ""}
            </span>
          </div>
        </div>

        {/* Row 1.5: Greeting on its own line (mobile-friendly) */}
        {greetName && (
          <div style={{ fontWeight: 600 }}>
            Welcome back, {greetName}
          </div>
        )}

        {/* Row 2: Quick capture */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && quickTitle.trim() && !savingQuick) addQuick();
            }}
            placeholder="Quick add a task for today…"
            style={{ flex: "1 1 220px", minWidth: 0 }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={quickTop}
              onChange={(e) => setQuickTop(e.target.checked)}
            />
            Top
          </label>
          <button
            className="btn-primary"
            onClick={addQuick}
            disabled={!quickTitle.trim() || savingQuick}
            style={{ borderRadius: 8 }}
          >
            {savingQuick ? "Adding…" : "Add"}
          </button>
        </div>

        {/* Row 3: date controls + overdue mover */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {overdueCount > 0 && (
            <button
              onClick={moveAllOverdueHere}
              className="btn-soft"
              title="Change due date for all overdue pending tasks to this day"
            >
              Move all overdue here ({overdueCount})
            </button>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
            <input
              type="date"
              value={dateISO}
              onChange={(e) => setDateISO(e.target.value)}
            />
            <button onClick={() => setDateISO(todayString())}>Today</button>
          </div>
        </div>
        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* ===== Lists ===== */}
      <Section title="Top Priorities">
        {top.length === 0 ? (
          <div className="muted">Nothing marked top priority for this day.</div>
        ) : (
          <ul className="list">
            {top.map((t) => {
              const overdue = isOverdue(t);
              return (
                <li key={t.id} className="item">
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={t.status === "done"}
                      onChange={() => toggleDone(t)}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap"
                        }}
                      >
                        <span>{displayTitle(t)}</span>
                        {overdue && <span className="badge">Overdue</span>}
                        <button
                          className="btn-ghost"
                          style={{ marginLeft: "auto" }}
                          onClick={() => openEdit(t)}
                          title="Edit task"
                        >
                          Edit
                        </button>
                      </div>
                      {overdue && (
                        <div className="muted" style={{ marginTop: 4 }}>
                          Due {t.due_date} ·{" "}
                          <button
                            className="btn-ghost"
                            onClick={() => moveToSelectedDate(t.id)}
                          >
                            Move to {dateISO}
                          </button>
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
            {rest.map((t) => {
              const overdue = isOverdue(t);
              return (
                <li key={t.id} className="item">
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={t.status === "done"}
                      onChange={() => toggleDone(t)}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap"
                        }}
                      >
                        <span>{displayTitle(t)}</span>
                        {overdue && <span className="badge">Overdue</span>}
                        <button
                          className="btn-ghost"
                          style={{ marginLeft: "auto" }}
                          onClick={() => openEdit(t)}
                          title="Edit task"
                        >
                          Edit
                        </button>
                      </div>
                      {overdue && (
                        <div className="muted" style={{ marginTop: 4 }}>
                          Due {t.due_date} ·{" "}
                          <button
                            className="btn-ghost"
                            onClick={() => moveToSelectedDate(t.id)}
                          >
                            Move to {dateISO}
                          </button>
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

      {/* ===== Add Task (advanced) ===== */}
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Add Task</h2>
        <label style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Task title</div>
          <input
            type="text"
            placeholder="Enter task…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTitle.trim() && !adding) addTask();
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={newTop}
              onChange={(e) => setNewTop(e.target.checked)}
            />
            Mark as Top Priority
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="muted">Repeat</span>
            <select
              value={newRepeat}
              onChange={(e) => setNewRepeat(e.target.value as Repeat)}
              title="Repeat (optional)"
            >
              <option value="">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Daily (Mon–Fri)</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>
          </label>

          <div className="muted">
            Will be created for {dateISO}
            {newRepeat ? " + future repeats" : ""}
          </div>

          <button
            onClick={addTask}
            disabled={!newTitle.trim() || adding}
            className="btn-primary"
            style={{ marginLeft: "auto", borderRadius: 8 }}
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* ===== Edit Modal ===== */}
      {editOpen && editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit task"
          onClick={() => !busyEdit && setEditOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 2000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "min(720px, 96vw)", borderRadius: 12, padding: 16, background: "#fff" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Edit task</h3>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {getRepeatFromSource(editing.source) ? "Recurring" : "Single"}
              </span>
              <button onClick={() => setEditOpen(false)} disabled={busyEdit} title="Close">✕</button>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <div className="section-title">Title</div>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Enter task…"
                />
              </label>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editTop}
                    onChange={(e) => setEditTop(e.target.checked)}
                  />
                  Mark as Top Priority
                </label>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Due
                  <input
                    type="date"
                    value={editDue || ""}
                    onChange={(e) => setEditDue(e.target.value || null)}
                  />
                </label>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Repeat
                  <select
                    value={editRepeat}
                    onChange={(e) => setEditRepeat(e.target.value as Repeat)}
                    title={getRepeatFromSource(editing.source) ? "Change frequency" : "Make this a repeating task"}
                  >
                    <option value="">No repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Daily (Mon–Fri)</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="annually">Annually</option>
                  </select>
                </label>
              </div>

              {getRepeatFromSource(editing.source) && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={applyFuture}
                    onChange={(e) => setApplyFuture(e.target.checked)}
                  />
                  Apply title/priority changes to all <b>future</b> items in this series
                </label>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
                <button
                  onClick={() => deleteTask("one")}
                  disabled={busyEdit}
                  title="Delete just this task"
                >
                  Delete this
                </button>

                {getRepeatFromSource(editing.source) && (
                  <>
                    <button
                      onClick={() => deleteTask("future")}
                      disabled={busyEdit}
                      title="Delete this and all future in series"
                    >
                      Delete future in series
                    </button>
                    <button
                      onClick={() => deleteTask("all")}
                      disabled={busyEdit}
                      title="Delete entire series"
                    >
                      Delete entire series
                    </button>
                  </>
                )}

                <button
                  className="btn-primary"
                  onClick={saveEdit}
                  disabled={busyEdit || !editTitle.trim()}
                  style={{ borderRadius: 8 }}
                  title={getRepeatFromSource(editing.source) !== editRepeat ? "Saves and updates series from the selected due date" : "Save"}
                >
                  {busyEdit ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
