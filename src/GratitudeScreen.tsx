import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types (minimal schema) ---------- */
type EntryRow = {
  id: number;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
  item_index: number; // 1..8
  content: string;
};

/* ---------- Date helpers ---------- */
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
function addDays(iso: string, delta: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + delta);
  return toISO(d);
}

/* ---------- Public path helper ---------- */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}
const GRAT_ALFRED_SRC = publicPath("/alfred/Gratitude_Alfred.png");

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

/* ---------- Help content ---------- */
function GratitudeHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <h4 style={{ margin: 0 }}>Why this matters</h4>
      <p><em>A short list of things you’re grateful for nudges your brain toward what’s working.</em></p>

      <h4 style={{ margin: 0 }}>How to use</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Tap <b>Today</b>, or pick a date.</li>
        <li>Fill any of the 1–8 prompts with a short sentence.</li>
        <li>Tiny, honest entries beat perfect ones.</li>
      </ol>

      <h4 style={{ margin: 0 }}>Alfred’s tip</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Include one thing you’re grateful to <b>yourself</b> for — it builds self-respect.</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Your entries save on blur. If offline, they’re cached locally and auto-retried.
      </p>
    </div>
  );
}

/* ---------- Constants ---------- */
type Idx = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const INDEXES: Idx[] = [1,2,3,4,5,6,7,8];
const SIMPLE_PLACEHOLDER = "Today I’m grateful for…";
const PROMPTS = [
  "A person who helped me this week",
  "A small win from today",
  "Something in nature I noticed",
  "A habit I’m proud of",
  "A comfort at home",
  "A skill I get to use",
  "A challenge that’s teaching me",
  "A little moment that made me smile",
];

/* ---------- Local unsynced cache helpers ---------- */
function lsKey(userId: string, dateISO: string) { return `byb:gratitude:unsynced:${userId}:${dateISO}`; }
type UnsyncedMap = Record<number, string>;

