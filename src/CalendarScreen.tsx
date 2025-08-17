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
const CAL_ALFRED_SRC = publicPath("/alfred/Calendar_Alfred.png");

/* ---------- Alfred modal shell ---------- */
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

/* ---------- Loads full help doc from /public/help ---------- */
function CalendarHelpContent() {
  const CANDIDATES = [
    publicPath("/help/calendar-help.html"),
    publicPath("/help/calendar-help.pdf"),
    publicPath("/help/calendar-help.md"),
    publicPath("/help/calendar-help.txt"),
  ];
  const [mode, setMode] = useState<"html" | "pdf" | "md" | "txt" | "none">("none");
  const [url, setUrl] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const candidate of CANDIDATES) {
        try {
          const res = await fetch(candidate, { cache: "no-cache" });
          if (!res.ok) continue;

          if (candidate.endsWith(".html")) {
            if (!cancelled) { setMode("html"); setUrl(candidate); setLoading(false); }
            return;
          }
          if (candidate.endsWith(".pdf")) {
            if (!cancelled) { setMode("pdf"); setUrl(candidate); setLoading(false); }
            return;
          }
          // md / txt
          const t = await res.text();
          if (!cancelled) {
            setText(t);
            setMode(candidate.endsWith(".md") ? "md" : "txt");
            setLoading(false);
          }
          return;
        } catch {
          /* try next */
        }
      }
      if (!cancelled) { setMode("none"); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="muted">Loading help…</div>;
  if (mode === "html" || mode === "pdf") {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <iframe
          src={url}
          title="Calendar help"
          style={{ width: "100%", height: "60vh", border: "1px solid #e5e7eb", borderRadius: 8 }}
        />
        <a href={url} target="_blank" rel="noreferrer">Open in new tab</a>
      </div>
    );
  }
  if (mode === "md") {
    // very light markdown: preserve newlines, show headings/bold/italic minimally
    const html = text
      .replace(/^### (.*)$/gm, "<h4>$1</h4>")
      .replace(/^## (.*)$/gm, "<h3>$1</h3>")
      .replace(/^# (.*)$/gm, "<h2>$1</h2>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^- (.*)$/gm, "• $1")
      .replace(/\n/g, "<br/>");
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (mode === "txt") {
    return <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>;
  }
  return (
    <div className="muted">
      Place your help at <code>public/help/calendar-help.html</code> (or <code>.pdf</code>, <code>.md</code>, <code>.txt</code>) and it’ll appear here.
    </div>
  );
}

/* ========================== MAIN SCREEN ========================== */

export default function CalendarScreen({
  onSelectDate,
  navigateOnSelect = false, // default to staying on the calendar
}: {
  onSelectDate?: (iso: string) => void;
  /** When true, clicking a date or "Today" will call onSelectDate (navigation). */
  navigateOnSelect?: boolean;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const todayISO = toISO(new Date());

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
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
  const [newFreq, setNewFreq] = useState<"once" | "daily" | "weekly" | "monthly" | "annually">("once");
  const [repeatCount, setRepeatCount] = useState<number>(1); // number of occurrences (including the first)
  const [adding, setAdding] = useState(false);

  // Alfred modal
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

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
        .select(
          "id,user_id,title,due_date,priority,category,category_color,completed_at,source"
        )
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

  function addInterval(baseISO: string, step: "once" | "daily" | "weekly" | "monthly" | "annually", i: number) {
    if (step === "once" || i === 0) return baseISO;
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

    const count = Math.max(1, Number.isFinite(repeatCount) ? repeatCount : 1);
    setAdding(true); setErr(null);
    try {
      const category = newCat;
      const category_color = colorOf(category);

      // Build rows for bulk insert
      const rows = Array.from({ length: count }, (_, i) => ({
        user_id: userId,
        title,
        due_date: addInterval(selectedISO, newFreq, i),
        priority: newPriority,
        category,
        category_color,
        source: newFreq === "once" ? "calendar_manual" : `calendar_repeat_${newFreq}`,
      }));

      const { data, error } = await supabase
        .from("tasks")
        .insert(rows)
        .select();
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
      setNewFreq("once");
      setRepeatCount(1);
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
      <div
        className="card"
        style={{
          position: "relative",
          display: "grid",
          gap: 6,
          paddingRight: 64,
        }}
      >
        {/* Alfred — top-right */}
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Calendar help"
          title="Need a hand? Ask Alfred"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            lineHeight: 0,
            zIndex: 10,
          }}
        >
          {imgOk ? (
            <img
              src={CAL_ALFRED_SRC}
              alt="Calendar Alfred — open help"
              style={{ width: 48, height: 48 }}
              onError={() => setImgOk(false)}
            />
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36, height: 36, borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#f9fafb",
                fontWeight: 700,
              }}
            >
              ?
            </span>
          )}
        </button>

        <h1 style={{ margin: 0 }}>Calendar</h1>

        {/* Month controls + month label and count */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button onClick={goToday}>Today</button>
            <button onClick={prevMonth}>←</button>
            <strong>{monthLabel}</strong>
            <button onClick={nextMonth}>→</button>
          </div>
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
            fontSize: 12,
            color: "#64748b",
          }}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} style={{ textAlign: "center" }}>
              {d}
            </div>
          ))}
        </div>
      </div>

      {/* Month grid — select a day, stay on this page */}
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
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
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
            <span className="muted">
              {dayTasks.length} task{dayTasks.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Add task to selected date */}
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

            {/* Frequency (after Priority) */}
            <select value={newFreq} onChange={e => setNewFreq(e.target.value as any)} title="Frequency">
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>

            {/* Repeat count (only if repeating) */}
            {newFreq !== "once" && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="muted">Repeat</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={repeatCount}
                  onChange={e => setRepeatCount(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                  style={{ width: 70 }}
                  title="Number of occurrences (including the first)"
                />
                <span className="muted">times</span>
              </label>
            )}

            <button className="btn-primary" onClick={addTaskToSelected} disabled={!newTitle.trim() || adding} style={{ borderRadius: 8 }}>
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {dayTasks.length === 0 && <div className="muted">Nothing scheduled.</div>}
        <ul className="list">
          {dayTasks.map((t) => (
            <li key={t.id} className="item">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  title={t.category || ""}
                  style={{
                    width: 10,
                    height: 10,
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

      {/* Help modal (loads your real doc) */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Calendar — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {imgOk && <img src={CAL_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
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
