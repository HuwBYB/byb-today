import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types ---------- */
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
function addDaysISO(iso: string, days: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}
function diffDays(aISO: string, bISO: string) {
  const a = fromISO(aISO), b = fromISO(bISO);
  return Math.round((+b - +a) / 86400000);
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
      <p><em>“A short list of things you’re grateful for nudges your brain toward what’s working.”</em></p>

      <h4 style={{ margin: 0 }}>How to use</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Tap <b>Today</b> (or pick a date).</li>
        <li>Use a prompt or write your own — short is perfect.</li>
        <li>Keep your streak alive 🔥</li>
      </ol>

      <h4 style={{ margin: 0 }}>Alfred’s tip</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Add one thing you’re grateful to <b>yourself</b> for — it builds self-respect.</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Entries save on blur. If you go offline, they’re stored locally and retried.
      </p>
    </div>
  );
}

/* ---------- Constants ---------- */
type Idx = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const INDEXES: Idx[] = [1,2,3,4,5,6,7,8];
const SIMPLE_PLACEHOLDER = "Today I’m grateful for…";

/* Daily prompt bank */
const PROMPTS = [
  "A person who helped me recently",
  "Something in nature I noticed today",
  "A tiny win from the last 24h",
  "A comfort at home I love",
  "A lesson a mistake taught me",
  "A part of my body that’s working hard",
  "Someone I can always text/call",
  "A skill I’ve improved",
  "A memory that still makes me smile",
  "A freedom I often forget I have",
  "A tool or app that saves me time",
  "Something about my work I appreciate",
  "Food or drink that lifted my mood",
  "A song/podcast/book I enjoyed",
  "An act of kindness I witnessed",
  "Something I’m excited to learn",
  "A place that makes me feel calm",
  "A problem that didn’t happen",
  "A challenge I handled better than before",
  "A habit I’m proud I kept today",
];

/* ---------- Local unsynced cache helpers ---------- */
function lsKey(userId: string, dateISO: string) { return `byb:gratitude:unsynced:${userId}:${dateISO}`; }
type UnsyncedMap = Record<number, string>;

