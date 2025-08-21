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
function isoAddDays(iso: string, delta: number) {
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
      <p><em>“A short list of things you’re grateful for nudges your brain toward what’s working.”</em></p>

      <h4 style={{ margin: 0 }}>How to use</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Tap <b>Today</b>, then use the arrows or date to navigate.</li>
        <li>Fill any of the 1–8 lines with short, specific entries.</li>
        <li>Use prompts to spark ideas; your streak grows automatically.</li>
      </ol>

      <h4 style={{ margin: 0 }}>Alfred’s tip</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Include one thing you’re grateful to <b>yourself</b> for — it builds self-respect.</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Entries save when a field loses focus. If you go offline, we keep your text locally and retry later.
      </p>
    </div>
  );
}

/* ---------- Constants ---------- */
type Idx = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const INDEXES: Idx[] = [1,2,3,4,5,6,7,8];
const SIMPLE_PLACEHOLDER = "Today I’m grateful for…";

/* Prompts */
const PROMPT_CATALOGUE = [
  "A person who helped me recently",
  "Something about my health/body",
  "A small win from today",
  "A lesson I learned",
  "Something in my environment",
  "A freedom/privilege I enjoy",
  "Progress I made on a goal",
  "Someone I appreciate from the past",
  "An ability/skill I used",
  "A piece of good news",
  "A kindness I received/gave",
  "Something I’m looking forward to",
];
function pickN<T>(arr: T[], n: number) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/* ---------- Local unsynced cache ---------- */
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

  // history for streaks & resurfacing (last 120 days)
  const [history, setHistory] = useState<Record<string, EntryRow[]>>({});

  // prompts
  const [promptSet, setPromptSet] = useState<string[]>(() => pickN(PROMPT_CATALOGUE, 6));

  // resurfacing
  const [surfaced, setSurfaced] = useState<{ date: string; content: string } | null>(null);

  // Alfred modal
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  // per-field local unsynced state
  const [unsynced, setUnsynced] = useState<UnsyncedMap>({});

  // inputs refs (optional focus after using a prompt)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

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
      loadHistory();
      loadUnsynced(userId, dateISO);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dateISO]);

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

  async function loadHistory() {
    if (!userId) return;
    const since = new Date(); since.setDate(since.getDate() - 120);
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

    // seed resurfacing
    surfaceRandom(grouped);
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

  /* ---------- Save one line (insert OR update) ---------- */
  async function saveIdx(idx: Idx) {
    if (!userId) return;
    const content = (draft[idx] || "").trim();
    setSavingIdx(idx); setErr(null);

    const existing = rowsByIdx[idx];

    try {
      if (!content) {
        // delete if existed
        if (existing) {
          const { error } = await supabase.from("gratitude_entries").delete().eq("id", existing.id);
          if (error) throw error;
        }
        setRowsByIdx(prev => ({ ...prev, [idx]: null }));
        clearUnsynced(idx);
      } else if (existing) {
        // UPDATE
        const { error } = await supabase
          .from("gratitude_entries")
          .update({ content })
          .eq("id", existing.id);
        if (error) throw error;
        setRowsByIdx(prev => ({ ...prev, [idx]: { ...(prev[idx] as EntryRow), content } }));
        clearUnsynced(idx);
      } else {
        // INSERT
        const { data, error } = await supabase
          .from("gratitude_entries")
          .insert({ user_id: userId, entry_date: dateISO, item_index: idx, content })
          .select("id,user_id,entry_date,item_index,content")
          .single();
        if (error) throw error;
        setRowsByIdx(prev => ({ ...prev, [idx]: data as EntryRow }));
        clearUnsynced(idx);
      }

      // refresh history (streaks) quietly
      loadHistory();
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
  function gotoPrev()  { setDateISO(isoAddDays(dateISO, -1)); }
  function gotoNext()  { setDateISO(isoAddDays(dateISO, +1)); }

  const countToday = useMemo(
    () => INDEXES.reduce((n, i) => n + (rowsByIdx[i] ? 1 : 0), 0),
    [rowsByIdx]
  );

  /* ---------- Streaks ---------- */
  const { currentStreak, bestStreak } = useMemo(() => {
    // Build a set of days with >=1 entries (include current day state)
    const set = new Set<string>(Object.keys(history).filter(d => (history[d] || []).length > 0));
    if (countToday > 0) set.add(dateISO);

    // current streak: go backwards from today
    let cur = 0;
    let probe = dateISO;
    while (set.has(probe)) {
      cur += 1;
      probe = isoAddDays(probe, -1);
    }

    // best streak: scan last 120 days
    let best = 0;
    let running = 0;
    const start = isoAddDays(toISO(new Date()), -120);
    let day = start;
    const today = toISO(new Date());
    while (day <= today) {
      if (set.has(day)) {
        running += 1;
        if (running > best) best = running;
      } else {
        running = 0;
      }
      day = isoAddDays(day, +1);
    }

    return { currentStreak: cur, bestStreak: best };
  }, [history, dateISO, countToday]);

  /* ---------- Prompts ---------- */
  function shufflePrompts() {
    setPromptSet(pickN(PROMPT_CATALOGUE, 6));
  }
  function usePrompt(text: string) {
    // Fill the next empty line
    const nextEmpty = INDEXES.find(i => !draft[i]?.trim());
    if (!nextEmpty) return;
    setDraft(d => ({ ...d, [nextEmpty]: text }));
    // focus that input
    const ref = inputRefs.current[nextEmpty - 1];
    if (ref) ref.focus();
  }

  /* ---------- Resurfacing ---------- */
  function surfaceRandom(grouped: Record<string, EntryRow[]>) {
    const dates = Object.keys(grouped).filter(d => d !== dateISO && (grouped[d] || []).length > 0);
    if (dates.length === 0) { setSurfaced(null); return; }
    const pickDate = dates[Math.floor(Math.random() * dates.length)];
    const items = grouped[pickDate] || [];
    const item = items[Math.floor(Math.random() * items.length)];
    setSurfaced({ date: pickDate, content: item?.content || "" });
  }

  /* ---------- Export ---------- */
  async function exportCSV() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("gratitude_entries")
      .select("entry_date,item_index,content")
      .eq("user_id", userId)
      .order("entry_date", { ascending: true })
      .order("item_index", { ascending: true });
    if (error) { setErr(error.message); return; }
    const rows = [["date", "item_index", "content
