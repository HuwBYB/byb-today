import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
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

/** Public path helper (Vite/CRA/Vercel/GH Pages) */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}

/** Alfred image candidates */
const CAL_ALFRED_CANDIDATES = [
  "/alfred/Calendar_Alfred.png",
  "/alfred/Calendar_Alfred.jpg",
  "/alfred/Calendar_Alfred.jpeg",
  "/alfred/Calendar_Alfred.webp",
].map(publicPath);

/* ---------- Modal ---------- */
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => { if (open && closeRef.current) closeRef.current.focus(); }, [open]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 2000,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, width: "100%", background: "#fff", borderRadius: 12,
                 boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Inline help content ---------- */
function CalendarHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Keep key dates in one place and see them flow into Today on the right day.</em></p>

      <h4 style={{ margin: "8px 0" }}>Quick start</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Pick a date.</li>
        <li>Add a title, category and priority.</li>
        <li>Optional: pick a repeat — <strong>Daily / Weekly / Monthly / Annually</strong>.</li>
        <li>Click <strong>Add</strong>.</li>
      </ol>

      <h4 style={{ margin: "8px 0" }}>Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Use <b>Annually</b> for birthdays/anniversaries — we add a few years ahead automatically.</li>
        <li>Jump months/years with the dropdowns to browse fast.</li>
      </ul>
    </div>
  );
}

/* ========================== MAIN SCREEN ========================== */

type RepeatFreq = "" | "daily" | "weekly" | "monthly" | "annually";

/** How many future occurrences to create (including the first) */
const REPEAT_COUNTS: Record<Exclude<RepeatFreq, "">, number> = {
  daily: 14,     // 2 weeks
  weekly: 12,    // 12 weeks
  monthly: 12,   // 12 months
  annually: 5,   // 5 years
};

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

  const [tasksByDay, setTasksByDay] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // add-task state
  const [newTitle, setNewTitle] = useState("");
  const [newCat, setNewCat] = useState<CatKey>("other");
  const [newPriority, setNewPriority] = useState<number>(2);
  const [newFreq, setNewFreq] = useState<RepeatFreq>(""); // no "Once" choice
  const [adding, setAdding] = useState(false);

  // Alfred modal
  const [showHelp, setShowHelp] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const ALFRED_SRC = CAL_ALFRED_CANDIDATES[imgIdx] ?? "";

  // Month/year selectors
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({
      value: i,
      label: new Date(2000, i, 1).toLocaleString(undefined, { month: "long" })
    })),
    []
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
    const iso = toISO(d);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedISO(iso);
    if (navigateOnSelect && onSelectDate) onSelectDate(iso);
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

  async function addTaskToSelected() {
    if (!userId) return;
    const title = newTitle.trim();
    if (!title) return;

    setAdding(true); setErr(null);
    try {
      const category = newCat;
      const category_color = colorOf(category);

      let rows: Array<Partial<Task> & { user_id: string }> = [];

      if (!newFreq) {
        // one-off
        rows = [{
          user_id: userId,
          title,
          due_date: selectedISO,
          priority: newPriority,
          category,
          category_color,
          source: "calendar_manual",
        }];
      } else {
        const count = REPEAT_COUNTS[newFreq];
        rows = Array.from({ length: count }, (_, i) => ({
          user_id: userId,
          title,
          due_date: addInterval(selectedISO, newFreq, i),
          priority: newPriority,
          category,
          category_color,
          source: `calendar_repeat_${newFreq}`,
        }));
      }

      const { data, error } = await supabase.from("tasks").insert(rows as any).select();
      if (error) throw error;

      // Update local state (only dates currently in view)
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
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setAdding(false);
    }
  }

  const dayTasks = tasksByDay[selectedISO] || [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Title card with Alfred */}
      <div className="card" style={{ position: "relative", display: "grid", gap: 6, paddingRight: 64 }}>
        {/* Alfred — top-right */}
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Calendar help"
          title="Need a hand? Ask Alfred"
          style={{
            position: "absolute", top: 8, right: 8,
            border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10,
          }}
        >
          {ALFRED_SRC ? (
            <img src={ALFRED_SRC} alt="Calendar Alfred — open help" style={{ width: 48, height: 48 }} onError={() => setImgIdx(i => i + 1)} />
          ) : (
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700,
            }}>?</span>
          )}
        </button>

        <h1 style={{ margin: 0 }}>Calendar</h1>

        {/* Month controls row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          {/* Left cluster: tiny today pill + prev/next + month/year selects + label (no wrapping) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            {/* Tiny day pill for Today */}
            <button
              onClick={goToday}
              title="Go to today"
              aria-label="Go to today"
              style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontWeight: 700 }}
            >
              {today.getDate()}
            </button>

            <button onClick={prevMonth} aria-label="Previous month">←</button>

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

            <button onClick={nextMonth} aria-label="Next month">→</button>

            {/* Nice label (stays readable, but not relied upon for layout) */}
            <strong style={{ marginLeft: 6 }}>{monthLabel}</strong>
          </div>

          {/* Right: count */}
          {loading ? (
            <div className="muted">Loading…</div>
          ) : (
            <div className="muted">
              {Object.values(tasksByDay).reduce((a, b) => a + b.length, 0)} tasks this month
            </div>
          )}
        </div>
      </div>

      {/* Weekday header (Mon..Sun) */}
      <div className="card" style={{ padding: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, fontSize: 12, color: "#64748b" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} style={{ textAlign: "center" }}>{d}</div>
          ))}
        </div>
      </div>

      {/* Month grid */}
      <div className="card" style={{ padding: 8 }}>
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
      </div>

      {/* Day detail + add-task */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{selectedISO}</h2>
            <span className="muted">{dayTasks.length} task{dayTasks.length === 1 ? "" : "s"}</span>
          </div>

          {/* Add task */}
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

            {/* Repeat (no "once") */}
            <select value={newFreq} onChange={e => setNewFreq(e.target.value as RepeatFreq)} title="Repeat (optional)">
              <option value="">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>

            <button className="btn-primary" onClick={addTaskToSelected} disabled={!newTitle.trim() || adding} style={{ borderRadius: 8 }}>
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {dayTasks.length === 0 && <div className="muted">Nothing scheduled.</div>}
        <ul className="list">
          {dayTasks.map((t) => (
            <li key={t.id} className="item">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                {/* perfectly round dot that never stretches */}
                <span
                  title={t.category || ""}
                  style={{
                    display: "inline-block",
                    flex: "0 0 auto",
                    width: 10,
                    height: 10,
                    marginTop: 6,             // keeps it visually centered on first line
                    borderRadius: 999,
                    background: t.category_color || "#e5e7eb",
                    border: "1px solid #d1d5db",
                  }}
                />
                <div style={{ textDecoration: t.completed_at ? "line-through" : "none" }}>
                  {t.title}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Calendar — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {ALFRED_SRC && (
            <img
              src={ALFRED_SRC}
              alt=""
              aria-hidden="true"
              style={{ width: 72, height: 72, flex: "0 0 auto" }}
              onError={() => setImgIdx(i => i + 1)}
            />
          )}
          <div style={{ flex: 1 }}>
            <CalendarHelpContent />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ===== date utils ===== */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
