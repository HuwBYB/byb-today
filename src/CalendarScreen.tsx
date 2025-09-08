// src/CalendarScreen.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ===================== Types ===================== */
type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null; // YYYY-MM-DD
  priority: number | null;
  category: string | null;
  category_color: string | null;
  completed_at: string | null;
  source: string | null;

  // time-based fields (existing in your DB)
  all_day?: boolean | null;
  due_time?: string | null;                // "HH:MM:SS"
  due_at?: string | null;                  // ISO timestamp (timestamptz)
  duration_min?: number | null;
  remind_before_min?: number[] | null;     // array<int> or null
  remind_at?: string | null;
  tz?: string | null;
};

type ViewMode = "month" | "week";

/* ---------- Categories + colours (shared with Goals) ---------- */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" },
  { key: "health",    label: "Health",    color: "#22c55e" },
  { key: "career",    label: "Business",  color: "#3b82f6" },   // stored as 'career'
  { key: "financial", label: "Finance",   color: "#f59e0b" },   // stored as 'financial'
  { key: "other",     label: "Other",     color: "#6b7280" },
] as const;
type CatKey = typeof CATS[number]["key"];
const colorOf = (k: CatKey | null | undefined) =>
  CATS.find(c => c.key === k)?.color || "#6b7280";

const CAT_ORDER: Record<string, number> = {
  personal: 0,
  health: 1,
  career: 2,
  financial: 3,
  other: 4,
};

/* ========================== MAIN SCREEN ========================== */

type RepeatFreq = "" | "daily" | "weekly" | "monthly" | "annually";

/** Default counts (when no "until" or "for N") */
const REPEAT_COUNTS: Record<Exclude<RepeatFreq, "">, number> = {
  daily: 14,     // 2 weeks
  weekly: 12,    // 12 weeks
  monthly: 12,   // 12 months
  annually: 5,   // 5 years
};

type SortMode = "time" | "category";

