import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type EntryRow = {
  id: number;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
  item_index: number; // 1..8
  content: string;
  created_at: string;
  updated_at: string;
};

// --- date helpers (local) ---
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

type Idx = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const INDEXES: Idx[] = [1, 2, 3, 4, 5, 6, 7, 8];

const PLACEHOLDERS: Record<number, string> = {
  1: "Something good that happened…",
  2: "Someone I'm grateful for…",
  3: "A small win today…",
  4: "A comfort I enjoyed…",
  5: "Progress I noticed…",
  6: "A kindness (given/received)…",
  7: "Something I learned…",
  8: "Something I can let go of…",
};

export default function GratitudeScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(() => toISO(new Date()));

  const [rowsByIdx, setRowsByIdx] = useState<Record<number, EntryRow | null>>({});
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [history, setHistory] = useState<Record<string, EntryRow[]>>({});

  // prevent setState-after-unmount warnings/crashes
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  function safeSet<T>(setter: (v: T) => void, val: T) {
    if (alive.current) setter(val);
  }

  // init maps
  function resetMaps(withRows: EntryRow[]) {
    const rb: Record<number, EntryRow | null> = {};
    const dr: Record<number, string> = {};
    for (const i of INDEXES) { rb[i] = null; dr[i] = ""; }
    for (const r of withRows) { rb[r.item_index] = r; dr[r.item_index] = r.content ?? ""; }
    safeSet(setRowsByIdx, rb);
    safeSet(setDraft, dr);
  }

  // auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      safeSet(setUserId, data.user?.id ?? null);
    });
  }, []);

  // load one day
  async function loadDay(iso: string) {
    if (!userId) return;
    safeSet(setLoading, true); setErr(null);
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("entry_date", iso)
      .order("item_index", { ascending: true });
    safeSet(setLoading, false);
    if (error) { setErr(error.message); resetMaps([]); return; }
    resetMaps((data as EntryRow[]) || []);
  }

  // load recent history
  async function loadHistory() {
    if (!userId) return;
    const since = new Date(); since.setDate(since.getDate() - 30);
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("*")
      .eq("user_id", userId)
      .gte("entry_date", toISO(since))
      .order("entry_date", { ascending: false })
      .order("item_index", { ascending: true });
    if (error) { setErr(error.message); safeSet(setHistory, {}); return; }
    const grouped: Record<string, EntryRow[]> = {};
    for (const r of (data as EntryRow[])) {
      (grouped[r.entry_date] ||= []).push(r);
    }
    safeSet(setHistory, grouped);
  }

  useEffect(() => { if (userId) { loadDay(dateISO); loadHistory(); } }, [userId, dateISO]);

  // save one line (upsert/delete)
  async function saveIdx(idx: Idx) {
    if (!userId) return;
    const content = (draft[idx] || "").trim();
    safeSet(setSavingIdx, idx); setErr(null);
    try {
      const existing = rowsByIdx[idx];
      if (!content) {
        if (existing) {
          const { error } = await supabase.from("gratitude_entries").delete().eq("id", existing.id);
          if (error) throw error;
        }
        safeSet(setRowsByIdx, prev => ({ ...prev, [idx]: null } as any));
      } else {
        const payload = { user_id: userId, entry_date: dateISO, item_index: idx, content };
        const { data, error } = await supabase
          .from("gratitude_entries")
          .upsert(payload as any, { onConflict: "user_id,entry_date,item_index" })
          .select()
          .single();
        if (error) throw error;
        safeSet(setRowsByIdx, prev => ({ ...prev, [idx]: data as EntryRow } as any));
      }
      // refresh history (async)
      loadHistory();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      safeSet(setSavingIdx, null);
    }
  }

  function gotoToday() { setDateISO(toISO(new Date())); }
  function gotoPrev()  { const d = fromISO(dateISO); d.setDate(d.getDate()-1); setDateISO(toISO(d)); }
  function gotoNext()  { const d = fromISO(dateISO); d.setDate(d.getDate()+1); setDateISO(toISO(d)); }

  const countToday = useMemo(() =>
    INDEXES.reduce((n, i) => n + (rowsByIdx[i] ? 1 : 0), 0),
    [rowsByIdx]
  );

  async function exportCSV() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("*")
      .eq("user_id", userId)
