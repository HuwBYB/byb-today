import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types ---------- */
type Session = {
  id: number;
  user_id: string;
  session_date: string; // YYYY-MM-DD
  start_time: string | null;
  notes: string | null;
};

type Item = {
  id: number;
  session_id: number;
  user_id: string;
  kind: "weights" | "run" | "jog" | "walk" | "yoga" | "class" | "other" | string;
  title: string;
  order_index: number;
  metrics: any;
};

type WSet = {
  id: number;
  item_id: number;
  user_id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  duration_sec: number | null;
};

type PrevEntry = {
  date: string;
  sets: Array<{ weight_kg: number | null; reps: number | null; duration_sec: number | null }>;
};

/* Templates */
type TemplateRow = {
  id: number;
  name: string;
  data: {
    items: Array<{
      title: string;
      sets: number;
      weights?: (number | null)[];
      reps?: (number | null)[];
    }>;
  };
};

/* ---------- Path + date helpers ---------- */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}
const EX_ALFRED_SRC = publicPath("/alfred/Exercise_Alfred.png");

function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m ?? 1) - 1, d ?? 1); }
function secondsToMMSS(sec?: number | null) {
  if (!sec || sec <= 0) return "00:00";
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function mmssToSeconds(v: string) {
  const [m, s] = v.split(":").map(n => Number(n || 0));
  return (isFinite(m) ? m : 0) * 60 + (isFinite(s) ? s : 0);
}
function paceStr(distanceKm?: number, durSec?: number) {
  if (!distanceKm || !durSec || distanceKm <= 0) return "";
  const secPerKm = Math.round(durSec / distanceKm);
  return `${secondsToMMSS(secPerKm)}/km`;
}
const FIN_KEY = (sid: number, dateISO: string) => `byb_session_finished_${sid}_${dateISO}`;

/* ---------- Lightweight modal ---------- */
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
        style={{ maxWidth: 780, width: "100%", background: "#fff", borderRadius: 12,
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

/* ---------- Inlined help content ---------- */
function ExerciseHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>“Exercise should be part of everyone’s life — whether that’s a short walk or a full workout.”</em></p>

      <h4 style={{ margin: 0 }}>Quick start</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Pick a day (or tap <b>Today</b>) and hit <b>Start session</b>.</li>
        <li>Use <b>Quick add</b> to log what you’re doing:
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
            <li><b>Weights</b>: type the exercise name and add sets.</li>
            <li><b>Run/Jog/Walk/Yoga/Class</b>: add <i>duration</i> and (optionally) <i>distance</i>.</li>
          </ul>
        </li>
        <li>When you’re done, tap <b>Complete session</b>.</li>
      </ol>

      <h4 style={{ margin: 0 }}>Weights workflow</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Enter a clear exercise title (e.g., “Bench Press”). Titles are <b>case-sensitive</b> when matching history.</li>
        <li>Add sets, then record <b>kg</b> and <b>reps</b>. Use “Show previous” to view past sessions for the same title and “Copy last sets” to prefill.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Cardio & classes</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Log <b>duration</b> (mm:ss) and <b>distance</b> (km) if relevant — pace is calculated automatically.</li>
        <li>For classes, give it a title (e.g., “Spin Class”) so you can find it later.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Notes & history</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Use <b>Notes</b> to capture how it felt, form cues, or injuries.</li>
        <li>The <b>Recent</b> panel lets you reopen past days quickly.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Tips from Alfred</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Small sessions count. Five minutes is better than zero.</li>
        <li>Be consistent with exercise names to keep history tidy.</li>
        <li>Progress ≠ heavier every time; better form and more reps also win.</li>
      </ul>

      <p><strong>Closing note:</strong> Log honestly, celebrate consistency, and let the data nudge you forward.</p>
    </div>
  );
}

/* ---------- Main ---------- */
export default function ExerciseDiaryScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState(() => toISO(new Date()));

  // NEW: keep all sessions for the selected day + the active one
  const [sessionsToday, setSessionsToday] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [setsByItem, setSetsByItem] = useState<Record<number, WSet[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [recent, setRecent] = useState<Session[]>([]);

  // history preview
  const [openHistoryFor, setOpenHistoryFor] = useState<Record<number, boolean>>({});
  const [loadingPrevFor, setLoadingPrevFor] = useState<Record<number, boolean>>({});
  const [prevByItem, setPrevByItem] = useState<Record<number, PrevEntry[]>>({});

  // help modal
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  // collapsed
  const [finished, setFinished] = useState(false);

  // backup
  const [offerBackup, setOfferBackup] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  // sticky quick-add (weights)
  const [stickyTitle, setStickyTitle] = useState("");

  /* === Debounced saver for workout_sets === */
  const DEBOUNCE_MS = 300;
  const setTimers = useRef<Record<number, number>>({});
  const pendingSetPatches = useRef<Record<number, Partial<WSet>>>({});

  const commitSetPatch = useCallback(async (id: number) => {
    const patch = pendingSetPatches.current[id];
    delete pendingSetPatches.current[id];
    if (!patch) return;
    const { error } = await supabase.from("workout_sets").update(patch).eq("id", id);
    if (error) setErr(error.message);
  }, []);

  const queueSetSave = useCallback((id: number, patch: Partial<WSet>) => {
    pendingSetPatches.current[id] = { ...(pendingSetPatches.current[id] || {}), ...patch };
    if (setTimers.current[id]) window.clearTimeout(setTimers.current[id]);
    setTimers.current[id] = window.setTimeout(() => { commitSetPatch(id); }, DEBOUNCE_MS) as unknown as number;
  }, [commitSetPatch]);

  const flushSetSaves = useCallback(async (id?: number) => {
    const ids = id == null ? Object.keys(pendingSetPatches.current).map(Number) : [id];
    for (const k of ids) {
      if (setTimers.current[k]) window.clearTimeout(setTimers.current[k]);
      await commitSetPatch(k);
    }
  }, [commitSetPatch]);

  /* === Debounced rename for item titles (fixes typing lag) === */
  const TITLE_DEBOUNCE_MS = 450;
  const titleTimers = useRef<Record<number, number>>({});
  const pendingTitles = useRef<Record<number, string>>({});

  const commitTitle = useCallback(async (id: number) => {
    const title = pendingTitles.current[id];
    delete pendingTitles.current[id];
    if (title == null) return;
    const { error } = await supabase.from("workout_items").update({ title }).eq("id", id);
    if (error) setErr(error.message);
  }, []);

  const queueTitleSave = useCallback((id: number, title: string) => {
    pendingTitles.current[id] = title;
    if (titleTimers.current[id]) window.clearTimeout(titleTimers.current[id]);
    titleTimers.current[id] = window.setTimeout(() => { commitTitle(id); }, TITLE_DEBOUNCE_MS) as unknown as number;
  }, [commitTitle]);

  const flushTitleSaves = useCallback(async (id?: number) => {
    const ids = id == null ? Object.keys(pendingTitles.current).map(Number) : [id];
    for (const k of ids) {
      if (titleTimers.current[k]) window.clearTimeout(titleTimers.current[k]);
      await commitTitle(k);
    }
  }, [commitTitle]);

  // flush pending saves on unmount/nav
  useEffect(() => () => { flushSetSaves().catch(() => {}); flushTitleSaves().catch(() => {}); }, [flushSetSaves, flushTitleSaves]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => { if (userId) { loadSessionsForDay(dateISO); loadRecent(); checkOfferBackup(); } }, [userId, dateISO]);

  useEffect(() => {
    if (session) {
      const val = localStorage.getItem(FIN_KEY(session.id, dateISO));
      setFinished(val === "1");
    } else {
      setFinished(false);
    }
  }, [session?.id, dateISO]);

  /* ----- Loaders ----- */
  async function loadSessionsForDay(iso: string) {
    if (!userId) return;
    setErr(null);
    const { data, error } = await supabase
      .from("workout_sessions").select("*")
      .eq("user_id", userId).eq("session_date", iso)
      .order("id", { ascending: true });
    if (error) {
      setErr(error.message);
      setSessionsToday([]);
      setSession(null);
      setItems([]);
      setSetsByItem({});
      return;
    }
    const list = (data as Session[]) || [];
    setSessionsToday(list);
    const active = list.length ? list[list.length - 1] : null; // pick the newest (highest id)
    setSession(active);
    if (active) await loadItems(active.id); else { setItems([]); setSetsByItem({}); }
  }

  async function loadItems(sessionId: number) {
    const { data, error } = await supabase
      .from("workout_items").select("*")
      .eq("session_id", sessionId)
      .order("order_index", { ascending: true }).order("id", { ascending: true });
    if (error) { setErr(error.message); setItems([]); setSetsByItem({}); return; }
    const list = (data as Item[]).map(r => ({ ...r, metrics: r.metrics || {} }));
    setItems(list);
    const ids = list.map(i => i.id);
    if (ids.length) {
      const { data: sets, error: se } = await supabase
        .from("workout_sets").select("*").in("item_id", ids)
        .order("set_number", { ascending: true });
      if (se) { setErr(se.message); setSetsByItem({}); return; }
      const grouped: Record<number, WSet[]> = {};
      for (const s of (sets as WSet[])) (grouped[s.item_id] ||= []).push(s);
      setSetsByItem(grouped);
    } else setSetsByItem({});
  }

  async function loadRecent() {
    if (!userId) return;
    const since = new Date(); since.setDate(since.getDate() - 21);
    const { data, error } = await supabase
      .from("workout_sessions").select("*")
      .eq("user_id", userId).gte("session_date", toISO(since))
      .order("session_date", { ascending: false });
    if (error) { setErr(error.message); setRecent([]); return; }
    setRecent(data as Session[]);
  }

  async function checkOfferBackup() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("workout_sessions")
      .select("session_date").eq("user_id", userId)
      .order("session_date", { ascending: true }).limit(1);
    if (error || !data || !data.length) { setOfferBackup(false); return; }
    const first = new Date((data as any)[0].session_date);
    const days = (Date.now() - first.getTime()) / 86400000;
    setOfferBackup(days >= 365);
  }

  /* ----- Session actions ----- */
  async function createSession() {
    if (!userId) return;
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("workout_sessions").insert({ user_id: userId, session_date: dateISO })
        .select().single();
      if (error) throw error;
      const newS = data as Session;
      // add to today's list and make active
      setSessionsToday(prev => [...prev, newS]);
      setSession(newS);
      localStorage.setItem(FIN_KEY(newS.id, dateISO), "0");
      await loadItems(newS.id);
      await loadRecent();
    } catch (e: any) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  function markLocalFinished() {
    if (!session) return;
    localStorage.setItem(FIN_KEY(session.id, dateISO), "1");
    setFinished(true);
  }
  function reopenSession() {
    if (!session) return;
    localStorage.setItem(FIN_KEY(session.id, dateISO), "0");
    setFinished(false);
  }

  function switchSessionById(id: number) {
    const s = sessionsToday.find(x => x.id === id) || null;
    setSession(s);
    setItems([]);
    setSetsByItem({});
    if (s) loadItems(s.id);
  }

  // Ensure exactly ONE "success" per weights session (logs to tasks)
  async function ensureWinForSession() {
    if (!userId || !session) return;
    try {
      const { data: existing, error: qerr } = await supabase
        .from("tasks").select("id").eq("user_id", userId)
        .eq("source", "exercise_session")
        .eq("due_date", dateISO)
        .eq("status", "done")
        .limit(1);
      if (qerr) throw qerr;
      if (!existing || existing.length === 0) {
        const { error: ierr } = await supabase.from("tasks").insert({
          user_id: userId,
          title: "Weights session",
          status: "done",
          completed_at: new Date().toISOString(),
          due_date: dateISO,
          priority: 0,
          source: "exercise_session",
          category: null,
          category_color: null,
        } as any);
        if (ierr) throw ierr;
      }
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function completeSession() {
    markLocalFinished();
    await ensureWinForSession();
  }

  async function saveSessionNotes(notes: string) {
    if (!session) return;
    const { error } = await supabase.from("workout_sessions").update({ notes }).eq("id", session.id);
    if (error) setErr(error.message); else setSession({ ...session, notes });
  }

  /* ----- Item actions ----- */
  async function addWeightsExercise(title = "") {
    if (!session || !userId) return;
    const order_index = items.length ? Math.max(...items.map(i => i.order_index)) + 1 : 0;
    const { error } = await supabase.from("workout_items").insert({
      session_id: session.id, user_id: userId, kind: "weights", title, order_index, metrics: {}
    });
    if (error) { setErr(error.message); return; }
    await loadItems(session.id);
  }

  async function addCardio(kind: Item["kind"], title: string, distanceKm: number | null, durMMSS: string) {
    if (!session || !userId) return;
    const order_index = items.length ? Math.max(...items.map(i => i.order_index)) + 1 : 0;
    const duration_sec = mmssToSeconds(durMMSS || "00:00");
    const metrics: any = { duration_sec };
    if (distanceKm && distanceKm > 0) metrics.distance_km = distanceKm;
    const { error } = await supabase.from("workout_items").insert({
      session_id: session.id, user_id: userId, kind, title: title || kind, order_index, metrics
    });
    if (error) { setErr(error.message); return; }
    await loadItems(session.id);
  }

  // Debounced local rename (no network on each keystroke)
  function renameItemLocal(item: Item, newTitle: string) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, title: newTitle } : i));
    queueTitleSave(item.id, newTitle);
  }

  async function deleteItem(itemId: number) {
    const { error } = await supabase.from("workout_items").delete().eq("id", itemId);
    if (error) { setErr(error.message); return; }
    if (session) await loadItems(session.id);
  }

  /* ----- Sets ----- */
  async function addSet(itemId: number) {
    if (!userId) return;
    const current = setsByItem[itemId] || [];
    const nextNum = current.length ? Math.max(...current.map(s => s.set_number)) + 1 : 1;
    const { data, error } = await supabase.from("workout_sets").insert({
      item_id: itemId, user_id: userId, set_number: nextNum, weight_kg: null, reps: null
    }).select().single();
    if (error) { setErr(error.message); return; }
    setSetsByItem({ ...setsByItem, [itemId]: [...current, data as WSet] });
  }

  async function addSetsBulk(itemId: number, payloads: Array<{ weight_kg: number | null; reps: number | null; duration_sec: number | null }>) {
    if (!userId || payloads.length === 0) return;
    const current = setsByItem[itemId] || [];
    const baseNum = current.length ? Math.max(...current.map(s => s.set_number)) : 0;
    const rows = payloads.map((p, idx) => ({
      item_id: itemId, user_id: userId, set_number: baseNum + idx + 1,
      weight_kg: p.weight_kg ?? null, reps: p.reps ?? null, duration_sec: p.duration_sec ?? null,
    }));
    const { data, error } = await supabase.from("workout_sets").insert(rows).select();
    if (error) { setErr(error.message); return; }
    setSetsByItem({ ...setsByItem, [itemId]: [...current, ...((data as WSet[]) || [])] });
  }

  // OPTIMISTIC + DEBOUNCED
  function updateSet(set: WSet, patch: Partial<WSet>) {
    setSetsByItem(prev => {
      const list = (prev[set.item_id] || []).map(s => s.id === set.id ? ({ ...s, ...patch }) as WSet : s);
      return { ...prev, [set.item_id]: list };
    });
    queueSetSave(set.id, patch);
  }

  async function deleteSet(set: WSet) {
    const { error } = await supabase.from("workout_sets").delete().eq("id", set.id);
    if (error) { setErr(error.message); return; }
    const list = (setsByItem[set.item_id] || []).filter(s => s.id !== set.id);
    setSetsByItem({ ...setsByItem, [set.item_id]: list });
  }

  /* ----- History (per exercise title) ----- */
  async function loadPrevForItem(it: Item, limit = 3) {
    if (!userId) return;
    setLoadingPrevFor(prev => ({ ...prev, [it.id]: true }));
    try {
      const { data: itemsRows, error: iErr } = await supabase
        .from("workout_items")
        .select("id, session_id")
        .eq("user_id", userId)
        .eq("kind", "weights")
        .ilike("title", it.title)
        .neq("id", it.id)
        .order("id", { ascending: false })
        .limit(limit * 4);
      if (iErr) throw iErr;

      const prevItems = (itemsRows as Array<{ id: number; session_id: number }>) || [];
      if (prevItems.length === 0) { setPrevByItem(prev => ({ ...prev, [it.id]: [] })); return; }

      const itemIds = [...new Set(prevItems.map(r => r.id))];
      const sessionIds = [...new Set(prevItems.map(r => r.session_id))];

      const { data: setsRows, error: sErr } = await supabase
        .from("workout_sets")
        .select("item_id, set_number, weight_kg, reps, duration_sec")
        .in("item_id", itemIds)
        .order("set_number", { ascending: true });
      if (sErr) throw sErr;

      const { data: sessRows, error: dErr } = await supabase
        .from("workout_sessions")
        .select("id, session_date").in("id", sessionIds);
      if (dErr) throw dErr;

      const idToDate: Record<number, string> = {};
      (sessRows || []).forEach((s: any) => { idToDate[s.id] = s.session_date; });
      const idToSets: Record<number, Array<{ weight_kg: number | null; reps: number | null; duration_sec: number | null }>> = {};
      (setsRows as any[] || []).forEach(s => {
        (idToSets[s.item_id] ||= []).push({
          weight_kg: s.weight_kg ?? null, reps: s.reps ?? null, duration_sec: s.duration_sec ?? null,
        });
      });

      const entries: PrevEntry[] = prevItems
        .map(pi => ({ date: idToDate[pi.session_id] || "", sets: idToSets[pi.id] || [] }))
        .filter(e => !!e.date && e.sets.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);

      setPrevByItem(prev => ({ ...prev, [it.id]: entries }));
    } catch (e: any) { setErr(e.message || String(e)); }
    finally { setLoadingPrevFor(prev => ({ ...prev, [it.id]: false })); }
  }

  function toggleHistory(it: Item) {
    setOpenHistoryFor(prev => {
      const nextOpen = !prev[it.id];
      if (nextOpen && !prevByItem[it.id]) loadPrevForItem(it, 3);
      return { ...prev, [it.id]: nextOpen };
    });
  }

  async function copyLastSetsTo(it: Item) {
    const hist = prevByItem[it.id];
    if (!hist || hist.length === 0) return;
    await addSetsBulk(it.id, hist[0].sets);
  }

  /* ----- Template save (name + include weights/reps separately) ----- */
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplIncludeWeights, setTplIncludeWeights] = useState(false);
  const [tplIncludeReps, setTplIncludeReps] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);

  function openTemplateModal() {
    setTplOpen(true);
    setTplName("");
    setTplIncludeWeights(false);
    setTplIncludeReps(false);
  }

  async function saveTemplate() {
    if (!userId) return;
    const cleanName = tplName.trim();
    if (!cleanName || cleanName.toLowerCase() === "insert template name") return;

    const weightsItems = items.filter(i => i.kind === "weights");
    const payload = {
      items: weightsItems.map(it => {
        const sets = (setsByItem[it.id] || []);
        return {
          title: it.title,
          sets: sets.length,
          ...(tplIncludeWeights ? { weights: sets.map(s => s.weight_kg) } : {}),
          ...(tplIncludeReps ? { reps: sets.map(s => s.reps) } : {}),
        };
      }),
    };

    setTplSaving(true);
    try {
      const { error } = await supabase.from("workout_templates").insert({
        user_id: userId,
        name: cleanName,
        data: payload,
      } as any);
      if (error) {
        // fallback: localStorage (if table doesn't exist)
        const key = `byb:workout_templates:${userId}`;
        const prev = JSON.parse(localStorage.getItem(key) || "[]");
        prev.push({ id: Date.now(), name: cleanName, data: payload });
        localStorage.setItem(key, JSON.stringify(prev));
      }
      setTplOpen(false);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setTplSaving(false);
    }
  }

  /* ----- Template LOAD (new) ----- */
  const [loadTplOpen, setLoadTplOpen] = useState(false);
  const [loadTplLoading, setLoadTplLoading] = useState(false);
  const [tplList, setTplList] = useState<TemplateRow[]>([]);
  const [useTplWeights, setUseTplWeights] = useState(true);
  const [useTplReps, setUseTplReps] = useState(false);

  async function fetchTemplates() {
    if (!userId) return;
    setLoadTplLoading(true);
    try {
      const { data, error } = await supabase
        .from("workout_templates")
        .select("id,name,data")
        .eq("user_id", userId)
        .order("name", { ascending: true });
      if (error) throw error;
      setTplList((data as TemplateRow[]) || []);
    } catch {
      // Fallback to localStorage
      const key = `byb:workout_templates:${userId}`;
      const ls = JSON.parse(localStorage.getItem(key) || "[]");
      setTplList(ls as TemplateRow[]);
    } finally {
      setLoadTplLoading(false);
    }
  }

  function openLoadTemplate() {
    setUseTplWeights(true);
    setUseTplReps(false);
    setLoadTplOpen(true);
    fetchTemplates();
  }

  async function insertTemplate(tpl: TemplateRow, opts: { weights: boolean; reps: boolean }) {
    if (!userId || !session) return;

    let nextOrder = items.length ? Math.max(...items.map(i => i.order_index)) + 1 : 0;

    try {
      for (const it of tpl.data.items) {
        const { data: newItem, error: iErr } = await supabase
          .from("workout_items")
          .insert({
            session_id: session.id,
            user_id: userId,
            kind: "weights",
            title: it.title,
            order_index: nextOrder++,
            metrics: {},
          })
          .select()
          .single();
        if (iErr) throw iErr;

        const itemId = (newItem as Item).id;

        const count = Math.max(
          it.sets || 0,
          opts.weights && it.weights ? it.weights.length : 0,
          opts.reps && it.reps ? it.reps.length : 0
        );

        if (count > 0) {
          const rows = Array.from({ length: count }, (_, idx) => ({
            item_id: itemId,
            user_id: userId,
            set_number: idx + 1,
            weight_kg: opts.weights && it.weights ? (it.weights[idx] ?? null) : null,
            reps: opts.reps && it.reps ? (it.reps[idx] ?? null) : null,
            duration_sec: null,
          }));
          const { error: sErr } = await supabase.from("workout_sets").insert(rows);
          if (sErr) throw sErr;
        }
      }

      await loadItems(session.id);
      setLoadTplOpen(false);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  /* ----- Backup/export ----- */
  async function downloadBackup() {
    if (!userId) return;
    setBackingUp(true);
    try {
      const { data: sessions, error: se } = await supabase
        .from("workout_sessions").select("*").eq("user_id", userId)
        .order("session_date", { ascending: true });
      if (se) throw se;

      const sessionIds = (sessions as Session[]).map(s => s.id);
      const { data: itemsRows, error: ie } = await supabase
        .from("workout_items").select("*").in("session_id", sessionIds);
      if (ie) throw ie;

      const itemIds = (itemsRows as Item[]).map(i => i.id);
      const { data: setsRows, error: te } = await supabase
        .from("workout_sets").select("*").in("item_id", itemIds);
      if (te) throw te;

      const payload = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        sessions,
        items: itemsRows,
        sets: setsRows,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workout_backup_${toISO(new Date()).replace(/-/g, "")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBackingUp(false);
    }
  }

  /* ----- Modal (full history) ----- */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalForItemId, setModalForItemId] = useState<number | null>(null);
  const [modalEntries, setModalEntries] = useState<PrevEntry[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  async function openHistoryModal(it: Item, limit = 10) {
    if (!userId) return;
    setModalOpen(true); setModalTitle(it.title); setModalForItemId(it.id); setModalLoading(true);
    try {
      const { data: itemsRows, error: iErr } = await supabase
        .from("workout_items").select("id, session_id")
        .eq("user_id", userId).eq("kind", "weights").ilike("title", it.title)
        .neq("id", it.id).order("id", { ascending: false }).limit(limit * 4);
      if (iErr) throw iErr;

      const prevItems = (itemsRows as Array<{ id: number; session_id: number }>) || [];
      if (prevItems.length === 0) { setModalEntries([]); return; }

      const itemIds = [...new Set(prevItems.map(r => r.id))];
      const sessionIds = [...new Set(prevItems.map(r => r.session_id))];

      const { data: setsRows, error: sErr } = await supabase
        .from("workout_sets").select("item_id, set_number, weight_kg, reps, duration_sec")
        .in("item_id", itemIds).order("set_number", { ascending: true });
      if (sErr) throw sErr;

      const { data: sessRows, error: dErr } = await supabase
        .from("workout_sessions").select("id, session_date").in("id", sessionIds);
      if (dErr) throw dErr;

      const idToDate: Record<number, string> = {};
      (sessRows || []).forEach((s: any) => { idToDate[s.id] = s.session_date; });
      const idToSets: Record<number, Array<{ weight_kg: number | null; reps: number | null; duration_sec: number | null }>> = {};
      (setsRows as any[] || []).forEach(s => {
        (idToSets[s.item_id] ||= []).push({
          weight_kg: s.weight_kg ?? null, reps: s.reps ?? null, duration_sec: s.duration_sec ?? null,
        });
      });

      const entries: PrevEntry[] = prevItems
        .map(pi => ({ date: idToDate[pi.session_id] || "", sets: idToSets[pi.id] || [] }))
        .filter(e => !!e.date && e.sets.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);

      setModalEntries(entries);
    } catch (e: any) { setErr(e.message || String(e)); }
    finally { setModalLoading(false); }
  }
  function closeModal() { setModalOpen(false); setModalTitle(""); setModalEntries([]); setModalForItemId(null); }
  async function copySetsFromModal(entry: PrevEntry) { if (modalForItemId) await addSetsBulk(modalForItemId, entry.sets); }

  /* ----- UI helpers ----- */
  function gotoToday() { setDateISO(toISO(new Date())); }
  function prevDay() { const d = fromISO(dateISO); d.setDate(d.getDate() - 1); setDateISO(toISO(d)); }
  function nextDay() { const d = fromISO(dateISO); d.setDate(d.getDate() + 1); setDateISO(toISO(d)); }

  // summary for collapsed view
  const summary = useMemo(() => {
    const weightsItems = items.filter(i => i.kind === "weights");
    const cardioItems = items.filter(i => i.kind !== "weights");
    const totalSets = items.reduce((n, it) => n + ((setsByItem[it.id]?.length) || 0), 0);
    const cardioLabels = cardioItems.map(ci => ci.title || ci.kind);
    return { weightsCount: weightsItems.length, cardioCount: cardioItems.length, totalSets, cardioLabels };
  }, [items, setsByItem]);

  return (
    <div className="page-exercise" style={{ display: "grid", gap: 12 }}>
      {/* Title card with Alfred */}
      <div className="card" style={{ position: "relative", paddingRight: 64 }}>
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Exercise help"
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
              src={EX_ALFRED_SRC}
              alt="Exercise Alfred — open help"
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
        <h1 style={{ margin: 0 }}>Exercise Diary</h1>
      </div>

      {/* Main layout */}
      <div className="container">
        <div className="exercise-layout">
          {/* Left: editor */}
          <div className="card" style={{ display: "grid", gap: 12 }}>
            {/* Date bar */}
            <div className="exercise-toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={gotoToday}>Today</button>
              <button onClick={prevDay}>←</button>
              <input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} style={{ flex: "1 1 180px", minWidth: 0 }} />
              <button onClick={nextDay}>→</button>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {/* Show selector if multiple sessions; otherwise just the label */}
                {session ? (
                  <>
                    {sessionsToday.length > 1 ? (
                      <select
                        value={session.id}
                        onChange={e => switchSessionById(Number(e.target.value))}
                        title="Switch session"
                      >
                        {sessionsToday.map(s => (
                          <option key={s.id} value={s.id}>Session #{s.id}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted">Session #{session.id}</span>
                    )}
                    {finished && <button onClick={reopenSession}>Reopen</button>}
                    {/* Always offer a brand new session */}
                    <button className="btn-primary" onClick={createSession} disabled={busy} style={{ borderRadius: 8 }}>
                      {busy ? "Starting…" : "New session"}
                    </button>
                  </>
                ) : (
                  <button className="btn-primary" onClick={createSession} disabled={busy} style={{ borderRadius: 8 }}>
                    {busy ? "Starting…" : "Start session"}
                  </button>
                )}
              </div>
            </div>

            {!session ? (
              <div className="muted">No session for this day yet. Click <b>Start session</b> to begin.</div>
            ) : finished ? (
              <div className="card card--wash" style={{ display: "grid", gap: 10 }}>
                <h2 style={{ margin: 0 }}>Session complete</h2>
                <div className="muted">
                  Weights: <b>{summary.weightsCount}</b> · Sets: <b>{summary.totalSets}</b>
                  {summary.cardioCount > 0 && <> · Cardio: <b>{summary.cardioCount}</b></>}
                </div>
                {summary.cardioCount > 0 && <div className="muted">Cardio: {summary.cardioLabels.join(" · ")}</div>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={reopenSession}>Reopen session</button>
                  <button className="btn-primary" onClick={createSession} disabled={busy} style={{ borderRadius: 8 }}>
                    {busy ? "Starting…" : "New session"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* 👉 Quick add FIRST (above weights sticky) */}
                <QuickAddCard
                  onAddWeights={(name) => addWeightsExercise(name)}
                  onAddCardio={(kind, title, km, mmss) => addCardio(kind, title, km, mmss)}
                />

                {/* Sticky weights bar */}
                <div
                  style={{
                    position: "sticky", top: 0, zIndex: 5,
                    background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
                    padding: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap"
                  }}
                >
                  <span className="badge">Weights</span>
                  <input
                    placeholder="Enter exercise name here"
                    value={stickyTitle}
                    onChange={e => setStickyTitle(e.target.value)}
                    style={{ flex: "1 1 200px", minWidth: 0 }}
                  />
                  <button
                    className="btn-soft"
                    onClick={async () => { await addWeightsExercise(stickyTitle.trim()); setStickyTitle(""); }}
                  >
                    Add exercise
                  </button>

                  {/* Save / Load template options */}
                  <button className="btn-soft" onClick={openTemplateModal}>Save as template</button>
                  <button className="btn-soft" onClick={openLoadTemplate}>Load template</button>

                  <button className="btn-primary" onClick={completeSession} style={{ marginLeft: "auto", borderRadius: 8 }}>
                    Complete session
                  </button>
                </div>

                {/* Items */}
                <div style={{ display: "grid", gap: 10 }}>
                  {items.length === 0 && <div className="muted">No items yet. Add your first entry above.</div>}
                  {items.map(it => (
                    <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                        <KindBadge kind={it.kind} />
                        <input
                          placeholder={it.kind === "weights" ? "Enter exercise name here" : "Title"}
                          value={it.title}
                          onChange={e => renameItemLocal(it, e.target.value)}
                          onBlur={() => flushTitleSaves(it.id)}
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          {it.kind === "weights" && (
                            <>
                              <button onClick={() => toggleHistory(it)}>
                                {openHistoryFor[it.id] ? "Hide previous" : "Show previous"}
                              </button>
                              <button onClick={() => openHistoryModal(it)} title="See more dates">Open history</button>
                            </>
                          )}
                          <button onClick={() => deleteItem(it.id)} title="Delete">×</button>
                        </div>
                      </div>

                      {it.kind === "weights" ? (
                        <>
                          <WeightsEditor
                            sets={setsByItem[it.id] || []}
                            onAdd={() => addSet(it.id)}
                            onChange={(set, patch) => updateSet(set, patch)}
                            onDelete={(set) => deleteSet(set)}
                            flush={(id) => flushSetSaves(id)}
                          />
                          {openHistoryFor[it.id] && (
                            <div className="muted" style={{ border: "1px dashed #e5e7eb", borderRadius: 8, padding: 8, marginTop: 8 }}>
                              {loadingPrevFor[it.id] && <div>Loading previous…</div>}
                              {!loadingPrevFor[it.id] && (prevByItem[it.id]?.length ?? 0) === 0 && <div>No previous entries for this title.</div>}
                              {!loadingPrevFor[it.id] && (prevByItem[it.id]?.length ?? 0) > 0 && (
                                <>
                                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                                    <button className="btn-soft" onClick={() => copyLastSetsTo(it)}>Copy last sets</button>
                                  </div>
                                  <ul className="list">
                                    {prevByItem[it.id]!.map((p, idx) => (
                                      <li key={idx} className="item">
                                        <div style={{ fontWeight: 600 }}>{p.date}</div>
                                        <div>
                                          {p.sets.map((s, j) => {
                                            const w = s.weight_kg != null ? `${s.weight_kg}kg` : "";
                                            const r = s.reps != null ? `${s.reps}` : "";
                                            return <span key={j}>{j > 0 ? " · " : ""}{w && r ? `${w}×${r}` : (w || r || "")}</span>;
                                          })}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <CardioSummary item={it} />
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: "1px solid #eee", paddingTop: 8 }}>
                  <div className="section-title">Notes</div>
                  <textarea rows={3} value={session?.notes || ""} onChange={e => saveSessionNotes(e.target.value)} />
                </div>
              </>
            )}

            {err && <div style={{ color: "red" }}>{err}</div>}
          </div>

          {/* Right: recent + backup */}
          <aside className="card" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", minWidth: 0, gap: 10 }}>
            <h2 style={{ margin: 0 }}>Recent</h2>
            <ul className="list" style={{ overflow: "auto", maxHeight: "60vh" }}>
              {recent.length === 0 && <li className="muted">No recent sessions.</li>}
              {recent.map(s => (
                <li key={s.id} className="item">
                  <button onClick={() => { setDateISO(s.session_date); }} style={{ textAlign: "left", width: "100%" }}>
                    <div style={{ fontWeight: 600 }}>{s.session_date}</div>
                    {s.notes && <div className="muted" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.notes}</div>}
                  </button>
                </li>
              ))}
            </ul>
            <div>
              {offerBackup && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="muted">Nice streak — you’ve logged over a year. Back up your workouts?</div>
                  <button onClick={downloadBackup} disabled={backingUp} className="btn-soft">
                    {backingUp ? "Preparing…" : "Backup & Download"}
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Exercise — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {imgOk && <img src={EX_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
          <div style={{ flex: 1 }}>
            <ExerciseHelpContent />
          </div>
        </div>
      </Modal>

      {/* History Modal */}
      {modalOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 2100 }}
          onClick={closeModal}
        >
          <div className="card" style={{ width: "min(720px, 92vw)", maxHeight: "80vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h2 style={{ margin: 0 }}>History · {modalTitle}</h2>
              <button onClick={closeModal}>Close</button>
            </div>
            {modalLoading && <div className="muted" style={{ marginTop: 8 }}>Loading…</div>}
            {!modalLoading && modalEntries.length === 0 && <div className="muted" style={{ marginTop: 8 }}>No previous entries found for this title.</div>}
            {!modalLoading && modalEntries.length > 0 && (
              <ul className="list" style={{ marginTop: 8 }}>
                {modalEntries.map((p, idx) => (
                  <li key={idx} className="item" style={{ alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>{p.date}</div>
                    <div style={{ flex: 1 }}>
                      {p.sets.map((s, j) => {
                        const w = s.weight_kg != null ? `${s.weight_kg}kg` : "";
                        const r = s.reps != null ? `${s.reps}` : "";
                        return <span key={j}>{j > 0 ? " · " : ""}{w && r ? `${w}×${r}` : (w || r || "")}</span>;
                      })}
                    </div>
                    {modalForItemId && <button onClick={() => copySetsFromModal(p)} className="btn-soft">Copy sets</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title="Save as template">
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">Save today’s <b>weights</b> exercises as a reusable template.</div>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Template name</span>
            <input
              value={tplName}
              onChange={e => setTplName(e.target.value)}
              placeholder="insert template name"
            />
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={tplIncludeWeights} onChange={e => setTplIncludeWeights(e.target.checked)} />
              <span>Also save <b>weights</b></span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={tplIncludeReps} onChange={e => setTplIncludeReps(e.target.checked)} />
              <span>Also save <b>reps</b></span>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setTplOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={saveTemplate}
              disabled={tplSaving || !tplName.trim() || tplName.trim().toLowerCase() === "insert template name"}
              style={{ borderRadius: 8 }}
            >
              {tplSaving ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Load Template Modal (NEW) */}
      <Modal open={loadTplOpen} onClose={() => setLoadTplOpen(false)} title="Load template">
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">Insert a saved <b>weights</b> template into this session.</div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={useTplWeights}
                onChange={e => setUseTplWeights(e.target.checked)}
              />
              <span>Apply saved <b>weights</b> (kg)</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={useTplReps}
                onChange={e => setUseTplReps(e.target.checked)}
              />
              <span>Apply saved <b>reps</b></span>
            </label>
          </div>

          {loadTplLoading ? (
            <div className="muted">Loading templates…</div>
          ) : tplList.length === 0 ? (
            <div className="muted">No templates yet. Create one via “Save as template”.</div>
          ) : (
            <ul className="list">
              {tplList.map(t => (
                <li key={t.id} className="item" style={{ alignItems: "center" }}>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div className="muted" style={{ flex: 1 }}>
                    {t.data?.items?.length || 0} exercise{(t.data?.items?.length || 0) === 1 ? "" : "s"}
                  </div>
                  <button
                    className="btn-primary"
                    onClick={() => insertTemplate(t, { weights: useTplWeights, reps: useTplReps })}
                  >
                    Insert
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ---------- sub components ---------- */
function KindBadge({ kind }: { kind: Item["kind"] }) {
  const label = kind[0].toUpperCase() + kind.slice(1);
  const bg = ({
    weights: "#e0f2fe", run: "#fee2e2", jog: "#fee2e2", walk: "#fee2e2",
    yoga: "#dcfce7", class: "#ede9fe", other: "#f3f4f6"
  } as any)[kind] || "#f3f4f6";
  return <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: bg, border: "1px solid #e5e7eb" }}>{label}</span>;
}

function WeightsEditor({ sets, onAdd, onChange, onDelete, flush }: {
  sets: WSet[]; onAdd: () => void; onChange: (s: WSet, patch: Partial<WSet>) => void; onDelete: (s: WSet) => void; flush: (id?: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600 }}>Sets</div>
        <button onClick={onAdd}>+ Add set</button>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {sets.length === 0 && <div className="muted">No sets yet.</div>}
        {sets.map(s => (
          <div key={s.id} style={{ display: "grid", gridTemplateColumns: "68px minmax(0,1fr) minmax(0,1fr) 32px", gap: 6, alignItems: "center" }}>
            <div className="muted">Set {s.set_number}</div>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              placeholder="kg"
              value={s.weight_kg ?? ""}
              onChange={(e) => onChange(s, { weight_kg: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
              onBlur={() => flush(s.id)}
            />
            <input
              type="number"
              inputMode="numeric"
              placeholder="reps"
              value={s.reps ?? ""}
              onChange={(e) => onChange(s, { reps: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
              onBlur={() => flush(s.id)}
            />
            <button onClick={() => onDelete(s)} title="Delete set">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardioSummary({ item }: { item: Item }) {
  const d = item.metrics?.distance_km as number | undefined;
  const sec = item.metrics?.duration_sec as number | undefined;
  const pace = paceStr(d, sec);
  return <div className="muted">{d ? `${d} km` : ""}{(d && sec) ? " • " : ""}{sec ? secondsToMMSS(sec) : ""}{pace ? ` • ${pace}` : ""}</div>;
}

function QuickAddCard({
  onAddWeights, onAddCardio
}: {
  onAddWeights: (name: string) => void;
  onAddCardio: (kind: Item["kind"], title: string, distanceKm: number | null, mmss: string) => void;
}) {
  const [kind, setKind] = useState<Item["kind"]>("weights");
  const [title, setTitle] = useState("");
  const [dist, setDist] = useState<string>("");
  const [dur, setDur] = useState<string>("");

  function add() {
    if (kind === "weights") { onAddWeights(title.trim()); setTitle(""); }
    else onAddCardio(kind, title || (kind === "class" ? "Class" : kind[0].toUpperCase() + kind.slice(1)), dist ? Number(dist) : null, dur || "00:00");
    if (kind !== "weights") { setTitle(""); setDist(""); setDur(""); }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
      <div className="section-title">Quick add</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={kind} onChange={e => setKind(e.target.value as Item["kind"])}>
          <option value="weights">Weights</option>
          <option value="run">Run</option>
          <option value="jog">Jog</option>
          <option value="walk">Walk</option>
          <option value="yoga">Yoga</option>
          <option value="class">Class (custom title)</option>
        </select>

        {kind === "weights" ? (
          <>
            <input placeholder="Enter exercise name here" value={title} onChange={e => setTitle(e.target.value)} />
            <button className="btn-primary" onClick={add}>Add Weights Exercise</button>
          </>
        ) : (
          <>
            <input placeholder={kind === "class" ? "Class title" : "Title (optional)"} value={title} onChange={e => setTitle(e.target.value)} />
            <input type="number" inputMode="decimal" step="0.1" placeholder="Distance (km)" value={dist} onChange={e => setDist(e.target.value)} />
            <input placeholder="Duration mm:ss" value={dur} onChange={e => setDur(e.target.value)} />
            <button className="btn-primary" onClick={add}>Add {kind[0].toUpperCase() + kind.slice(1)}</button>
          </>
        )}
      </div>
    </div>
  );
}
