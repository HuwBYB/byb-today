import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type EntryRow = {
  id: number;
  user_id: string;
  entry_date: string; // 'YYYY-MM-DD'
  item_index: number; // 1..3
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

export default function GratitudeScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(() => toISO(new Date()));
  const [items, setItems] = useState<{ [k: number]: EntryRow | null }>({ 1: null, 2: null, 3: null });
  const [loading, setLoading] = useState(false);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // history list (last ~30 days)
  const [history, setHistory] = useState<Record<string, EntryRow[]>>({});

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // Load entries for the selected day
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
    if (error) { setErr(error.message); setItems({ 1: null, 2: null, 3: null }); return; }
    const map: any = { 1: null, 2: null, 3: null };
    for (const r of (data as EntryRow[])) map[r.item_index] = r;
    setItems(map);
  }

  // Load recent history for sidebar (last 30 days)
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
      if (!grouped[r.entry_date]) grouped[r.entry_date] = [];
      grouped[r.entry_date].push(r);
    }
    setHistory(grouped);
  }

  useEffect(() => { if (userId) { loadDay(dateISO); loadHistory(); } }, [userId, dateISO]);

  // Save or delete one of the 1..3 lines
  async function saveItem(idx: 1 | 2 | 3, content: string) {
    if (!userId) return;
    const trimmed = content.trim();
    setSavingIdx(idx); setErr(null);
    try {
      const existing = items[idx];
      if (!trimmed) {
        // delete if exists
        if (existing) {
          const { error } = await supabase.from("gratitude_entries")
            .delete()
            .eq("id", existing.id);
          if (error) throw error;
        }
      } else {
        // upsert (unique on user_id+date+index)
        const payload = { user_id: userId, entry_date: dateISO, item_index: idx, content: trimmed };
        const { error } = await supabase
          .from("gratitude_entries")
          .upsert(payload as any, { onConflict: "user_id,entry_date,item_index" });
        if (error) throw error;
      }
      await loadDay(dateISO);
      await loadHistory();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSavingIdx(null);
    }
  }

  function gotoToday() { setDateISO(toISO(new Date())); }
  function gotoPrev() { const d = fromISO(dateISO); d.setDate(d.getDate() - 1); setDateISO(toISO(d)); }
  function gotoNext() { const d = fromISO(dateISO); d.setDate(d.getDate() + 1); setDateISO(toISO(d)); }

  const countToday = useMemo(() => Object.values(items).filter(Boolean).length, [items]);

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
          <div className="muted" style={{ marginLeft: "auto" }}>{countToday}/3 for this day</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {[1,2,3].map((idx) => (
            <label key={idx} style={{ display: "grid", gap: 6 }}>
              <div className="section-title">Gratitude {idx}</div>
              <input
                type="text"
                placeholder={
                  idx === 1 ? "Something good that happened…" :
                  idx === 2 ? "Someone I'm grateful for…" :
                               "A small win today…"
                }
                defaultValue={items[idx as 1|2|3]?.content ?? ""}
                onBlur={(e) => saveItem(idx as 1|2|3, e.currentTarget.value)}
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