export default function CalendarScreen({
  onSelectDate,
  navigateOnSelect = false,
}: {
  onSelectDate?: (iso: string) => void;
  navigateOnSelect?: boolean;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const today = new Date();
  const todayISO = toISO(today);

  // calendar cursor points at first of month
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedISO, setSelectedISO] = useState<string>(todayISO);
  const [viewMode, setViewMode] = useState<ViewMode>("month");

  const [sortMode, setSortMode] = useState<SortMode>("time");

  const monthLabel = useMemo(
    () => cursor.toLocaleString(undefined, { month: "long", year: "numeric" }),
    [cursor]
  );

  const firstDayOfMonth = useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    [cursor]
  );
  const lastDayOfMonth = useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
    [cursor]
  );

  const startGrid = useMemo(() => {
    const d = new Date(firstDayOfMonth);
    const dow = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
    d.setDate(d.getDate() - dow);
    return d;
  }, [firstDayOfMonth]);

  const endGrid = useMemo(() => {
    const d = new Date(lastDayOfMonth);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() + (6 - dow));
    return d;
  }, [lastDayOfMonth]);

  const gridDays = useMemo(() => {
    const out: string[] = [];
    const d = new Date(startGrid);
    while (d <= endGrid) {
      out.push(toISO(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [startGrid, endGrid]);

  // Week view range based on selectedISO (Mon..Sun)
  const weekStartISO = useMemo(() => startOfWeekISO(fromISO(selectedISO)), [selectedISO]);
  const weekDays = useMemo(() => {
    const base = fromISO(weekStartISO);
    return Array.from({ length: 7 }, (_, i) => toISO(addDays(base, i)));
  }, [weekStartISO]);

  const [tasksByDay, setTasksByDay] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // add-task (structured)
  const [newTitle, setNewTitle] = useState("");
  const [newCat, setNewCat] = useState<CatKey>("other");
  const [newPriority, setNewPriority] = useState<number>(2);
  const [newFreq, setNewFreq] = useState<RepeatFreq>("");
  const [adding, setAdding] = useState(false);

  // time-based options
  const [timed, setTimed] = useState(false);          // all-day by default
  const [timeStr, setTimeStr] = useState("09:00");    // "HH:MM"
  const [durationMin, setDurationMin] = useState<number>(60);
  const [remindBefore, setRemindBefore] = useState<number | "">(""); // minutes before ("" = none)
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  // natural-language quick add
  const [nlp, setNlp] = useState("");
  const [addingNlp, setAddingNlp] = useState(false);

  // Ask for Notification permission once
  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Month/year selectors
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({
      value: i,
      label: new Date(2000, i, 1).toLocaleString(undefined, { month: "long" })
    })), []
  );
  const years = useMemo(() => {
    const y = today.getFullYear();
    const span = 10; // 10 years back/forward
    return Array.from({ length: span * 2 + 1 }, (_, i) => y - span + i);
  }, [today]);

  // auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // load month tasks
  useEffect(() => {
    if (!userId) return;
    loadMonthTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, firstDayOfMonth.getTime(), lastDayOfMonth.getTime()]);

  async function loadMonthTasks() {
    if (!userId) return;
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select(`
  id,user_id,title,due_date,
  all_day,due_time,due_at,duration_min,remind_before_min,remind_at,tz,
  priority,category,category_color,completed_at,source
`)
        .eq("user_id", userId)
        .gte("due_date", toISO(firstDayOfMonth))
        .lte("due_date", toISO(lastDayOfMonth))
        .order("due_date", { ascending: true })
        .order("priority", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      const map: Record<string, Task[]> = {};
      for (const t of (data as Task[])) {
        const day = (t.due_date || "").slice(0, 10);
        if (!day) continue;
        (map[day] ||= []).push(t);
      }
      setTasksByDay(map);
    } catch (e: any) {
      setErr(e.message || String(e));
      setTasksByDay({});
    } finally {
      setLoading(false);
    }
  }

  /* ===== Navigation helpers ===== */
  function prevMonth() {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() - 1);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  function nextMonth() {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + 1);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  function prevYear() {
    setCursor(new Date(cursor.getFullYear() - 1, cursor.getMonth(), 1));
  }
  function nextYear() {
    setCursor(new Date(cursor.getFullYear() + 1, cursor.getMonth(), 1));
  }
  function goToday() {
    const d = new Date();
    const iso = toISO(d);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedISO(iso);
    if (navigateOnSelect && onSelectDate) onSelectDate(iso);
  }
  function prevWeek() {
    const newSel = toISO(addDays(fromISO(selectedISO), -7));
    setSelectedISO(newSel);
    if (navigateOnSelect && onSelectDate) onSelectDate(newSel);
    const d = fromISO(newSel);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  function nextWeek() {
    const newSel = toISO(addDays(fromISO(selectedISO), 7));
    setSelectedISO(newSel);
    if (navigateOnSelect && onSelectDate) onSelectDate(newSel);
    const d = fromISO(newSel);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function isSameMonth(iso: string) {
    const d = fromISO(iso);
    return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
  }

  function addInterval(baseISO: string, step: Exclude<RepeatFreq, "">, i: number) {
    const d = fromISO(baseISO);
    if (step === "daily") d.setDate(d.getDate() + i);
    else if (step === "weekly") d.setDate(d.getDate() + 7 * i);
    else if (step === "monthly") d.setMonth(d.getMonth() + i);
    else if (step === "annually") d.setFullYear(d.getFullYear() + i);
    return toISO(d);
  }

  /* ===== Structured add ===== */
  async function addTaskToSelected() {
    if (!userId) return;
    const title = newTitle.trim();
    if (!title) return;

    setAdding(true); setErr(null);
    try {
      const category = newCat;
      const category_color = colorOf(category);

      let rows: Array<Partial<Task> & { user_id: string }> = [];

      const buildRow = (iso: string) => {
        if (timed) {
          const dt = combineLocalDateTimeISO(iso, timeStr);
          return {
            user_id: userId,
            title,
            due_date: iso,
            all_day: false,
            due_time: `${timeStr}:00`,
            due_at: dt.toISOString(),
            duration_min: durationMin,
            tz: userTz,
            remind_before_min: remindBefore === "" ? null : [Number(remindBefore)],
            priority: newPriority,
            category,
            category_color,
            source: newFreq ? `calendar_repeat_${newFreq}` : "calendar_manual",
          };
        }
        // all-day
        return {
          user_id: userId,
          title,
          due_date: iso,
          all_day: true,
          due_time: null,
          due_at: null,
          duration_min: null,
          tz: userTz,
          remind_before_min: null,
          priority: newPriority,
          category,
          category_color,
          source: newFreq ? `calendar_repeat_${newFreq}` : "calendar_manual",
        };
      };

      if (!newFreq) {
        rows = [buildRow(selectedISO)];
      } else {
        const count = REPEAT_COUNTS[newFreq];
        rows = Array.from({ length: count }, (_, i) => buildRow(addInterval(selectedISO, newFreq, i)));
      }

      const { data, error } = await supabase.from("tasks").insert(rows as any).select();
      if (error) throw error;

      // Update local month cache
      const first = toISO(firstDayOfMonth), last = toISO(lastDayOfMonth);
      setTasksByDay(prev => {
        const map = { ...prev };
        for (const t of data as Task[]) {
          const day = (t.due_date || "").slice(0, 10);
          if (!day) continue;
          if (day >= first && day <= last) {
            (map[day] ||= []).push(t);
          }
        }
        return map;
      });

      setNewTitle("");
      setNewFreq("");
      // Optional UX reset:
      // setTimed(false); setTimeStr("09:00"); setDurationMin(60); setRemindBefore("");
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setAdding(false);
    }
  }

  /* ================= Natural-language add ================= */
  async function addNlp() {
    if (!userId) return;
    const raw = nlp.trim();
    if (!raw) return;

    setAddingNlp(true);
    setErr(null);
    try {
      const parsed = parseNlp(raw, selectedISO);
      if (!parsed.title) throw new Error("Please include a title.");
      const category = parsed.category ?? "other";
      const category_color = colorOf(category);

      let rows: Array<Partial<Task> & { user_id: string }> = [];

      if (parsed.occurrences && parsed.occurrences.length > 0) {
        rows = parsed.occurrences.map(iso => ({
          user_id: userId,
          title: parsed.title,
          due_date: iso,
          all_day: true, // NLP quick-add remains all-day for now
          priority: parsed.priority ?? 2,
          category,
          category_color,
          source: parsed.source || "calendar_nlp",
        }));
      } else {
        rows = [{
          user_id: userId,
          title: parsed.title,
          due_date: selectedISO,
          all_day: true,
          priority: parsed.priority ?? 2,
          category,
          category_color,
          source: parsed.source || "calendar_nlp",
        }];
      }

      const { data, error } = await supabase.from("tasks").insert(rows as any).select();
      if (error) throw error;

      // update month cache
      const first = toISO(firstDayOfMonth), last = toISO(lastDayOfMonth);
      setTasksByDay(prev => {
        const map = { ...prev };
        for (const t of data as Task[]) {
          const day = (t.due_date || "").slice(0, 10);
          if (day && day >= first && day <= last) {
            (map[day] ||= []).push(t);
          }
        }
        return map;
      });

      setNlp("");
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setAddingNlp(false);
    }
  }

  const dayTasks = tasksByDay[selectedISO] || [];

  /* ================= Sorting ================= */
  const sortedDayTasks = useMemo(() => {
    const list = [...dayTasks];

    const cmpTime = (a: Task, b: Task) => {
      const aAll = !!a.all_day || !a.due_time;
      const bAll = !!b.all_day || !b.due_time;
      if (aAll && !bAll) return -1;           // all-day first
      if (!aAll && bAll) return 1;
      if (aAll && bAll) {
        const ca = CAT_ORDER[a.category || "zz"] ?? 99;
        const cb = CAT_ORDER[b.category || "zz"] ?? 99;
        if (ca !== cb) return ca - cb;
        return (a.title || "").localeCompare(b.title || "");
      }
      const ta = a.due_time || "";
      const tb = b.due_time || "";
      if (ta !== tb) return ta.localeCompare(tb);
      const pa = a.priority ?? 2;
      const pb = b.priority ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.title || "").localeCompare(b.title || "");
    };

    const cmpCategory = (a: Task, b: Task) => {
      const ca = CAT_ORDER[a.category || "zz"] ?? 99;
      const cb = CAT_ORDER[b.category || "zz"] ?? 99;
      if (ca !== cb) return ca - cb;
      return cmpTime(a, b); // within category, keep all-day first then time
    };

    list.sort(sortMode === "time" ? cmpTime : cmpCategory);
    return list;
  }, [dayTasks, sortMode]);

  /* ================= In-app reminders (local) ================= */
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!("Notification" in window)) return;

    const tick = async () => {
      if (Notification.permission !== "granted") return;
      const reg = await navigator.serviceWorker?.ready.catch(() => null);
      const now = Date.now();
      const all: Task[] = Object.values(tasksByDay).flat();

      for (const t of all) {
        if (!t.due_at || !t.remind_before_min || t.remind_before_min.length === 0) continue;

        for (const m of t.remind_before_min) {
          const key = `${t.id}:${m}`;
          if (notifiedRef.current.has(key)) continue;

          const trigger = new Date(t.due_at).getTime() - m * 60_000;
          if (now >= trigger && now <= trigger + 60_000) {
            const title = "Reminder";
            const body = t.all_day ? t.title : `${(t.due_time || "").slice(0,5)} — ${t.title}`;

            if (reg?.showNotification) {
              reg.showNotification(title, {
                body,
                tag: key,
                icon: "/icons/app-icon-192.png",
                badge: "/icons/app-icon-192.png",
              });
            } else {
              new Notification(title, { body, tag: key });
            }
            notifiedRef.current.add(key);
          }
        }
      }
    };

    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [tasksByDay]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Title card with controls */}
      <div className="card" style={{ position: "relative", display: "grid", gap: 10 }}>
        <h1 style={{ margin: 0 }}>Calendar</h1>

        {/* Row: Left controls + View toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", flexWrap: "wrap" }}>
            <button onClick={goToday} title="Go to today" aria-label="Go to today"
              style={{ minWidth: 64, height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontWeight: 700 }}>
              Today
            </button>

            {/* Month + Year dropdowns */}
            <select
              value={cursor.getMonth()}
              onChange={(e) => setCursor(new Date(cursor.getFullYear(), Number(e.target.value), 1))}
              title="Month"
            >
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select
              value={cursor.getFullYear()}
              onChange={(e) => setCursor(new Date(Number(e.target.value), cursor.getMonth(), 1))}
              title="Year"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <strong style={{ marginLeft: 6 }}>{monthLabel}</strong>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="btn-group" role="group" aria-label="View mode">
              <button onClick={() => setViewMode("month")} className={viewMode === "month" ? "btn-primary" : ""} style={{ borderRadius: 8 }}>
                Month
              </button>
              <button onClick={() => setViewMode("week")} className={viewMode === "week" ? "btn-primary" : ""} style={{ borderRadius: 8 }}>
                Week
              </button>
            </div>
          </div>
        </div>

        {/* Navigation arrows */}
        {viewMode === "month" ? (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="muted" style={{ minWidth: 50 }}>Month</span>
              <button onClick={prevMonth} aria-label="Previous month">←</button>
              <button onClick={nextMonth} aria-label="Next month">→</button>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="muted" style={{ minWidth: 50 }}>Year</span>
              <button onClick={prevYear} aria-label="Previous year">←</button>
              <button onClick={nextYear} aria-label="Next year">→</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="muted" style={{ minWidth: 50 }}>Week</span>
              <button onClick={prevWeek} aria-label="Previous week">←</button>
              <button onClick={nextWeek} aria-label="Next week">→</button>
              <span className="muted">({weekDays[0]} → {weekDays[6]})</span>
            </div>
          </div>
        )}
      </div>

      {/* Weekday header (Mon..Sun) */}
      <div className="card" style={{ padding: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, fontSize: 12, color: "#64748b" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} style={{ textAlign: "center" }}>{d}</div>
          ))}
        </div>
      </div>

      {/* Month or Week grid */}
      <div className="card" style={{ padding: 8 }}>
        {viewMode === "month" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {gridDays.map((iso) => {
              const inMonth = isSameMonth(iso);
              const list = tasksByDay[iso] || [];
              const count = list.length;
              const isSelected = iso === selectedISO;
              const d = fromISO(iso);
              const dayNum = d.getDate();

              return (
                <button
                  key={iso}
                  onClick={() => {
                    setSelectedISO(iso);
                    if (!inMonth) setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                    if (navigateOnSelect && onSelectDate) onSelectDate(iso);
                  }}
                  className="cal-day"
                  title={`${iso}${count ? ` • ${count} task(s)` : ""}`}
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: isSelected ? "#eef2ff" : "#fff",
                    opacity: inMonth ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{dayNum}</div>
                    {count > 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "#f1f5f9",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {weekDays.map((iso) => {
              const list = tasksByDay[iso] || [];
              const isSelected = iso === selectedISO;
              const d = fromISO(iso);
              const dayNum = d.getDate();
              return (
                <button
                  key={iso}
                  onClick={() => {
                    setSelectedISO(iso);
                    if (navigateOnSelect && onSelectDate) onSelectDate(iso);
                    const dd = fromISO(iso);
                    setCursor(new Date(dd.getFullYear(), dd.getMonth(), 1));
                  }}
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: isSelected ? "#eef2ff" : "#fff",
                  }}
                  title={`${iso}${list.length ? ` • ${list.length} task(s)` : ""}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{dayNum}</div>
                    {list.length > 0 && (
                      <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999, background: "#f1f5f9", border: "1px solid var(--border)" }}>
                        {list.length}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Day detail + NLP add + structured add */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{selectedISO}</h2>
            <span className="muted">
              {loading ? "Loading…" : `${(tasksByDay[selectedISO] || []).length} task${(tasksByDay[selectedISO] || []).length === 1 ? "" : "s"}`}
            </span>
          </div>

          {/* Sort by */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="muted" htmlFor="sortby">Sort by</label>
            <select
              id="sortby"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              title="Sort tasks"
            >
              <option value="time">Time due</option>
              <option value="category">Category</option>
            </select>
          </div>

          {/* Natural-language quick add */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flex: "1 1 320px" }}>
            <input
              value={nlp}
              onChange={e => setNlp(e.target.value)}
              placeholder='Quick add (e.g., "Dentist next Tue #health every month !high")'
              style={{ minWidth: 220, flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter" && nlp.trim() && !addingNlp) addNlp(); }}
            />
            <button className="btn-primary" onClick={addNlp} disabled={!nlp.trim() || addingNlp} style={{ borderRadius: 8 }}>
              {addingNlp ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {/* Structured add */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Add a task…"
            style={{ minWidth: 200 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTitle.trim() && !adding) addTaskToSelected();
            }}
          />
          <select value={newCat} onChange={e => setNewCat(e.target.value as CatKey)} title="Category">
            {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select value={newPriority} onChange={e => setNewPriority(Number(e.target.value))} title="Priority">
            <option value={1}>High</option>
            <option value={2}>Normal</option>
            <option value={3}>Low</option>
          </select>
          <select value={newFreq} onChange={e => setNewFreq(e.target.value as RepeatFreq)} title="Repeat (optional)">
            <option value="">No repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="annually">Annually</option>
          </select>

          {/* Timed options */}
          <label title="Timed event?">
            <input
              type="checkbox"
              checked={timed}
              onChange={(e) => setTimed(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Timed
          </label>

          {timed && (
            <>
              <DigitalTimePicker value={timeStr} onChange={setTimeStr} minuteStep={5} />
              <input
                type="number"
                min={5}
                step={5}
                value={durationMin}
                onChange={(e) => setDurationMin(Math.max(5, Number(e.target.value) || 60))}
                title="Duration (min)"
                style={{ width: 110 }}
                placeholder="min"
              />
              <select
                value={remindBefore === "" ? "" : String(remindBefore)}
                onChange={(e) =>
                  setRemindBefore(e.target.value === "" ? "" : Number(e.target.value))
                }
                title="Reminder"
              >
                <option value="">No reminder</option>
                <option value="0">At time</option>
                <option value="1">1 min before</option>
                <option value="5">5 min before</option>
                <option value="10">10 min before</option>
                <option value="15">15 min before</option>
                <option value="30">30 min before</option>
                <option value="60">1 hour before</option>
              </select>
            </>
          )}

          <button className="btn-primary" onClick={addTaskToSelected} disabled={!newTitle.trim() || adding} style={{ borderRadius: 8 }}>
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {sortedDayTasks.length === 0 && !loading && <div className="muted">Nothing scheduled.</div>}
        <ul className="list">
          {sortedDayTasks.map((t) => (
            <li key={t.id} className="item">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%" }}>
                <span
                  title={t.category || ""}
                  style={{
                    display: "inline-block",
                    flex: "0 0 auto",
                    width: 10,
                    height: 10,
                    marginTop: 6,
                    borderRadius: 999,
                    background: t.category_color || "#e5e7eb",
                    border: "1px solid #d1d5db",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ textDecoration: t.completed_at ? "line-through" : "none" }}>
                    {t.all_day
                      ? t.title
                      : `${(t.due_time || "").slice(0,5)} — ${t.title}`}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Category: {t.category || "—"} · Priority: {priorityLabel(t.priority)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>
    </div>
  );
}

/* ===================== Digital time picker (hours + minutes) ===================== */
function DigitalTimePicker({
  value,
  onChange,
  minuteStep = 5,
}: {
  value: string;              // "HH:MM"
  onChange: (v: string) => void;
  minuteStep?: number;
}) {
  const [h, m] = value.split(":").map(n => Number(n) || 0);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) => i * minuteStep);

  const update = (hh: number, mm: number) => {
    const v = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    onChange(v);
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "#fff",
      }}
      aria-label="Time picker"
      role="group"
    >
      <select
        aria-label="Hours"
        value={h}
        onChange={(e) => update(Number(e.target.value), m)}
        style={{ fontSize: 16, padding: "6px 8px", height: 40 }}
      >
        {hours.map(hr => (
          <option key={hr} value={hr}>{String(hr).padStart(2, "0")}</option>
        ))}
      </select>
      <span style={{ fontWeight: 700, lineHeight: "40px" }}>:</span>
      <select
        aria-label="Minutes"
        value={m - (m % minuteStep)}
        onChange={(e) => update(h, Number(e.target.value))}
        style={{ fontSize: 16, padding: "6px 8px", height: 40 }}
      >
        {minutes.map(mm => (
          <option key={mm} value={mm}>{String(mm).padStart(2, "0")}</option>
        ))}
      </select>
    </div>
  );
}

/* ===================== helpers ===================== */
function combineLocalDateTimeISO(dateISO: string, hhmm: string) {
  return new Date(`${dateISO}T${hhmm}:00`);
}

/* ===================== NLP Parser ===================== */
function parseNlp(raw: string, baseISO: string): {
  title: string;
  occurrences: string[];
  category?: CatKey;
  priority?: number;
  source?: string;
} {
  let s = " " + raw.trim() + " ";
  const occurrences: string[] = [];
  let category: CatKey | undefined = undefined;
  let priority: number | undefined = undefined;

  const catMatch = s.match(/#(personal|health|career|financial|other)\b/i);
  if (catMatch) {
    category = catMatch[1].toLowerCase() as CatKey;
    s = s.replace(catMatch[0], " ");
  }

  const priMatch = s.match(/!(high|normal|low|top)\b/i);
  if (priMatch) {
    const key = priMatch[1].toLowerCase();
    priority = key === "high" || key === "top" ? 1 : key === "normal" ? 2 : 3;
    s = s.replace(priMatch[0], " ");
  }

  let anchorISO: string | null = findExplicitDateISO(s, baseISO);
  if (anchorISO) {
    s = removeDateSubstr(s);
  }

  const rel = s.match(/\b(today|tomorrow|next week|next\s+(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun))\b/i);
  if (rel && !anchorISO) {
    anchorISO = relativeToISO(rel[0].toLowerCase(), baseISO);
    if (anchorISO) s = s.replace(rel[0], " ");
  }

  const inMatch = s.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
  if (inMatch && !anchorISO) {
    const n = Number(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    let d = fromISO(baseISO);
    if (unit.startsWith("day")) d = addDays(d, n);
    else if (unit.startsWith("week")) d = addDays(d, 7 * n);
    else if (unit.startsWith("month")) { d = new Date(d.getFullYear(), d.getMonth() + n, d.getDate()); }
    anchorISO = toISO(d);
    s = s.replace(inMatch[0], " ");
  }

  const everyMatch = s.match(/\bevery\b([\s\S]*)$/i);
  let rule:
    | { type: "weekday-list"; days?: number[]; until?: string | null; count?: number | null }
    | { type: "interval"; interval?: number; freq?: "daily"|"weekly"|"monthly"|"annually"; until?: string | null; count?: number | null }
    | { type: "freq"; freq?: "daily"|"weekly"|"monthly"|"annually"; until?: string | null; count?: number | null }
    | null = null;

  if (everyMatch) {
    const tail = everyMatch[1].trim();
    const until = (tail.match(/\buntil\s+([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\/\-][0-9]{1,2}(?:[\/\-][0-9]{2,4})?|[0-9]{1,2}\s+[A-Za-z]{3,})/i));
    const untilISO = until ? normalizeAnyDateToISO(until[1], baseISO) : null;

    const countMatch = tail.match(/\bfor\s+(\d+)\s+(time|times)\b/i);
    const count = countMatch ? Number(countMatch[1]) : null;

    const wd = parseWeekdayList(tail);
    if (wd && wd.length) {
      rule = { type: "weekday-list", days: wd, until: untilISO, count };
    } else {
      const intMatch = tail.match(/\bevery\s+(\d+)\s+(week|weeks|month|months|day|days|year|years)\b/i);
      if (intMatch) {
        const n = Number(intMatch[1]);
        const unit = intMatch[2].toLowerCase();
        const freq = unit.startsWith("day") ? "daily" : unit.startsWith("week") ? "weekly" : unit.startsWith("month") ? "monthly" : "annually";
        rule = { type: "interval", interval: n, freq, until: untilISO, count };
      } else {
        const fMatch = tail.match(/\bevery\s+(day|daily|week|weekly|month|monthly|year|yearly|annually)\b/i);
        if (fMatch) {
          const token = fMatch[1].toLowerCase();
          const freq: "daily"|"weekly"|"monthly"|"annually" =
            token.startsWith("day") ? "daily" :
            token.startsWith("week") ? "weekly" :
            token.startsWith("month") ? "monthly" : "annually";
          rule = { type: "freq", freq, until: untilISO, count };
        }
      }
    }
    s = s.replace(/\bevery\b([\s\S]*)$/i, " ");
  }

  const title = s.replace(/\s+/g, " ").trim();

  const base = anchorISO || baseISO;
  if (!rule) {
    occurrences.push(base);
  } else {
    const maxCap = 104; // safety
    if ((rule as any).type === "weekday-list") {
      const days = (rule as any).days || [];
      const until = (rule as any).until ? fromISO((rule as any).until) : null;
      let d = fromISO(base);
      let added = 0;
      while (added < ((rule as any).count ?? 24) && added < maxCap) {
        const iso = toISO(d);
        const wd = weekdayIdx(d);
        if (days.includes(wd) && (until ? d <= until : true)) {
          occurrences.push(iso);
          added++;
        }
        d = addDays(d, 1);
        if (!until && added >= ((rule as any).count ?? 24)) break;
        if (until && d > until) break;
      }
    } else if ((rule as any).type === "interval") {
      const interval = Math.max(1, (rule as any).interval || 1);
      const freq = (rule as any).freq!;
      const until = (rule as any).until ? fromISO((rule as any).until) : null;
      const limit = (rule as any).count ?? defaultCountFor(freq);
      let d = fromISO(base);
      for (let i = 0; i < Math.min(limit, maxCap); i++) {
        occurrences.push(toISO(d));
        d = addIntervalN(d, freq, interval);
        if (until && d > until) break;
      }
    } else if ((rule as any).type === "freq") {
      const freq = (rule as any).freq!;
      const until = (rule as any).until ? fromISO((rule as any).until) : null;
      const limit = (rule as any).count ?? defaultCountFor(freq);
      let d = fromISO(base);
      for (let i = 0; i < Math.min(limit, maxCap); i++) {
        occurrences.push(toISO(d));
        d = addIntervalN(d, freq, 1);
        if (until && d > until) break;
      }
    }
  }

  return {
    title,
    occurrences: Array.from(new Set(occurrences)),
    category,
    priority,
    source: "calendar_nlp"
  };
}

function defaultCountFor(freq: "daily"|"weekly"|"monthly"|"annually") {
  return freq === "daily" ? 14 : freq === "weekly" ? 12 : freq === "monthly" ? 12 : 5;
}

function parseWeekdayList(tail: string): number[] | null {
  const map: Record<string, number> = { mon:1, tue:2, tues:2, wed:3, thu:4, thur:4, thurs:4, fri:5, sat:6, sun:7 };
  const m = tail.match(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(\s*,\s*(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun))*\b/ig);
  if (!m) return null;
  const tokens = m[0].split(",").map(s => s.trim().toLowerCase());
  const days = tokens.map(t => map[t]).filter(Boolean);
  return Array.from(new Set(days));
}

function findExplicitDateISO(s: string, baseISO: string): string | null {
  const iso = s.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return clampISO(iso[1]);
  const dm = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dm) {
    const y = dm[3] ? normalizeYear(Number(dm[3])) : fromISO(baseISO).getFullYear();
    const m = Number(dm[2]); const d = Number(dm[1]);
    return toISO(new Date(y, m - 1, d));
  }
  const m1 = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,})\b/);
  const m2 = s.match(/\b([A-Za-z]{3,})\s+(\d{1,2})\b/);
  const y = fromISO(baseISO).getFullYear();
  if (m1) return parseDayMonth(m1[1], m1[2], y);
  if (m2) return parseDayMonth(m2[2], m2[1], y);
  return null;
}
function removeDateSubstr(s: string) {
  return s
    .replace(/\b(20\d{2}-\d{2}-\d{2})\b/, " ")
    .replace(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/, " ")
    .replace(/\b(\d{1,2}\s+[A-Za-z]{3,}|[A-Za-z]{3,}\s+\d{1,2})\b/, " ");
}

function parseDayMonth(dayStr: string, monStr: string, year: number): string {
  const m = monthIndex(monStr);
  const d = Number(dayStr);
  return toISO(new Date(year, m, d));
}
function monthIndex(token: string) {
  const map = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const idx = map.findIndex(x => token.toLowerCase().startsWith(x));
  return idx >= 0 ? idx : 0;
}
function normalizeAnyDateToISO(tok: string, baseISO: string): string | null {
  return findExplicitDateISO(tok, baseISO);
}
function normalizeYear(y: number) {
  if (y < 100) return 2000 + y;
  return y;
}
function relativeToISO(token: string, baseISO: string): string | null {
  const base = fromISO(baseISO);
  const lower = token.toLowerCase();
  if (lower === "today") return baseISO;
  if (lower === "tomorrow") return toISO(addDays(base, 1));
  if (lower === "next week") return toISO(addDays(base, 7));
  const m = lower.match(/next\s+(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)/);
  if (m) {
    const target = mapWeekday(m[1]);
    let d = addDays(base, 1);
    for (let i = 0; i < 14; i++) {
      if (weekdayIdx(d) === target) return toISO(d);
      d = addDays(d, 1);
    }
  }
  return null;
}
function mapWeekday(tok: string): number {
  const m: Record<string, number> = { mon:1, tue:2, tues:2, wed:3, thu:4, thur:4, thurs:4, fri:5, sat:6, sun:7 };
  return m[tok] || 1;
}

/* ===================== date utils ===================== */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeekISO(d: Date) {
  const wd = (d.getDay() + 6) % 7; // Mon=0
  const x = new Date(d);
  x.setDate(x.getDate() - wd);
  return toISO(x);
}
function weekdayIdx(d: Date) { // Mon..Sun = 1..7
  const n = d.getDay(); // Sun=0..Sat=6
  return n === 0 ? 7 : n;
}
function clampISO(iso: string) { return iso.slice(0, 10); }
function addIntervalN(d: Date, freq: "daily"|"weekly"|"monthly"|"annually", n: number) {
  const x = new Date(d);
  if (freq === "daily") x.setDate(x.getDate() + n);
  else if (freq === "weekly") x.setDate(x.getDate() + 7 * n);
  else if (freq === "monthly") x.setMonth(x.getMonth() + n);
  else x.setFullYear(x.getFullYear() + n);
  return x;
}

/* ===================== misc ===================== */
function priorityLabel(p?: number | null) {
  if (p === 1) return "High";
  if (p === 3) return "Low";
  return "Normal";
}
