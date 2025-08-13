import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

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
};

export default function CalendarScreen({
  onSelectDate,
}: {
  onSelectDate?: (iso: string) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const todayISO = toISO(new Date());

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedISO, setSelectedISO] = useState<string>(todayISO);

  const monthLabel = useMemo(() => cursor.toLocaleString(undefined, { month: "long", year: "numeric" }), [cursor]);

  const firstDayOfMonth = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const lastDayOfMonth = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), [cursor]);

  const startGrid = useMemo(() => {
    const d = new Date(firstDayOfMonth);
    // Start on Monday (ISO week). Adjust so Mon=0 … Sun=6.
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d;
  }, [firstDayOfMonth]);
  const endGrid = useMemo(() => {
    const d = new Date(lastDayOfMonth);
    const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
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

  const [tasksByDay, setTasksByDay] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    setErr(null); setLoading(true);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,user_id,title,due_date,priority,category,category_color,completed_at,source")
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
  function goToday() {
    const d = new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedISO(toISO(d));
    if (onSelectDate) onSelectDate(toISO(d));
  }

  function isSameMonth(iso: string) {
    const d = fromISO(iso);
    return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
  }

  const dayTasks = tasksByDay[selectedISO] || [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={goToday}>Today</button>
          <button onClick={prevMonth}>←</button>
          <strong>{monthLabel}</strong>
          <button onClick={nextMonth}>→</button>
        </div>
        {loading ? <div className="muted">Loading…</div> : <div className="muted">{Object.values(tasksByDay).reduce((a, b) => a + b.length, 0)} tasks this month</div>}
      </div>

      {/* Weekday header (Mon..Sun) */}
      <div className="card" style={{ padding: 8 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
            fontSize: 12,
            color: "#64748b",
          }}
        >
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
            <div key={d} style={{ textAlign: "center" }}>{d}</div>
          ))}
        </div>
      </div>

      {/* Month grid */}
      <div className="card" style={{ padding: 8 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
          }}
        >
          {gridDays.map((iso) => {
            const inMonth = isSameMonth(iso);
            const list = (tasksByDay[iso] || []).slice(0); // copy
            // sort by priority asc, then incomplete first
            list.sort((a, b) => {
              const pa = a.priority ?? 9, pb = b.priority ?? 9;
              if (pa !== pb) return pa - pb;
              const ca = a.completed_at ? 1 : 0;
              const cb = b.completed_at ? 1 : 0;
              if (ca !== cb) return ca - cb;
              return (a.id ?? 0) - (b.id ?? 0);
            });

            // mobile-friendly: show up to 2 pills + "+N"
            const maxPills = 2;
            const visible = list.slice(0, maxPills);
            const extra = Math.max(0, list.length - visible.length);

            const isSelected = iso === selectedISO;

            return (
              <button
                key={iso}
                onClick={() => {
                  setSelectedISO(iso);
                  if (onSelectDate) onSelectDate(iso);
                }}
                className="cal-day"
                title={`${iso}${list.length ? ` • ${list.length} task(s)` : ""}`}
                style={{
                  textAlign: "left",
                  padding: 8,
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: isSelected ? "#eef2ff" : "#fff",
                  opacity: inMonth ? 1 : 0.5,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{fromISO(iso).getDate()}</div>
                  {!!list.length && <div className="muted" style={{ fontSize: 11 }}>{list.length}</div>}
                </div>

                {/* task pills */}
                <div style={{ display: "grid", gap: 4 }}>
                  {visible.map(t => (
                    <div key={t.id} className="day-pill" style={{ borderColor: t.category_color || "#e5e7eb" }}>
                      <span className="dot" style={{ background: t.category_color || "#e5e7eb" }} />
                      <span className="txt">{t.title}</span>
                    </div>
                  ))}
                  {extra > 0 && (
                    <div className="day-pill more">
                      <span className="txt">+{extra} more</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day detail list (full titles) */}
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{selectedISO}</h2>
          <span className="muted">{dayTasks.length} task{dayTasks.length === 1 ? "" : "s"}</span>
        </div>
        {dayTasks.length === 0 && <div className="muted">Nothing scheduled.</div>}
        <ul className="list">
          {dayTasks.map(t => (
            <li key={t.id} className="item">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span title={t.category || ""} style={{ width: 10, height: 10, borderRadius: 999, background: t.category_color || "#e5e7eb", border: "1px solid #d1d5db" }} />
                <div style={{ textDecoration: t.completed_at ? "line-through" : "none" }}>{t.title}</div>
              </div>
            </li>
          ))}
        </ul>
        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>
    </div>
  );
}

/* ===== date utils ===== */
function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y,(m??1)-1,d??1);
}