/* ========================== MAIN ========================== */
export default function GratitudeScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(() => toISO(new Date()));

  const [rowsByIdx, setRowsByIdx] = useState<Record<number, EntryRow | null>>({});
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [history, setHistory] = useState<Record<string, EntryRow[]>>({});

  // Alfred modal
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  // per-field local unsynced state
  const [unsynced, setUnsynced] = useState<UnsyncedMap>({});

  // Streaks
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  // Daily prompts
  const [promptSet, setPromptSet] = useState<string[]>([]);

  // “From the vault”
  const [vaultPool, setVaultPool] = useState<Array<{ entry_date: string; content: string }>>([]);
  const [vaultItem, setVaultItem] = useState<{ entry_date: string; content: string } | null>(null);

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

  useEffect(() => {
    if (userId) {
      loadDay(dateISO);
      loadHistoryAndStats();
      loadUnsynced(userId, dateISO);
      seedPromptsFor(dateISO);
    }
  }, [userId, dateISO]);

  function seedPromptsFor(iso: string) {
    // Deterministic 3 prompts per day (but allow shuffle)
    const dayNumber = Math.abs(Math.floor(fromISO(iso).getTime() / 86400000));
    const a = PROMPTS[dayNumber % PROMPTS.length];
    const b = PROMPTS[(dayNumber + 5) % PROMPTS.length];
    const c = PROMPTS[(dayNumber + 11) % PROMPTS.length];
    setPromptSet([a, b, c]);
  }
  function shufflePrompts() {
    const arr = [...PROMPTS];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setPromptSet(arr.slice(0, 3));
  }
  function usePrompt(p: string) {
    // put into next empty slot, then save
    const empty = INDEXES.find(i => (draft[i] ?? "").trim() === "");
    const idx = empty ?? 8;
    setDraft(d => ({ ...d, [idx]: p }));
    // save after state settles
    setTimeout(() => saveIdx(idx), 0);
  }

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
    const today = toISO(new Date());
    const since = addDaysISO(today, -365);
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("entry_date,item_index,content")
      .eq("user_id", userId)
      .gte("entry_date", since)
      .lte("entry_date", today)
      .order("entry_date", { ascending: true })
      .limit(2000); // generous cap
    if (error) { setErr(error.message); safeSet(setHistory, {}); return; }

    const rows = (data as EntryRow[]) || [];
    const grouped: Record<string, EntryRow[]> = {};
    rows.forEach(r => { (grouped[r.entry_date] ||= []).push(r); });
    safeSet(setHistory, grouped);

    // streaks (unique days with >=1 entry)
    const dates = Object.keys(grouped).filter(d => grouped[d].some(r => (r.content || "").trim().length > 0));
    const set = new Set(dates);

    // current streak: count back from today
    let cur = 0;
    let cursor = today;
    while (set.has(cursor)) {
      cur += 1;
      cursor = addDaysISO(cursor, -1);
    }
    setStreak(cur);

    // best streak: scan the year
    let best = 0, run = 0, prev: string | null = null;
    dates.sort(); // ascending
    for (const d of dates) {
      if (prev && diffDays(prev, d) === 1) run += 1;
      else run = 1;
      best = Math.max(best, run);
      prev = d;
    }
    setBestStreak(best);

    // “From the vault”
    const pool = rows
      .filter(r => (r.content || "").trim().length > 0 && r.entry_date < today)
      .map(r => ({ entry_date: r.entry_date, content: r.content }));
    setVaultPool(pool);
    pickVault(pool);
  }

  function pickVault(pool = vaultPool) {
    if (!pool || pool.length === 0) { setVaultItem(null); return; }
    const i = Math.floor(Math.random() * pool.length);
    setVaultItem(pool[i]);
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

      // refresh stats quickly (don’t block UI)
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
  function gotoPrev()  { const d = fromISO(dateISO); d.setDate(d.getDate() - 1); setDateISO(toISO(d)); }
  function gotoNext()  { const d = fromISO(dateISO); d.setDate(d.getDate() + 1); setDateISO(toISO(d)); }

  const countToday = useMemo(
    () => INDEXES.reduce((n, i) => n + (rowsByIdx[i] ? 1 : 0), 0),
    [rowsByIdx]
  );

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

  /* ---------- Styles (small mobile tweaks) ---------- */
  const styles = (
    <style>{`
      .g-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap }
      .g-pill { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; background:#f1f5f9; border:1px solid #e5e7eb; font-size:12px }
      .g-prompts { display:flex; gap:6px; flex-wrap:wrap }
      .g-chip { padding:6px 10px; border-radius:999px; border:1px solid #d1d5db; background:#fff; font-size:12px }
      .g-chip:active { transform: scale(0.98) }
      .g-vault { border:1px dashed #cbd5e1; background:#f8fafc; border-radius:10px; padding:10px }
    `}</style>
  );

  return (
    <div className="page-gratitude" style={{ display: "grid", gap: 12 }}>
      {styles}

      {/* Title card with Alfred */}
      <div className="card" style={{ position: "relative", paddingRight: 64 }}>
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Gratitude help"
          title="Need a hand? Ask Alfred"
          style={{ position: "absolute", top: 8, right: 8, border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10 }}
        >
          {imgOk ? (
            <img src={GRAT_ALFRED_SRC} alt="Gratitude Alfred — open help" style={{ width: 48, height: 48 }} onError={() => setImgOk(false)} />
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700 }}>?</span>
          )}
        </button>
        <h1 style={{ margin: 0 }}>Gratitude Journal</h1>
        <div className="g-toolbar" style={{ marginTop: 8 }}>
          <div className="g-pill" title="Current streak">🔥 {streak} day{streak===1?"":"s"}</div>
          <div className="g-pill" title="Best streak">🏅 Best: {bestStreak}</div>
          <div className="g-pill">{countToday}/8 today</div>
        </div>
      </div>

      {/* Toolbar (date + export) */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="g-toolbar">
          <button onClick={gotoToday}>Today</button>
          <button onClick={gotoPrev} aria-label="Previous day">←</button>
          <input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />
          <button onClick={gotoNext} aria-label="Next day">→</button>
          <button className="btn-soft" onClick={exportCSV} style={{ marginLeft: "auto" }}>Export CSV</button>
        </div>

        {/* Daily prompts */}
        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>Today’s prompts</div>
          <div className="g-prompts">
            {promptSet.map((p, i) => (
              <button key={i} className="g-chip" onClick={() => usePrompt(p)} title="Tap to add to the next empty line">
                {p}
              </button>
            ))}
            <button className="g-chip" onClick={shufflePrompts} title="Shuffle prompts">↻ Shuffle</button>
          </div>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* Editor */}
      <div className="card card--wash" style={{ display: "grid", gap: 10 }}>
        {INDEXES.map((idx) => {
          const localUnsynced = unsynced[idx] != null;
          return (
            <div key={idx} style={{ display: "grid", gap: 6 }}>
              <div className="section-title">Gratitude {idx}</div>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder={SIMPLE_PLACEHOLDER}
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
      </div>

      {/* From the vault (random resurfacing) */}
      <div className="card">
        <div className="g-vault">
          <div className="section-title" style={{ marginBottom: 6 }}>From the vault</div>
          {!vaultItem ? (
            <div className="muted">No past entries yet. Your throwbacks will appear here.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              <div className="muted">{vaultItem.entry_date}</div>
              <div style={{ fontWeight: 600 }}>{vaultItem.content}</div>
              <div>
                <button className="btn-soft" onClick={() => pickVault()}>Another</button>
                <button className="btn-soft" style={{ marginLeft: 8 }} onClick={() => setDateISO(vaultItem.entry_date)}>Open day</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent history list (last year grouped; still compact for mobile) */}
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Recent days</h2>
        <ul className="list">
          {Object.keys(history).length === 0 && <li className="muted">No recent entries.</li>}
          {Object.entries(history).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30).map(([d, rows]) => (
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