/* ---------- Component ---------- */
export default function GratitudeScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(() => toISO(new Date()));

  const [rowsByIdx, setRowsByIdx] = useState<Record<number, EntryRow | null>>({});
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [history, setHistory] = useState<Record<string, EntryRow[]>>({});
  const [streak, setStreak] = useState(0);
  const [resurface, setResurface] = useState<EntryRow | null>(null);

  // Alfred modal
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  // per-field local unsynced state
  const [unsynced, setUnsynced] = useState<UnsyncedMap>({});

  // mounted guard
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const safeSet = <T,>(setter: (v: T | ((p: T)=>T)) => void, val: any) => { if (alive.current) setter(val); };

  /* ---------- Init & load ---------- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      safeSet(setUserId, data.user?.id ?? null);
    });
  }, []);

  useEffect(() => { if (userId) { loadDay(dateISO); loadHistoryAndStats(); loadUnsynced(userId, dateISO); } }, [userId, dateISO]);

  function initMaps(withRows: EntryRow[]) {
    const rb: Record<number, EntryRow | null> = {};
    const dr: Record<number, string> = {};
    INDEXES.forEach(i => { rb[i] = null; dr[i] = ""; });
    withRows.forEach(r => { rb[r.item_index] = r; dr[r.item_index] = r.content ?? ""; });
    safeSet(setRowsByIdx, rb);
    safeSet(setDraft, dr);
  }

  async function loadDay(iso: string) {
    if (!userId) return;
    setErr(null); setLoading(true);
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("id,user_id,entry_date,item_index,content")
      .eq("user_id", userId)
      .eq("entry_date", iso)
      .order("item_index", { ascending: true });
    setLoading(false);
    if (error) { setErr(error.message); initMaps([]); return; }
    initMaps((data as EntryRow[]) || []);
  }

  async function loadHistoryAndStats() {
    if (!userId) return;
    const since = new Date(); since.setDate(since.getDate() - 60);
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("id,user_id,entry_date,item_index,content")
      .eq("user_id", userId)
      .gte("entry_date", toISO(since))
      .order("entry_date", { ascending: false })
      .order("item_index", { ascending: true });
    if (error) { setErr(error.message); safeSet(setHistory, {}); return; }

    const grouped: Record<string, EntryRow[]> = {};
    (data as EntryRow[]).forEach(r => { (grouped[r.entry_date] ||= []).push(r); });
    safeSet(setHistory, grouped);

    // Streak (consecutive days up to today with >=1 entry)
    let s = 0;
    let cursor = toISO(new Date());
    while (grouped[cursor] && grouped[cursor].length > 0) {
      s += 1;
      cursor = addDays(cursor, -1);
    }
    safeSet(setStreak, s);

    // Resurface (random past entry, not today)
    const pastDays = Object.keys(grouped).filter(d => d !== toISO(new Date()) && grouped[d] && grouped[d].length > 0);
    if (pastDays.length > 0) {
      const day = pastDays[Math.floor(Math.random() * pastDays.length)];
      const rows = grouped[day];
      const pick = rows[Math.floor(Math.random() * rows.length)];
      safeSet(setResurface, pick);
    } else {
      safeSet(setResurface, null);
    }
  }

  /* ---------- Local unsynced persistence ---------- */
  function loadUnsynced(uid: string, iso: string) {
    try {
      const raw = localStorage.getItem(lsKey(uid, iso));
      const map = raw ? (JSON.parse(raw) as UnsyncedMap) : {};
      setUnsynced(map || {});
    } catch { setUnsynced({}); }
  }
  function persistUnsynced(next: UnsyncedMap) {
    if (!userId) return;
    localStorage.setItem(lsKey(userId, dateISO), JSON.stringify(next));
  }
  function markUnsynced(idx: number, content: string) {
    setUnsynced(prev => {
      const next = { ...prev, [idx]: content };
      persistUnsynced(next);
      return next;
    });
  }
  function clearUnsynced(idx: number) {
    setUnsynced(prev => {
      const next = { ...prev };
      delete next[idx];
      persistUnsynced(next);
      return next;
    });
  }

  /* ---------- Save one line ---------- */
  async function saveIdx(idx: Idx) {
    if (!userId) return;
    const content = (draft[idx] || "").trim();
    setSavingIdx(idx); setErr(null);

    const existing = rowsByIdx[idx];

    try {
      if (!content) {
        if (existing) {
          const { error } = await supabase.from("gratitude_entries").delete().eq("id", existing.id);
          if (error) throw error;
        }
        setRowsByIdx(prev => ({ ...prev, [idx]: null }));
        clearUnsynced(idx);
      } else if (existing) {
        const { error } = await supabase
          .from("gratitude_entries")
          .update({ content })
          .eq("id", existing.id);
        if (error) throw error;
        setRowsByIdx(prev => ({ ...prev, [idx]: { ...(prev[idx] as EntryRow), content } }));
        clearUnsynced(idx);
      } else {
        const { data, error } = await supabase
          .from("gratitude_entries")
          .insert({ user_id: userId, entry_date: dateISO, item_index: idx, content })
          .select("id,user_id,entry_date,item_index,content")
          .single();
        if (error) throw error;
        setRowsByIdx(prev => ({ ...prev, [idx]: data as EntryRow }));
        clearUnsynced(idx);
      }

      // refresh history (streak/resurface) in the background
      loadHistoryAndStats();
    } catch (e: any) {
      const msg = (e?.message || String(e)) as string;
      if (msg.includes('no field "updated_at"')) {
        markUnsynced(idx, content);
        setErr(null);
      } else {
        setErr(msg);
      }
    } finally {
      setSavingIdx(null);
    }
  }

  async function retrySyncAll() {
    const entries = Object.entries(unsynced);
    for (const [k, val] of entries) {
      const idx = Number(k) as Idx;
      setDraft(d => ({ ...d, [idx]: val }));
      await saveIdx(idx);
    }
  }

  /* ---------- UI helpers ---------- */
  function gotoToday() { setDateISO(toISO(new Date())); }
  function gotoPrev()  { setDateISO(addDays(dateISO, -1)); }
  function gotoNext()  { setDateISO(addDays(dateISO, 1)); }

  const countToday = useMemo(
    () => INDEXES.reduce((n, i) => n + (rowsByIdx[i] ? 1 : 0), 0),
    [rowsByIdx]
  );

  const promptOfTheDay = useMemo(() => {
    const seed = Number(dateISO.replace(/-/g, "")) % PROMPTS.length;
    return PROMPTS[seed];
  }, [dateISO]);

  async function exportCSV() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("entry_date,item_index,content")
      .eq("user_id", userId)
      .order("entry_date", { ascending: true })
      .order("item_index", { ascending: true });
    if (error) { setErr(error.message); return; }
    const rows = [["date", "item_index", "content"]];
    (data as any[]).forEach(r => rows.push([r.entry_date, String(r.item_index), String(r.content || "").replace(/\r?\n/g, " ")]));
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "gratitude.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- UI ---------- */
  return (
    <div className="page-gratitude" style={{ display: "grid", gap: 12 }}>
      {/* Title card with Alfred */}
      <div className="card" style={{ position: "relative", paddingRight: 64 }}>
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Gratitude help"
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
              src={GRAT_ALFRED_SRC}
              alt="Gratitude Alfred — open help"
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
        <h1 style={{ margin: 0 }}>Gratitude Journal</h1>
      </div>

      {/* Toolbar – your requested layout */}
      <div className="card" style={{ display: "grid", gap: 8 }}>
        {/* Row 1: Today + streak */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <button onClick={gotoToday} className="btn-primary" style={{ borderRadius: 8 }}>Today</button>
          <div className="muted" title="Current streak of consecutive days">
            🔥 {streak} day{streak === 1 ? "" : "s"} streak
          </div>
        </div>
        {/* Row 2: ← date → + count */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={gotoPrev} aria-label="Previous day">←</button>
          <input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />
          <button onClick={gotoNext} aria-label="Next day">→</button>
          <div className="muted" style={{ marginLeft: "auto" }}>{countToday}/8 for this day</div>
        </div>
        {/* Row 3: Prompt of the day */}
        <div className="muted" style={{ fontStyle: "italic" }}>Prompt: {promptOfTheDay}</div>
      </div>

      {/* Resurface past entry */}
      {resurface && (
        <div className="card" style={{ display: "grid", gap: 6 }}>
          <div className="section-title">From your past</div>
          <div className="muted" style={{ fontSize: 12 }}>{resurface.entry_date}</div>
          <div>{resurface.content}</div>
        </div>
      )}

      {/* Editor (mobile-first single column) */}
      <div className="card card--wash" style={{ display: "grid", gap: 10 }}>
        {INDEXES.map((idx) => {
          const localUnsynced = unsynced[idx] != null;
          const ph = PROMPTS[idx - 1] || SIMPLE_PLACEHOLDER;
          return (
            <div key={idx} style={{ display: "grid", gap: 6 }}>
              <div className="section-title">Gratitude {idx}</div>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder={ph}
                value={draft[idx] ?? ""}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setDraft((d) => ({ ...d, [idx]: v }));
                }}
                onBlur={() => saveIdx(idx)}
                disabled={loading || savingIdx === idx}
                aria-label={`Gratitude ${idx}`}
              />
              {savingIdx === idx && <span className="muted">Saving…</span>}
              {localUnsynced && savingIdx !== idx && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Saved locally — will sync when possible.{" "}
                  <button className="btn-soft" onClick={() => saveIdx(idx)}>Retry now</button>
                </div>
              )}
            </div>
          );
        })}

        {Object.keys(unsynced).length > 0 && (
          <div className="muted" style={{ marginTop: 4 }}>
            {Object.keys(unsynced).length} item(s) waiting to sync.{" "}
            <button className="btn-soft" onClick={retrySyncAll}>Retry all</button>
          </div>
        )}

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* Recent days list */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Recent days</h2>
          <button className="btn-soft" onClick={exportCSV}>Export CSV</button>
        </div>
        <div style={{ overflow: "auto", maxHeight: "50vh" }}>
          <ul className="list">
            {Object.keys(history).length === 0 && <li className="muted">No recent entries.</li>}
            {Object.entries(history).map(([d, rows]) => (
              <li key={d} className="item" style={{ alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{d}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {(rows || []).map(r => r.content).slice(0, 2).join(" · ")}
                    {rows.length > 2 ? " · …" : ""}
                  </div>
                </div>
                <button onClick={() => setDateISO(d)}>Open</button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Gratitude — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {imgOk && <img src={GRAT_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
          <div style={{ flex: 1 }}>
            <GratitudeHelpContent />
          </div>
        </div>
      </Modal>
    </div>
  );
}
