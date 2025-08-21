import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
      <p><em>Keep key dates in one place — add naturally, repeat flexibly, and export anywhere.</em></p>

      <h4 style={{ margin: "8px 0" }}>Quick add (examples)</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><code>Lunch with Ana tomorrow #personal !high</code></li>
        <li><code>Gym every Mon,Wed,Fri #health</code></li>
        <li><code>Invoice client on 15 Sep every month until 2026-06-01 #career</code></li>
        <li><code>Pay VAT 15/10 every 2 weeks !high</code></li>
      </ul>

      <h4 style={{ margin: "8px 0" }}>Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Week view for rapid planning; Month view for the big picture.</li>
        <li>Export to ICS/CSV for other calendars; import ICS/CSV to pull dates in.</li>
      </ul>
    </div>
  );
}

/* ========================== MAIN SCREEN ========================== */

type RepeatFreq = "" | "daily" | "weekly" | "monthly" | "annually";

/** Default counts (when no "until" or "for N") */
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
  const [viewMode, setViewMode] = useState<ViewMode>("month");

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

  // natural-language quick add
  const [nlp, setNlp] = useState("");
  const [addingNlp, setAddingNlp] = useState(false);

  // Import/Export
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState<"ics" | "csv" | null>(null);
  const [importing, setImporting] = useState(false);

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

      if (!newFreq) {
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

  /* ================= Import / Export ================= */
  async function exportICS() {
    setExporting("ics");
    try {
      const events: Task[] = [];
      const first = toISO(firstDayOfMonth), last = toISO(lastDayOfMonth);
      for (const [iso, list] of Object.entries(tasksByDay)) {
        if (iso >= first && iso <= last) events.push(...list);
      }
      const ics = toICS(events);
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      downloadBlob(blob, `calendar_${monthLabel.replace(/\s/g, "_")}.ics`);
    } finally {
      setExporting(null);
    }
  }

  async function exportCSV() {
    setExporting("csv");
    try {
      const rows: string[] = ["date,title,category,priority"];
      const first = toISO(firstDayOfMonth), last = toISO(lastDayOfMonth);
      for (const [iso, list] of Object.entries(tasksByDay)) {
        if (iso < first || iso > last) continue;
        for (const t of list) {
          rows.push(`${iso},"${csvEscape(t.title || "")}",${t.category || ""},${t.priority ?? ""}`);
        }
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `calendar_${monthLabel.replace(/\s/g, "_")}.csv`);
    } finally {
      setExporting(null);
    }
  }

  function onImportClick() {
    fileInputRef.current?.click();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setImporting(true);
    setErr(null);
    try {
      const text = await file.text();
      let rows: Array<{ title: string; due_date: string; category?: CatKey; priority?: number }> = [];
      if (file.name.toLowerCase().endsWith(".ics")) {
        rows = parseICS(text);
      } else {
        rows = parseCSV(text);
      }
      if (!rows.length) throw new Error("No events found in file.");

      // sanitize + clamp categories/priorities
      const inserts = rows.map(r => ({
        user_id: userId,
        title: (r.title || "").trim(),
        due_date: r.due_date,
        category: (r.category && isCatKey(r.category)) ? r.category : "other",
        category_color: colorOf((r.category && isCatKey(r.category)) ? r.category : "other"),
        priority: (r.priority && [1,2,3].includes(r.priority)) ? r.priority : 2,
        source: "calendar_import",
      }));

      const { data, error } = await supabase.from("tasks").insert(inserts as any).select();
      if (error) throw error;

      // merge into current month cache if visible
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
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setImporting(false);
      e.target.value = ""; // reset
    }
  }

  const dayTasks = tasksByDay[selectedISO] || [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Title card with Alfred + controls */}
      <div className="card" style={{ position: "relative", display: "grid", gap: 10, paddingRight: 64 }}>
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
            <img
              src={ALFRED_SRC}
              alt="Calendar Alfred — open help"
              style={{ width: 48, height: 48 }}
              onError={() => setImgIdx(i => i + 1)}
            />
          ) : (
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700,
            }}>?</span>
          )}
        </button>

        <h1 style={{ margin: 0 }}>Calendar</h1>

        {/* Row: Left controls + View toggle + Import/Export */}
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

            <button onClick={exportICS} disabled={!!exporting} className="btn-soft" title="Export current month (.ics)">
              {exporting === "ics" ? "Exporting…" : "Export ICS"}
            </button>
            <button onClick={exportCSV} disabled={!!exporting} className="btn-soft" title="Export current month (.csv)">
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button onClick={onImportClick} disabled={importing} className="btn-soft" title="Import ICS/CSV">
              {importing ? "Importing…" : "Import"}
            </button>
            <input ref={fileInputRef} type="file" accept=".ics,.csv,text/calendar,text/csv" onChange={onImportFile} style={{ display: "none" }} />
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
              {loading ? "Loading…" : `${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"}`}
            </span>
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

        {/* Structured add (optional) */}
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
          <button className="btn-primary" onClick={addTaskToSelected} disabled={!newTitle.trim() || adding} style={{ borderRadius: 8 }}>
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {dayTasks.length === 0 && !loading && <div className="muted">Nothing scheduled.</div>}
        <ul className="list">
          {dayTasks.map((t) => (
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
                    {t.title}
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

/* ===================== NLP Parser ===================== */
/**
 * Parse examples:
 *  - "Lunch tomorrow #personal !high"
 *  - "Dentist 2025-09-01 #health"
 *  - "Gym every Mon,Wed,Fri #health"
 *  - "Invoice 15 Sep every month until 2026-01-01 !high"
 *  - "Pay VAT 15/10 every 2 weeks for 6 times"
 */
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

  // category via #tag
  const catMatch = s.match(/#(personal|health|career|financial|other)\b/i);
  if (catMatch) {
    category = catMatch[1].toLowerCase() as CatKey;
    s = s.replace(catMatch[0], " ");
  }

  // priority via !high|!normal|!low|!top
  const priMatch = s.match(/!(high|normal|low|top)\b/i);
  if (priMatch) {
    const key = priMatch[1].toLowerCase();
    priority = key === "high" || key === "top" ? 1 : key === "normal" ? 2 : 3;
    s = s.replace(priMatch[0], " ");
  }

  // explicit date forms in text -> pick first as anchor
  let anchorISO: string | null = findExplicitDateISO(s, baseISO);
  if (anchorISO) {
    // remove that substring
    s = removeDateSubstr(s);
  }

  // relative tokens: today / tomorrow / next week / next mon...
  const rel = s.match(/\b(today|tomorrow|next week|next\s+(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun))\b/i);
  if (rel && !anchorISO) {
    anchorISO = relativeToISO(rel[0].toLowerCase(), baseISO);
    if (anchorISO) s = s.replace(rel[0], " ");
  }

  // "in N days/weeks/months"
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

  // repeat rules: every ...
  const everyMatch = s.match(/\bevery\b([\s\S]*)$/i);
  let rule: { type: "weekday-list" | "interval" | "freq"; days?: number[]; freq?: "daily"|"weekly"|"monthly"|"annually"; interval?: number; until?: string | null; count?: number | null } | null = null;
  if (everyMatch) {
    const tail = everyMatch[1].trim();
    // until date
    const until = (tail.match(/\buntil\s+([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\/\-][0-9]{1,2}(?:[\/\-][0-9]{2,4})?|[0-9]{1,2}\s+[A-Za-z]{3,})/i));
    const untilISO = until ? normalizeAnyDateToISO(until[1], baseISO) : null;

    // count "for N times"
    const countMatch = tail.match(/\bfor\s+(\d+)\s+(time|times)\b/i);
    const count = countMatch ? Number(countMatch[1]) : null;

    // weekday list: mon,wed,fri
    const wd = parseWeekdayList(tail);
    if (wd && wd.length) {
      rule = { type: "weekday-list", days: wd, until: untilISO, count };
    } else {
      // interval like "every 2 weeks", or "weekly/monthly/daily/annually"
      const intMatch = tail.match(/\bevery\s+(\d+)\s+(week|weeks|month|months|day|days|year|years)\b/i);
      if (intMatch) {
        const n = Number(intMatch[1]);
        const unit = intMatch[2].toLowerCase();
        const freq = unit.startsWith("day") ? "daily" : unit.startsWith("week") ? "weekly" : unit.startsWith("month") ? "monthly" : "annually";
        rule = { type: "interval", interval: n, freq, until: untilISO, count };
      } else {
        // plain "every week/month/day/year"
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
    // remove "every..." clause from title
    s = s.replace(/\bevery\b([\s\S]*)$/i, " ");
  }

  const title = s.replace(/\s+/g, " ").trim();

  // Build occurrences
  const base = anchorISO || baseISO;
  if (!rule) {
    occurrences.push(base);
  } else {
    const maxCap = 104; // safety
    if (rule.type === "weekday-list") {
      const days = rule.days || [];
      const until = rule.until ? fromISO(rule.until) : null;
      let d = fromISO(base);
      let added = 0;
      // iterate forward day by day and pick matching weekdays
      while (added < (rule.count ?? 24) && added < maxCap) {
        const iso = toISO(d);
        const wd = weekdayIdx(d); // Mon=1..Sun=7
        if (days.includes(wd) && (until ? d <= until : true)) {
          occurrences.push(iso);
          added++;
        }
        d = addDays(d, 1);
        if (!until && added >= (rule.count ?? 24)) break;
        if (until && d > until) break;
      }
    } else if (rule.type === "interval") {
      const interval = Math.max(1, rule.interval || 1);
      const freq = rule.freq!;
      const until = rule.until ? fromISO(rule.until) : null;
      const limit = rule.count ?? defaultCountFor(freq);
      let d = fromISO(base);
      for (let i = 0; i < Math.min(limit, maxCap); i++) {
        occurrences.push(toISO(d));
        d = addIntervalN(d, freq, interval);
        if (until && d > until) break;
      }
    } else if (rule.type === "freq") {
      const freq = rule.freq!;
      const until = rule.until ? fromISO(rule.until) : null;
      const limit = rule.count ?? defaultCountFor(freq);
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
    occurrences: Array.from(new Set(occurrences)), // dedupe
    category,
    priority,
    source: "calendar_nlp"
  };
}

function defaultCountFor(freq: "daily"|"weekly"|"monthly"|"annually") {
  return freq === "daily" ? 14 : freq === "weekly" ? 12 : freq === "monthly" ? 12 : 5;
}

function parseWeekdayList(tail: string): number[] | null {
  // returns Mon..Sun as 1..7
  const map: Record<string, number> = { mon:1, tue:2, tues:2, wed:3, thu:4, thur:4, thurs:4, fri:5, sat:6, sun:7 };
  const m = tail.match(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(\s*,\s*(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun))*\b/ig);
  if (!m) return null;
  const tokens = m[0].split(",").map(s => s.trim().toLowerCase());
  const days = tokens.map(t => map[t]).filter(Boolean);
  return Array.from(new Set(days));
}

function findExplicitDateISO(s: string, baseISO: string): string | null {
  // YYYY-MM-DD
  const iso = s.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return clampISO(iso[1]);
  // DD/MM or D/M (assume current year)
  const dm = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dm) {
    const y = dm[3] ? normalizeYear(Number(dm[3])) : fromISO(baseISO).getFullYear();
    const m = Number(dm[2]); const d = Number(dm[1]);
    return toISO(new Date(y, m - 1, d));
  }
  // "15 Sep" or "Sep 15"
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

/* ===================== Import/Export helpers ===================== */
function toICS(events: Task[]) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BYB//Calendar//EN",
  ];
  const dtstamp = toICSDate(new Date());
  for (const ev of events) {
    const dt = ev.due_date ? ev.due_date.replace(/-/g, "") : "";
    if (!dt) continue;
    const uid = `${ev.id || Math.random().toString(36).slice(2)}@byb`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dt}`,
      `SUMMARY:${icsEscape(ev.title || "")}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function toICSDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}
function icsEscape(s: string) {
  return s.replace(/([,;])/g, "\\$1");
}
function parseICS(text: string): Array<{ title: string; due_date: string; category?: CatKey; priority?: number }> {
  const rows: Array<{ title: string; due_date: string; category?: CatKey; priority?: number }> = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cur: { summary?: string; dtstart?: string } = {};
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) cur = {};
    else if (line.startsWith("SUMMARY:")) cur.summary = line.slice(8).trim();
    else if (line.startsWith("DTSTART")) {
      const parts = line.split(":");
      const val = parts[1]?.trim() || "";
      // handle VALUE=DATE:YYYYMMDD
      const y = val.slice(0, 4), m = val.slice(4, 6), d = val.slice(6, 8);
      if (y && m && d) cur.dtstart = `${y}-${m}-${d}`;
    } else if (line.startsWith("END:VEVENT")) {
      if (cur.summary && cur.dtstart) {
        rows.push({ title: cur.summary, due_date: cur.dtstart });
      }
      cur = {};
    }
  }
  return rows;
}
function parseCSV(text: string): Array<{ title: string; due_date: string; category?: CatKey; priority?: number }> {
  const out: Array<{ title: string; due_date: string; category?: CatKey; priority?: number }> = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return out;
  let startIdx = 0;
  const first = lines[0].toLowerCase();
  if (first.includes("date") && first.includes("title")) { startIdx = 1; }
  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (!cols.length) continue;
    // Expect date,title,category,priority (flexible)
    const dateCol = cols[0]?.trim() || "";
    const titleCol = cols[1]?.trim() || "";
    const catCol = (cols[2]?.trim() || "") as CatKey;
    const priCol = cols[3]?.trim();
    const iso = normalizeAnyDateToISO(dateCol, toISO(new Date())) || "";
    if (!iso || !titleCol) continue;
    const pri = priCol ? Number(priCol) : undefined;
    out.push({ title: unquote(titleCol), due_date: iso, category: isCatKey(catCol) ? catCol : undefined, priority: isFinite(pri as number) ? (pri as number) : undefined });
  }
  return out;
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
function csvEscape(s: string) {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function unquote(s: string) {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
  return s;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function isCatKey(k: any): k is CatKey {
  return ["personal","health","career","financial","other"].includes(k);
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
