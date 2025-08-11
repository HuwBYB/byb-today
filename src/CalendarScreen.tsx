import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type ItemType = "task" | "daily_action";

// local-date ISO (yyyy-mm-dd)
function toISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthGridStartMonday(first: Date) {
  // JS getDay(): 0=Sun..6=Sat → convert to Mon=0..Sun=6
  const dowMon0 = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - dowMon0);
  return start;
}

export default function CalendarScreen({
  onSelectDate,
}: {
  onSelectDate?: (iso: string) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [monthAnchor, setMonthAnchor] = useState<Date>(firstOfMonth(new Date()));
  const [selectedISO, setSelectedISO] = useState<string>(toISO(new Date()));

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [items, setItems] = useState<any[]>([]);
  const [loadingCounts, setLoadingCounts] = useState<boolean>(true);
  const [loadingItems, setLoadingItems] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  // Who am I?
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // Build a 6x7 (Mon–Sun) grid
  const grid = useMemo(() => {
    const first = firstOfMonth(monthAnchor);
    const start = monthGridStartMonday(first);
    const cells: { date: Date; iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({
        date: d,
        iso: toISO(d),
        inMonth: d.getMonth() === monthAnchor.getMonth(),
      });
    }
    return cells;
  }, [monthAnchor]);

  const weekLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const gridStartISO = grid.length ? grid[0].iso : toISO(monthAnchor);
  const gridEndISO = grid.length ? grid[grid.length - 1].iso : toISO(monthAnchor);

  // Fetch counts for visible grid (async/await — avoids .finally typing)
  useEffect(() => {
    if (!userId || !gridStartISO || !gridEndISO) return;
    let cancelled = false;
    (async () => {
      setLoadingCounts(true);
      setErr(null);
      try {
        const { data, error } = await supabase
          .from("calendar_counts_v")
          .select("*")
          .eq("user_id", userId)
          .gte("item_date", gridStartISO)
          .lte("item_date", gridEndISO);
        if (error) {
          if (!cancelled) { setErr(error.message); setCounts({}); }
          return;
        }
        const map: Record<string, number> = {};
        (data || []).forEach((row: any) => { map[row.item_date] = row.item_count; });
        if (!cancelled) setCounts(map);
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, gridStartISO, gridEndISO]);

  // Keep selected day in current grid
  useEffect(() => {
    if (!grid.length) return;
    if (selectedISO < gridStartISO || selectedISO > gridEndISO) {
      setSelectedISO(toISO(firstOfMonth(monthAnchor)));
    }
  }, [grid, gridStartISO, gridEndISO, monthAnchor, selectedISO]);

  // Load items for selected day
  async function loadDay(iso: string) {
    if (!userId) return;
    setLoadingItems(true);
    setErr(null);
    const { data, error } = await supabase
      .from("daily_items_v")
      .select("*")
      .eq("user_id", userId)
      .eq("item_date", iso)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) { setErr(error.message); setItems([]); }
    else { setItems(data || []); }
    setLoadingItems(false);
  }
  useEffect(() => { if (userId && selectedISO) loadDay(selectedISO); }, [userId, selectedISO]);

  function prevMonth() {
    setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1));
  }
  function nextMonth() {
    setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1));
  }

  async function completeItem(itemType: ItemType, id: number) {
    const table = itemType === "task" ? "tasks" : "daily_actions";
    const { error } = await supabase.from(table).update({ status: "done" }).eq("id", id);
    if (!error) loadDay(selectedISO);
  }
  async function setFocus(itemType: ItemType, id: number, isFocus: boolean) {
    const table = itemType === "task" ? "tasks" : "daily_actions";
    const { error } = await supabase.from(table).update({ priority: isFocus ? 2 : 0 }).eq("id", id);
    if (!error) loadDay(selectedISO);
  }

  const monthName = monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={prevMonth}>&laquo; Prev</button>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>{monthName}</h1>
        <button onClick={nextMonth}>Next &raquo;</button>
      </div>

      {/* Week labels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
        {weekLabels.map((w) => (
          <div key={w} style={{ textAlign: "center", fontSize: 12, color: "#666" }}>{w}</div>
        ))}
      </div>

      {/* Month grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {grid.map((cell) => {
          const count = counts[cell.iso] || 0;
          const isSelected = cell.iso === selectedISO;
          const isToday = cell.iso === toISO(new Date());
          return (
            <button
              key={cell.iso}
              onClick={() => {
                setSelectedISO(cell.iso);
                if (onSelectDate) onSelectDate(cell.iso); // NEW: tell parent
              }}
              style={{
                position: "relative",
                height: 72,
                border: `1px solid ${isSelected ? "#333" : "#ddd"}`,
                borderRadius: 8,
                background: cell.inMonth ? "#fff" : "#fafafa",
                outline: isToday ? "2px solid #6aa0ff" : "none",
              }}
              title={`${cell.iso}${count ? ` — ${count} item(s)` : ""}`}
            >
              <div style={{ position: "absolute", top: 6, left: 8, fontSize: 12, color: cell.inMonth ? "#333" : "#aaa" }}>
                {cell.date.getDate()}
              </div>
              {!loadingCounts && count > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    right: 6,
                    bottom: 6,
                    padding: "2px 6px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    fontSize: 12,
                  }}
                >
                  {count}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Selected day list */}
      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Items on {selectedISO}</h2>
          <button onClick={() => loadDay(selectedISO)}>Refresh</button>
        </div>
        {err ? <div style={{ color: "red", marginBottom: 8 }}>{err}</div> : null}
        {loadingItems ? (
          <div>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ color: "#666" }}>No items for this day.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((i: any) => (
              <li
                key={`${i.item_type}-${i.item_id}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 8,
                  marginBottom: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{i.title}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {(i.item_type === "daily_action" ? "Big Goal step" : i.source) + " • " + i.status}
                  </div>
                </div>
                <div>
                  <button onClick={() => setFocus(i.item_type as ItemType, i.item_id, true)} style={{ marginRight: 8 }}>
                    Make Top 3
                  </button>
                  <button onClick={() => completeItem(i.item_type as ItemType, i.item_id)}>Done</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
