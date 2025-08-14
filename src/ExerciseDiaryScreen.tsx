import { useEffect, useState } from "react";
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
  metrics: any; // {distance_km?:number, duration_sec?:number, ...}
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
  date: string; // YYYY-MM-DD
  sets: Array<{ weight_kg: number | null; reps: number | null; duration_sec: number | null }>;
};

/* ---------- Helpers ---------- */
function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) { const [y,m,d]=s.split("-").map(Number); return new Date(y,(m??1)-1,d??1); }
function secondsToMMSS(sec?: number | null) {
  if (!sec || sec <= 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function mmssToSeconds(v: string) {
  const [m,s] = v.split(":").map(n => Number(n||0));
  return (isFinite(m)?m:0)*60 + (isFinite(s)?s:0);
}
function paceStr(distanceKm?: number, durSec?: number) {
  if (!distanceKm || !durSec || distanceKm <= 0) return "";
  const secPerKm = Math.round(durSec / distanceKm);
  return `${secondsToMMSS(secPerKm)}/km`;
}

/* ---------- Main ---------- */
export default function ExerciseDiaryScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState(() => toISO(new Date()));

  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [setsByItem, setSetsByItem] = useState<Record<number, WSet[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [recent, setRecent] = useState<Session[]>([]);

  // per-exercise history state (quick preview)
  const [openHistoryFor, setOpenHistoryFor] = useState<Record<number, boolean>>({});
  const [loadingPrevFor, setLoadingPrevFor] = useState<Record<number, boolean>>({});
  const [prevByItem, setPrevByItem] = useState<Record<number, PrevEntry[]>>({});

  // modal (full history for a title)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalForItemId, setModalForItemId] = useState<number | null>(null);
  const [modalEntries, setModalEntries] = useState<PrevEntry[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => { if (userId) { loadSessionForDay(dateISO); loadRecent(); } }, [userId, dateISO]);

  /* ----- Loaders ----- */
  async function loadSessionForDay(iso: string) {
    if (!userId) return;
    setErr(null);
    const { data, error } = await supabase
      .from("workout_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("session_date", iso)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) { setErr(error.message); setSession(null); setItems([]); setSetsByItem({}); return; }
    const s = (data as Session[])[0] || null;
    setSession(s || null);
    if (s) await loadItems(s.id);
    else { setItems([]); setSetsByItem({}); }
  }

  async function loadItems(sessionId: number) {
    const { data, error } = await supabase
      .from("workout_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("order_index", { ascending: true })
      .order("id", { ascending: true });
    if (error) { setErr(error.message); setItems([]); setSetsByItem({}); return; }
    const list = (data as Item[]).map(r => ({ ...r, metrics: r.metrics || {} }));
    setItems(list);
    const ids = list.map(i => i.id);
    if (ids.length) {
      const { data: sets, error: se } = await supabase
        .from("workout_sets")
        .select("*")
        .in("item_id", ids)
        .order("set_number", { ascending: true });
      if (se) { setErr(se.message); setSetsByItem({}); return; }
      const grouped: Record<number, WSet[]> = {};
      for (const s of (sets as WSet[])) (grouped[s.item_id] ||= []).push(s);
      setSetsByItem(grouped);
    } else {
      setSetsByItem({});
    }
  }

  async function loadRecent() {
    if (!userId) return;
    const since = new Date(); since.setDate(since.getDate() - 21);
    const { data, error } = await supabase
      .from("workout_sessions")
      .select("*")
      .eq("user_id", userId)
      .gte("session_date", toISO(since))
      .order("session_date", { ascending: false });
    if (error) { setErr(error.message); setRecent([]); return; }
    setRecent(data as Session[]);
  }

  /* ----- Session actions ----- */
  async function createSession() {
    if (!userId) return;
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("workout_sessions")
        .insert({ user_id: userId, session_date: dateISO })
        .select()
        .single();
      if (error) throw error;
      setSession(data as Session);
      await loadItems((data as Session).id);
      await loadRecent();
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSessionNotes(notes: string) {
    if (!session) return;
    const { error } = await supabase
      .from("workout_sessions")
      .update({ notes })
      .eq("id", session.id);
    if (error) setErr(error.message);
    else setSession({ ...session, notes });
  }

  /* ----- Item actions ----- */
  async function addWeightsExercise(title = "Lat Pulldown") {
    if (!session || !userId) return;
    const order_index = items.length ? Math.max(...items.map(i => i.order_index)) + 1 : 0;
    const { error } = await supabase
      .from("workout_items")
      .insert({
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
    const { error } = await supabase
      .from("workout_items").insert({
        session_id: session.id, user_id: userId, kind, title: title || kind,
        order_index, metrics
      });
    if (error) { setErr(error.message); return; }
    await loadItems(session.id);
  }

  async function renameItem(item: Item, newTitle: string) {
    const { error } = await supabase
      .from("workout_items").update({ title: newTitle }).eq("id", item.id);
    if (error) setErr(error.message);
    else setItems(items.map(i => i.id === item.id ? { ...i, title: newTitle } : i));
  }

  async function deleteItem(itemId: number) {
    const { error } = await supabase.from("workout_items").delete().eq("id", itemId);
    if (error) { setErr(error.message); return; }
    if (session) await loadItems(session.id);
  }

  /* ----- Set actions (weights) ----- */
  async function addSet(itemId: number) {
    if (!userId) return;
    const current = setsByItem[itemId] || [];
    const nextNum = current.length ? Math.max(...current.map(s => s.set_number)) + 1 : 1;
    const { data, error } = await supabase
      .from("workout_sets").insert({
        item_id: itemId, user_id: userId, set_number: nextNum, weight_kg: null, reps: null
      }).select().single();
    if (error) { setErr(error.message); return; }
    setSetsByItem({ ...setsByItem, [itemId]: [...current, data as WSet] });
  }

  async function addSetsBulk(itemId: number, payloads: Array<{weight_kg:number|null; reps:number|null; duration_sec:number|null}>) {
    if (!userId || payloads.length === 0) return;
    const current = setsByItem[itemId] || [];
    const baseNum = current.length ? Math.max(...current.map(s => s.set_number)) : 0;
    const rows = payloads.map((p, idx) => ({
      item_id: itemId,
      user_id: userId,
      set_number: baseNum + idx + 1,
      weight_kg: p.weight_kg ?? null,
      reps: p.reps ?? null,
      duration_sec: p.duration_sec ?? null,
    }));
    const { data, error } = await supabase.from("workout_sets").insert(rows).select();
    if (error) { setErr(error.message); return; }
    setSetsByItem({ ...setsByItem, [itemId]: [...current, ...((data as WSet[]) || [])] });
  }

  async function updateSet(set: WSet, patch: Partial<WSet>) {
    const { error } = await supabase
      .from("workout_sets").update(patch).eq("id", set.id);
    if (error) { setErr(error.message); return; }
    const list = (setsByItem[set.item_id] || []).map(s => s.id === set.id ? { ...s, ...patch } as WSet : s);
    setSetsByItem({ ...setsByItem, [set.item_id]: list });
  }

  async function deleteSet(set: WSet) {
    const { error } = await supabase.from("workout_sets").delete().eq("id", set.id);
    if (error) { setErr(error.message); return; }
    const list = (setsByItem[set.item_id] || []).filter(s => s.id !== set.id);
    setSetsByItem({ ...setsByItem, [set.item_id]: list });
  }

  /* ----- Quick preview history (per weights exercise) ----- */
  async function loadPrevForItem(it: Item, limit = 4) {
    if (!userId) return;
    setLoadingPrevFor(prev => ({ ...prev, [it.id]: true }));
    try {
      // previous items with same title (case-insensitive), weights kind, excluding this item
      const { data: itemsRows, error: iErr } = await supabase
        .from("workout_items")
        .select("id, session_id, title, kind")
        .eq("user_id", userId)
        .eq("kind", "weights")
        .ilike("title", it.title) // case-insensitive "equal" (no wildcards)
        .neq("id", it.id)
        .order("id", { ascending: false })
        .limit(limit * 4);
      if (iErr) throw iErr;

      const prevItems = (itemsRows as Array<{id:number;session_id:number;title:string;kind:string}>) || [];
      if (prevItems.length === 0) {
        setPrevByItem(prev => ({ ...prev, [it.id]: [] }));
        return;
      }

      const itemIds = Array.from(new Set(prevItems.map(r => r.id)));
      const sessionIds = Array.from(new Set(prevItems.map(r => r.session_id)));

      const { data: setsRows, error: sErr } = await supabase
        .from("workout_sets")
        .select("item_id, set_number, weight_kg, reps, duration_sec")
        .in("item_id", itemIds)
        .order("set_number", { ascending: true });
      if (sErr) throw sErr;

      const { data: sessRows, error: dErr } = await supabase
        .from("workout_sessions")
        .select("id, session_date")
        .in("id", sessionIds);
      if (dErr) throw dErr;

      const idToDate: Record<number, string> = {};
      (sessRows || []).forEach((s:any) => { idToDate[s.id] = s.session_date; });

      const idToSets: Record<number, Array<{weight_kg:number|null; reps:number|null; duration_sec:number|null}>> = {};
      (setsRows as any[] || []).forEach(s => {
        (idToSets[s.item_id] ||= []).push({
          weight_kg: s.weight_kg ?? null,
          reps: s.reps ?? null,
          duration_sec: s.duration_sec ?? null,
        });
      });

      const entries: PrevEntry[] = prevItems
        .map(pi => ({ date: idToDate[pi.session_id] || "", sets: idToSets[pi.id] || [] }))
        .filter(e => !!e.date && e.sets.length > 0)
        .sort((a,b) => b.date.localeCompare(a.date))
        .slice(0, limit);

      setPrevByItem(prev => ({ ...prev, [it.id]: entries }));
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setLoadingPrevFor(prev => ({ ...prev, [it.id]: false }));
    }
  }

  function toggleHistory(it: Item) {
    setOpenHistoryFor(prev => {
      const nextOpen = !prev[it.id];
      if (nextOpen && !prevByItem[it.id]) {
        loadPrevForItem(it, 4);
      }
      return { ...prev, [it.id]: nextOpen };
    });
  }

  async function copyLastSetsTo(it: Item) {
    const hist = prevByItem[it.id];
    if (!hist || hist.length === 0) return;
    const last = hist[0];
    await addSetsBulk(it.id, last.sets);
  }

  /* ----- Modal: full history for a title ----- */
  async function openHistoryModal(it: Item, limit = 10) {
    if (!userId) return;
    setModalOpen(true);
    setModalTitle(it.title);
    setModalForItemId(it.id);
    setModalLoading(true);
    try {
      // same as quick preview but larger limit
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

      const prevItems = (itemsRows as Array<{id:number;session_id:number}>) || [];
      if (prevItems.length === 0) { setModalEntries([]); return; }

      const itemIds = Array.from(new Set(prevItems.map(r => r.id)));
      const sessionIds = Array.from(new Set(prevItems.map(r => r.session_id)));

      const { data: setsRows, error: sErr } = await supabase
        .from("workout_sets")
        .select("item_id, set_number, weight_kg, reps, duration_sec")
        .in("item_id", itemIds)
        .order("set_number", { ascending: true });
      if (sErr) throw sErr;

      const { data: sessRows, error: dErr } = await supabase
        .from("workout_sessions")
        .select("id, session_date")
        .in("id", sessionIds);
      if (dErr) throw dErr;

      const idToDate: Record<number, string> = {};
      (sessRows || []).forEach((s:any) => { idToDate[s.id] = s.session_date; });

      const idToSets: Record<number, Array<{weight_kg:number|null; reps:number|null; duration_sec:number|null}>> = {};
      (setsRows as any[] || []).forEach(s => {
        (idToSets[s.item_id] ||= []).push({
          weight_kg: s.weight_kg ?? null,
          reps: s.reps ?? null,
          duration_sec: s.duration_sec ?? null,
        });
      });

      const entries: PrevEntry[] = prevItems
        .map(pi => ({ date: idToDate[pi.session_id] || "", sets: idToSets[pi.id] || [] }))
        .filter(e => !!e.date && e.sets.length > 0)
        .sort((a,b) => b.date.localeCompare(a.date))
        .slice(0, limit);

      setModalEntries(entries);
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setModalOpen(false);
    setModalTitle("");
    setModalEntries([]);
    setModalForItemId(null);
  }

  async function copySetsFromModal(entry: PrevEntry) {
    if (!modalForItemId) return;
    await addSetsBulk(modalForItemId, entry.sets);
  }

  /* ----- UI helpers ----- */
  function gotoToday() { setDateISO(toISO(new Date())); }
  function prevDay() { const d = fromISO(dateISO); d.setDate(d.getDate()-1); setDateISO(toISO(d)); }
  function nextDay() { const d = fromISO(dateISO); d.setDate(d.getDate()+1); setDateISO(toISO(d)); }

  return (
    <div className="page-exercise">
      <div className="container">
        <div className="exercise-layout">
          {/* Left: editor */}
          <div className="card" style={{ display:"grid", gap:12 }}>
            <h1 style={{ margin:0 }}>Exercise Diary</h1>

            {/* Date bar */}
            <div className="exercise-toolbar" style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <button onClick={gotoToday}>Today</button>
              <button onClick={prevDay}>←</button>
              <input
                type="date"
                value={dateISO}
                onChange={e=>setDateISO(e.target.value)}
                style={{ flex:"1 1 180px", minWidth:0 }}
              />
              <button onClick={nextDay}>→</button>
              <div style={{ marginLeft:"auto" }}>
                {!session ? (
                  <button className="btn-primary" onClick={createSession} disabled={busy} style={{ borderRadius:8 }}>
                    {busy ? "Creating…" : "Create session"}
                  </button>
                ) : (
                  <span className="muted">Session #{session.id}</span>
                )}
              </div>
            </div>

            {!session ? (
              <div className="muted">No session for this day yet. Click <b>Create session</b> to start logging.</div>
            ) : (
              <>
                <QuickAddCard
                  onAddWeights={() => addWeightsExercise("Lat Pulldown")}
                  onAddCardio={(kind, title, km, mmss) => addCardio(kind, title, km, mmss)}
                />

                <div style={{ display:"grid", gap:10 }}>
                  {items.length === 0 && <div className="muted">No items yet. Add your first exercise above.</div>}
                  {items.map(it => (
                    <div key={it.id} style={{ border:"1px solid #eee", borderRadius:10, padding:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                        <KindBadge kind={it.kind} />
                        <input
                          value={it.title}
                          onChange={e=>renameItem(it, e.target.value)}
                          style={{ flex:1, minWidth:0 }}
                        />
                        <div style={{ display:"flex", gap:6 }}>
                          {it.kind === "weights" && (
                            <>
                              <button onClick={()=>toggleHistory(it)}>
                                {openHistoryFor[it.id] ? "Hide previous" : `Show previous`}
                              </button>
                              <button onClick={()=>openHistoryModal(it)} title="See more dates">Open history</button>
                            </>
                          )}
                          <button onClick={()=>deleteItem(it.id)} title="Delete">×</button>
                        </div>
                      </div>

                      {it.kind === "weights" ? (
                        <>
                          <WeightsEditor
                            sets={setsByItem[it.id] || []}
                            onAdd={()=>addSet(it.id)}
                            onChange={(set, patch)=>updateSet(set, patch)}
                            onDelete={(set)=>deleteSet(set)}
                          />
                          {/* History / previous workouts for this exercise */}
                          <div style={{ marginTop:8, display:"grid", gap:6 }}>
                            {openHistoryFor[it.id] && (
                              <div className="muted" style={{ border:"1px dashed #e5e7eb", borderRadius:8, padding:8 }}>
                                {loadingPrevFor[it.id] && <div>Loading previous…</div>}
                                {!loadingPrevFor[it.id] && (prevByItem[it.id]?.length ?? 0) === 0 && (
                                  <div>No previous entries found for this exercise title.</div>
                                )}
                                {!loadingPrevFor[it.id] && (prevByItem[it.id]?.length ?? 0) > 0 && (
                                  <>
                                    <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                                      <button className="btn-soft" onClick={()=>copyLastSetsTo(it)}>Copy last sets</button>
                                    </div>
                                    <ul className="list">
                                      {prevByItem[it.id]!.map((p, idx) => (
                                        <li key={idx} className="item">
                                          <div style={{ fontWeight:600 }}>{p.date}</div>
                                          <div>
                                            {p.sets.map((s, j) => {
                                              const w = s.weight_kg != null ? `${s.weight_kg}kg` : "";
                                              const r = s.reps != null ? `${s.reps}` : "";
                                              return <span key={j}>{j>0?" · ": ""}{w && r ? `${w}×${r}` : (w || r || "")}</span>;
                                            })}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <CardioSummary item={it} />
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ borderTop:"1px solid #eee", paddingTop:8 }}>
                  <div className="section-title">Notes</div>
                  <textarea rows={3} value={session.notes || ""} onChange={e=>saveSessionNotes(e.target.value)} />
                </div>
              </>
            )}

            {err && <div style={{ color:"red" }}>{err}</div>}
          </div>

          {/* Right: recent sessions */}
          <aside className="card" style={{ display:"grid", gridTemplateRows:"auto 1fr", minWidth:0 }}>
            <h2 style={{ margin:0 }}>Recent</h2>
            <ul className="list" style={{ overflow:"auto", maxHeight:"60vh" }}>
              {recent.length === 0 && <li className="muted">No recent sessions.</li>}
              {recent.map(s => (
                <li key={s.id} className="item">
                  <button onClick={()=>{ setDateISO(s.session_date); }} style={{ textAlign:"left", width:"100%" }}>
                    <div style={{ fontWeight:600 }}>{s.session_date}</div>
                    {s.notes && <div className="muted" style={{ marginTop:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.notes}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>

      {/* History Modal */}
      {modalOpen && (
        <div
          style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,.35)",
            display:"grid", placeItems:"center", zIndex:100
          }}
          onClick={closeModal}
        >
          <div
            className="card"
            style={{ width:"min(720px, 92vw)", maxHeight:"80vh", overflow:"auto" }}
            onClick={e=>e.stopPropagation()}
          >
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <h2 style={{ margin:0 }}>History · {modalTitle}</h2>
              <button onClick={closeModal}>Close</button>
            </div>
            {modalLoading && <div className="muted" style={{ marginTop:8 }}>Loading…</div>}
            {!modalLoading && modalEntries.length === 0 && (
              <div className="muted" style={{ marginTop:8 }}>No previous entries found for this title.</div>
            )}
            {!modalLoading && modalEntries.length > 0 && (
              <ul className="list" style={{ marginTop:8 }}>
                {modalEntries.map((p, idx) => (
                  <li key={idx} className="item" style={{ alignItems:"center" }}>
                    <div style={{ fontWeight:600 }}>{p.date}</div>
                    <div style={{ flex:1 }}>
                      {p.sets.map((s, j) => {
                        const w = s.weight_kg != null ? `${s.weight_kg}kg` : "";
                        const r = s.reps != null ? `${s.reps}` : "";
                        return <span key={j}>{j>0?" · ": ""}{w && r ? `${w}×${r}` : (w || r || "")}</span>;
                      })}
                    </div>
                    {modalForItemId && (
                      <button onClick={()=>copySetsFromModal(p)} className="btn-soft">Copy sets</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- sub components ---------- */
function KindBadge({ kind }:{ kind: Item["kind"] }) {
  const label = kind[0].toUpperCase()+kind.slice(1);
  const bg = ({
    weights:"#e0f2fe", run:"#fee2e2", jog:"#fee2e2", walk:"#fee2e2",
    yoga:"#dcfce7", class:"#ede9fe", other:"#f3f4f6"
  } as any)[kind] || "#f3f4f6";
  return <span style={{ fontSize:12, padding:"2px 8px", borderRadius:999, background:bg, border:"1px solid #e5e7eb" }}>{label}</span>;
}

function WeightsEditor({
  sets, onAdd, onChange, onDelete
}:{ sets:WSet[]; onAdd:()=>void; onChange:(s:WSet, patch:Partial<WSet>)=>void; onDelete:(s:WSet)=>void }) {
  return (
    <div>
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap" }}>
        <div style={{ fontWeight:600 }}>Sets</div>
        <button onClick={onAdd}>+ Add set</button>
      </div>
      <div style={{ display:"grid", gap:6 }}>
        {sets.length === 0 && <div className="muted">No sets yet.</div>}
        {sets.map(s => (
          <div
            key={s.id}
            style={{
              display:"grid",
              gridTemplateColumns:"68px minmax(0,1fr) minmax(0,1fr) 32px",
              gap:6, alignItems:"center"
            }}
          >
            <div className="muted">Set {s.set_number}</div>
            <input
              type="number" inputMode="decimal" step="0.5" placeholder="kg"
              value={s.weight_kg ?? ""} onChange={e=>onChange(s, { weight_kg: e.target.value===""? null : Number(e.target.value) })}
            />
            <input
              type="number" inputMode="numeric" placeholder="reps"
              value={s.reps ?? ""} onChange={e=>onChange(s, { reps: e.target.value===""? null : Number(e.target.value) })}
            />
            <button onClick={()=>onDelete(s)} title="Delete set">×</button>
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
  return (
    <div className="muted">
      {(d ? `${d} km` : "")}
      {(d && sec) ? " • " : ""}
      {(sec ? secondsToMMSS(sec) : "")}
      {pace ? ` • ${pace}` : ""}
    </div>
  );
}

function QuickAddCard({
  onAddWeights, onAddCardio
}:{ onAddWeights:()=>void; onAddCardio:(kind:Item["kind"], title:string, distanceKm:number|null, mmss:string)=>void }) {
  const [kind, setKind] = useState<Item["kind"]>("weights");
  const [title, setTitle] = useState("");
  const [dist, setDist] = useState<string>("");
  const [dur, setDur] = useState<string>("");

  function add() {
    if (kind === "weights") onAddWeights();
    else onAddCardio(kind, title || (kind === "class" ? "Class" : kind[0].toUpperCase()+kind.slice(1)), dist ? Number(dist) : null, dur || "00:00");
    setTitle(""); setDist(""); setDur("");
  }

  return (
    <div style={{ border:"1px solid #eee", borderRadius:10, padding:10 }}>
      <div className="section-title">Quick add</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <select value={kind} onChange={e=>setKind(e.target.value as Item["kind"])}>
          <option value="weights">Weights</option>
          <option value="run">Run</option>
          <option value="jog">Jog</option>
          <option value="walk">Walk</option>
          <option value="yoga">Yoga</option>
          <option value="class">Class (custom title)</option>
        </select>

        {kind === "weights" ? (
          <button className="btn-primary" onClick={add}>Add Weights Exercise</button>
        ) : (
          <>
            <input placeholder={kind === "class" ? "Class title" : "Title (optional)"} value={title} onChange={e=>setTitle(e.target.value)} />
            <input type="number" inputMode="decimal" step="0.1" placeholder="Distance (km)" value={dist} onChange={e=>setDist(e.target.value)} />
            <input placeholder="Duration mm:ss" value={dur} onChange={e=>setDur(e.target.value)} />
            <button className="btn-primary" onClick={add}>Add {kind[0].toUpperCase()+kind.slice(1)}</button>
          </>
        )}
      </div>
    </div>
  );
}
