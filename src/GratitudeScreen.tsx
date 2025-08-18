import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

// Public path helper (Vite/CRA/Vercel/GH Pages)
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

// ---------- Lightweight modal ----------
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

// ---------- Inline help content ----------
function GratitudeHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <h4 style={{ margin: 0 }}>Introduction / Motivation</h4>
      <p><em>“A gratitude Journal is an amazing tool for your well being. Writing down things that you are grateful for can greatly enhance your positivity.”</em></p>

      <h4 style={{ margin: 0 }}>Step-by-Step Guidance</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Write something you are grateful for.</li>
        <li>Write something else you are grateful for.</li>
        <li>Write something… this one is quite simple!</li>
      </ol>

      <h4 style={{ margin: 0 }}>Alfred’s Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>If you sometimes focus on things that you are grateful to yourself for it can help your self esteem.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Closing Note</h4>
      <p><em>“Reflecting on what you are grateful for can improve mindfulness.”</em></p>
    </div>
  );
}

type Idx = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const INDEXES: Idx[] = [1, 2, 3, 4, 5, 6, 7, 8];

// Single, simple placeholder (per your request)
const SIMPLE_PLACEHOLDER = "Today I’m grateful for…";

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

  // prevent setState-after-unmount warnings/crashes
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Non-generic, inference-proof setter wrapper
  function safeSet(setter: any, val: any) {
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
    for (const r of (data as EntryRow[])) (grouped[r.entry_date] ||= []).push(r);
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
        safeSet(setRowsByIdx, (prev: any) => ({ ...prev, [idx]: null } as any));
      } else {
        const payload = { user_id: userId, entry_date: dateISO, item_index: idx, content };
        const { data, error } = await supabase
          .from("gratitude_entries")
          .upsert(payload as any, { onConflict: "user_id,entry_date,item_index" })
          .select()
          .single();
        if (error) throw error;
        safeSet(setRowsByIdx, (prev: any) => ({ ...prev, [idx]: data as EntryRow } as any));
      }
      // refresh history (async, fire-and-forget)
      loadHistory();
    } catch (e: any) {
      console.error(e);
      setErr(e.message || String(e));
    } finally {
      safeSet(setSavingIdx, null);
    }
  }

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
      .select("*")
      .eq("user_id", userId)
      .order("entry_date", { ascending: true })
      .order("item_index", { ascending: true });
    if (error) { setErr(error.message); return; }
    const rows = [["date", "item_index", "content"]];
    for (const r of (data as EntryRow[])) rows.push([r.entry_date, String(r.item_index), (r.content || "").replace(/\r?\n/g, " ")]);
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "gratitude.csv"; a.click();
    URL.revokeObjectURL(url);
  }

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

      {/* Main layout */}
      <div className="gratitude-layout">
        {/* Left: editor */}
        <div className="card card--wash">
          {/* toolbar */}
          <div className="gratitude-toolbar" style={{ marginTop: 0, marginBottom: 12 }}>
            <button onClick={gotoToday}>Today</button>
            <button onClick={gotoPrev}>←</button>
            <input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />
            <button onClick={gotoNext}>→</button>
            <div className="gratitude-count muted">{countToday}/8 for this day</div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {INDEXES.map((idx) => (
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
                    safeSet(setDraft, (d: any) => ({ ...d, [idx]: v }));
                  }}
                  onBlur={() => saveIdx(idx)}
                  disabled={loading || savingIdx === idx}
                  aria-label={`Gratitude ${idx}`}
                />
                {savingIdx === idx && <span className="muted">Saving…</span>}
              </div>
            ))}
          </div>

          {err && <div style={{ color: "red", marginTop: 10 }}>{err}</div>}
        </div>

        {/* Right: history */}
        <aside className="card" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Recent days</h2>
          <div style={{ overflow: "auto", maxHeight: "60vh" }}>
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

          {/* actions */}
          <div className="gratitude-actions">
            <button className="btn-primary" onClick={exportCSV}>Export CSV</button>
          </div>
        </aside>
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
