import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type ItemType = "task" | "daily_action";

function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthGridStartMonday(first: Date) {
  // Monday=0, … Sunday=6
  const dowMon0 = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - dowMon0);
  return start;
}

export default function CalendarScreen() {
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

  // Build a 6x7 month grid starting Monday
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

  // Fetch counts for the visible grid
  useEffect(() => {
    if (!userId || !gridStartISO || !gridEndISO) return;
    setLoadingCounts(true);
    setErr(null);
    supabase.from("calendar_counts_v")
