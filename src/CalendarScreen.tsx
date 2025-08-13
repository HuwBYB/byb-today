import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Props = {
  onSelectDate?: (iso: string) => void;
};

type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null; // 'YYYY-MM-DD'
  due_time: string | null; // 'HH:MM:SS' (optional)
  status: "pending" | "done" | string;
  priority: number | null;
  category_color: string | null;
};

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
function startOfMonthGrid(d: Date) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  // Monday-start weeks
  const wd = (first.getDay() + 6) % 7; // Mon=0..Sun=6
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - wd);
  return gridStart;
}
function endOfMonthGrid(d: Date) {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const wd = (last.getDay() + 6) % 7; // Mon=0..Sun=6
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - wd));
  return gridEnd;
}
function formatTime(t: string | null) {
  if (!t) return ""; // all-day
  // Expect 'HH:MM:SS' (or 'HH:MM')
  const [hhStr, mmStr] = t.split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr || "0");
  const ampm = hh >= 12 ? "pm" : "am";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${ampm}`;
}

export default function CalendarScreen({ onSelectDate }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Date>(new Date()); // month being viewed
  const [byDate, setByDate] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const gridStart = useMemo(() => startOfMonthGrid(cursor), [cursor]);
  const gridEnd = useMemo(() => endOfMonthGrid(cursor), [cursor]);

  async function loadMonth() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,user_id,title,due_date,due_time,status,priority,category_color")
        .eq("user_id", userId)
        .gte("due_date", toISO(gridStart))
        .lte("due_date", toISO(gridEnd))
        .order("due_date", { ascending: true })
        .order("due_time", { ascending: true }); // times first, nulls last automatically
      if (error) throw error;

      const map: Record<string, Task[]> = {};
      for (const t of (data as Task[])) {
        const key = t.due_date || "";
        if (!key) continue;
        (map[key] ||= []).push(t);
      }
      // Optional: sort by priority within same time
      Object.values(map).forEach(list => {
        list.sort((a, b) => {
          // earlier time first; if times equal/empty, higher priority first; then id
          const ta = a.due_time || "99:99:99";
          const tb = b.due_time || "99:99:99";
          if (ta < tb) return -1;
          if (ta > tb) return 1;
          const pa = a.priority ?? 0, pb = b.priority ?? 0;
          if (pa !== pb) return pb - pa;
          return a.id - b.id;
        });
      });

      setByDate(map);
    } catch (e: any) {
      setErr(e.message || String(e));
      setByDate({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (userId) loadMonth(); }, [userId, cursor]);

  function monthLabel(d: Date) {
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }
  function isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  const today = new Date();

  function gotoToday() { setCursor(new Date()); }
  function gotoPrevMonth() {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    setCursor(d);
  }
  function gotoNextMonth() {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    setCursor(d);
  }

  // Build 6 weeks grid
  const days: Date[] = [];
  {
    const d = new Date(gridStart);
    while (d <= gridEnd) {
      days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={gotoPrevMonth}>←</button>
          <div style={{ fontWeight: 600 }}>{monthLabel(cursor)}</div>
          <button onClick={gotoNextMonth}>→</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={gotoToday}>Today</button>
          {loading && <span className="muted">Loading…</span>}
        </div>
      </div>

      <div className="card">
        {/* Weekday headers (Mon..Sun) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
            marginBottom: 6,
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
            <div key={w} style={{ textAlign: "right", paddingRight: 6 }}>{w}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {days.map((d) => {
            const iso = toISO(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const tasks = byDate[iso] || [];
            return (
              <div
                key={iso}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 6,
                  minHeight: 96,
                  background: inMonth ? "#fff" : "#f9fafb",
                  opacity: inMonth ? 1 : 0.7,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {/* Day number */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <button
                    onClick={() => onSelectDate && onSelectDate(iso)}
                    title="Open this day in Today"
                    style={{
                      fontWeight: isSameDay(d, today) ? 700 : 600,
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  >
                    {d.getDate()}
                  </button>
                  {tasks.length > 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>{tasks.length}</span>
                  )}
                </div>

                {/* Task list preview (first 3) */}
                <div style={{ display: "grid", gap: 4 }}>
                  {tasks.slice(0, 3).map((t) => (
                    <div
                      key={t.id}
                      title={t.title}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        opacity: t.status === "done" ? 0.6 : 1,
                        textDecoration: t.status === "done" ? "line-through" : "none",
                      }}
                    >
                      {/* category dot */}
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: t.category_color || "#d1d5db",
                          flex: "0 0 auto",
                        }}
                      />
                      {/* time (if any) */}
                      <span style={{ minWidth: 40, textAlign: "right", color: "#6b7280" }}>
                        {formatTime(t.due_time) || ""}
                      </span>
                      {/* title */}
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.title}
                      </span>
                    </div>
                  ))}
                  {tasks.length > 3 && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      +{tasks.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {err && <div style={{ color: "red" }}>{err}</div>}
    </div>
  );
}
