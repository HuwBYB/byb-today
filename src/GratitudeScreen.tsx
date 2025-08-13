import { useEffect, useMemo, useState } from "react";
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

// --- dates (local) ---
function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) { const [y,m,d]=s.split("-").map(Number); return new Date(y,(m??1)-1,d??1); }

type Idx = 1|2|3|4|5|6|7|8;
const INDEXES: Idx[] = [1,2,3,4,5,6,7,8];

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

  // history (last 30 days)
  const [history, setHistory] = useState<Record<string, EntryRow[]>>({});

  // init maps
  function resetMaps(withRows: EntryRow[]) {
    const rb: Record<number, EntryRow | null> = {};
    const dr: Record<number, string> = {};
    for (const i of INDEXES) { rb[i] = null; dr[i] = ""; }
    for (const r of withRows) { rb[r.item_index] = r; dr[r.item_index] = r.content; }
    setRowsByIdx(rb);
    setDraft(dr);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // load one day
  async function loadDay(iso: string) {
    if (!userId) return;
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("entry_date", iso)
      .order("item_index", { ascending: true });
    setLoading(false);
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
    if (error) { setErr(error.message); setHistory({}); return; }
    const grouped: Record<string, EntryRow[]> = {};
    for (const r of (data as EntryRow[])) {
      (grouped[r.entry_date] ||= []).push(r);
    }
    setHistory(grouped);
  }

  useEffect(() => { if (userId) { loadDay(dateISO); loadHistory(); } }, [userId, dateISO]);

  // save one line (upsert/delete), keep draft in sync
  async function saveIdx(idx: Idx) {
    if (!userId) return;
    const content = (draft[idx] || "").trim();
    setSavingIdx(idx); setErr(null);
    try {
      const existing = rowsByIdx[idx];
      if (!content) {
        if (existing) {
          const { error } = await supabase.from("gratitude_entries").delete().eq("id", existing.id);
          if (error) throw error;
        }
        // reflect local
        setRowsByIdx(prev => ({ ...prev, [idx]: null }));
      } else {
        const payload = { user_id: userId, entry_date: dateISO, item_index: idx, content };
        const { data, error } = await supabase
          .from("gratitude_entries")
          .upsert(payload as any, { onConflict: "user_id,entry_date,item_index" })
          .select()
          .single();
        if (error) throw error;
        setRowsByIdx(prev => ({ ...prev, [idx]: data as EntryRow }));
      }
      // refresh history sidebar but avoid flicker on inputs
      loadHistory();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSavingIdx(null);
    }
  }

  function gotoToday() { setDateISO(toISO(new Date())); }
  function gotoPrev()  { const d = fromISO(dateISO); d.setDate(d.getDate()-1); setDateISO(toISO(d)); }
  function gotoNext()  { const d = fromISO(dateISO); d.setDate(d.getDate()+1); setDateISO(toISO(d)); }

  const countToday = useMemo(() => INDEXES.reduce((n,i)=> n + (rowsByIdx[i] ? 1 : 0), 0), [rowsByIdx]);

  async function exportCSV() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("*")
      .eq("user_id", userId)
      .order("entry_date", { ascending: true })
      .order("item_index", { ascending: true });
    if (error) { setErr(error.message); return; }
    const rows = [["date","item_index","content"]];
    for (const r of (data as EntryRow[])) rows.push([r.entry_date, String(r.item_index), r.content.replace(/\r?\n/g, " ")]);
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "gratitude.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12 }}>
      {/* Left: editor */}
      <div className="card">
        <h1>Gratitude Journal</h1>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, marginBottom: 12 }}>
          <button onClick={gotoToday}>Today</button>
          <button onClick={gotoPrev}>←</button>
          <input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />
          <button onClick={gotoNext}>→</button>
          <div className="muted" style={{ marginLeft: "auto" }}>{countToday}/8 for this day</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {INDEXES.map((idx) => (
            <label key={idx} style={{ display: "grid", gap: 6 }}>
              <div className="section-title">Gratitude {idx}</div>
              <input
                type="text"
                placeholder={PLACEHOLDERS[idx] || "I'm grateful for…"}
                value={draft[idx] ?? ""}                   // CONTROLLED
                onChange={(e) => setDraft(d => ({ ...d, [idx]: e.currentTarget.value }))}
                onBlur={() => saveIdx(idx)}                // save on blur
                disabled={loading || savingIdx === idx}
              />
              {savingIdx === idx && <span className="muted">Saving…</span>}
            </label>
          ))}
        </div>

        {err && <div style={{ color: "red", marginTop: 10 }}>{err}</div>}
      </div>

      {/* Right: history */}
      <div className="card" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Recent days</h2>
        <div style={{ overflow: "auto", maxHeight: "60vh" }}>
          <ul className="list">
            {Object.keys(history).length === 0 && <li className="muted">No recent entries.</li>}
            {Object.entries(history).map(([d, rows]) => (
              <li key={d} className="item" style={{ alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{d}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {(rows || []).map(r => r.content).slice(0,2).join(" · ")}
                    {rows.length > 2 ? " · …" : ""}
                  </div>
                </div>
                <button onClick={() => setDateISO(d)}>Open</button>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn-primary" onClick={exportCSV}>Export CSV</button>
        </div>
      </div>
    </div>
  );
}
