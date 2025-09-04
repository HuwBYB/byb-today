import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";
import BigGoalWizard from "./BigGoalWizard";

/* ====================== Categories (match DB) ====================== */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" },
  { key: "health",    label: "Health",    color: "#22c55e" },
  { key: "career",    label: "Business",  color: "#3b82f6" },   // stored as 'career'
  { key: "financial", label: "Finance",   color: "#f59e0b" },   // stored as 'financial'
  { key: "other",     label: "Other",     color: "#6b7280" },
] as const;
type CatKey = typeof CATS[number]["key"];
const colorOf = (k: CatKey) => CATS.find(c => c.key === k)?.color || "#6b7280";
function normalizeCat(x: string | null | undefined): CatKey {
  const s = (x || "").toLowerCase();
  if (s === "business") return "career";
  if (s === "finance")  return "financial";
  return (["personal","health","career","financial","other"] as const).includes(s as any) ? (s as CatKey) : "other";
}

/* ====================== Types ====================== */
type Goal = {
  id: number;
  user_id: string;
  title: string;
  category: string | null;
  category_color: string | null;
  start_date: string | null;
  target_date: string | null;
  status: string | null;
  halfway_date?: string | null;
  halfway_note?: string | null;
};
type Step = {
  id: number;
  user_id: string;
  goal_id: number;
  cadence: "daily" | "weekly" | "monthly";
  description: string;
  active: boolean;
};

/* ====================== Date helpers ====================== */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) { const [y,m,d] = s.split("-").map(Number); return new Date(y,(m??1)-1,(d??1)); }
function clampDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function lastDayOfMonth(y:number,m0:number){ return new Date(y,m0+1,0).getDate(); }
function addMonthsClamped(base: Date, months: number, anchorDay?: number) {
  const anchor = anchorDay ?? base.getDate();
  const y = base.getFullYear(), m = base.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDayOfMonth(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, ld));
}
function isoToday() {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}

/* ====================== Storage helper (one-time halfway modal) ====================== */
function halfwaySeenKey(goalId: number) { return `byb:halfway_seen:${goalId}`; }
function getHalfwaySeen(goalId: number) { try { return localStorage.getItem(halfwaySeenKey(goalId)) === "1"; } catch { return false; } }
function setHalfwaySeen(goalId: number) { try { localStorage.setItem(halfwaySeenKey(goalId), "1"); } catch {} }

/* ====================== Little modal ====================== */
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
        className="card"
        style={{ maxWidth: 640, width: "100%", borderRadius: 12, padding: 16, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close" title="Close" className="btn-ghost">✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ====================== DB helpers ====================== */
async function countFutureBigGoalTasks(userId: string, goalId: number, fromISO: string) {
  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .in("source", ["big_goal_monthly", "big_goal_weekly", "big_goal_daily"])
    .gte("due_date", fromISO);
  if (error) throw error;
  return count || 0;
}

/** Client fallback for reseeding if RPC isn't available */
async function clientReseedTasksForGoal(userId: string, goalId: number, seedFromISO?: string) {
  const { data: g, error: ge } = await supabase
    .from("goals")
    .select("id,user_id,title,category,category_color,start_date,target_date,halfway_date,halfway_note")
    .eq("id", goalId)
    .single();
  if (ge) throw ge;
  const goal = g as Goal;

  const startISO = goal.start_date || toISO(new Date());
  const endISO   = goal.target_date || startISO;
  const start = fromISO(startISO);
  const end   = fromISO(endISO);
  if (end < start) throw new Error("Target date is before start date.");

  const fromISOValue = seedFromISO || isoToday();
  const fromDate = fromISO(fromISOValue);

  const { data: steps, error: se } = await supabase
    .from("big_goal_steps")
    .select("*")
    .eq("goal_id", goalId)
    .eq("active", true);
  if (se) throw se;

  const cat: CatKey = normalizeCat(goal.category);
  const col = goal.category_color || colorOf(cat);

  // Clear ONLY future big_goal_* tasks (keep milestones)
  await supabase
    .from("tasks")
    .delete()
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .in("source", ["big_goal_monthly", "big_goal_weekly", "big_goal_daily"])
    .gte("due_date", fromISOValue);

  const queue: any[] = [];

  // monthly — same DOM cadence, first >= fromDate
  const monthSteps = (steps as Step[]).filter(s => s.cadence === "monthly");
  if (monthSteps.length) {
    let cursor = addMonthsClamped(start, 0, start.getDate());
    while (cursor < fromDate) cursor = addMonthsClamped(cursor, 1, start.getDate());
    while (cursor <= end) {
      const due = toISO(cursor);
      for (const s of monthSteps) {
        queue.push({
          user_id: userId, goal_id: goalId,
          title: `BIG GOAL — Monthly: ${s.description}`,
          due_date: due, source: "big_goal_monthly", priority: 2,
          category: cat, category_color: col,
        });
      }
      cursor = addMonthsClamped(cursor, 1, start.getDate());
    }
  }

  // weekly — cadence every 7 days from (start + 7)
  const weekSteps = (steps as Step[]).filter(s => s.cadence === "weekly");
  if (weekSteps.length) {
    let cursor = new Date(start);
    cursor.setDate(cursor.getDate() + 7); // first weekly
    while (cursor < fromDate) cursor.setDate(cursor.getDate() + 7);
    while (cursor <= end) {
      const due = toISO(cursor);
      for (const s of weekSteps) {
        queue.push({
          user_id: userId, goal_id: goalId,
          title: `BIG GOAL — Weekly: ${s.description}`,
          due_date: due, source: "big_goal_weekly", priority: 2,
          category: cat, category_color: col,
        });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  // daily — from max(fromDate, start)
  const daySteps = (steps as Step[]).filter(s => s.cadence === "daily");
  if (daySteps.length) {
    let cursor = new Date(Math.max(fromDate.getTime(), start.getTime()));
    cursor = clampDay(cursor);
    while (cursor <= end) {
      const due = toISO(cursor);
      for (const s of daySteps) {
        queue.push({
          user_id: userId, goal_id: goalId,
          title: `BIG GOAL — Daily: ${s.description}`,
          due_date: due, source: "big_goal_daily", priority: 2,
          category: cat, category_color: col,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (let i = 0; i < queue.length; i += 500) {
    const slice = queue.slice(i, i + 500);
    const { error: terr } = await supabase.from("tasks").insert(slice);
    if (terr) throw terr;
  }
  return queue.length;
}

/* ====================== Main Screen ====================== */
export default function GoalsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selected, setSelected] = useState<Goal | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // steps state (Monthly → Weekly → Daily)
  const [daily, setDaily] = useState<string[]>([""]);
  const [weekly, setWeekly] = useState<string[]>([""]);
  const [monthly, setMonthly] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // simple goal creator
  const [sgTitle, setSgTitle] = useState("");
  const [sgTarget, setSgTarget] = useState("");
  const [sgCat, setSgCat] = useState<CatKey>("personal");
  const [creatingSimple, setCreatingSimple] = useState(false);

  // category editor for selected
  const [editCat, setEditCat] = useState<CatKey>("other");

  // halfway modal
  const [showHalfway, setShowHalfway] = useState(false);

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- load goals ----- */
  useEffect(() => { if (userId) loadGoals(); }, [userId]);
  async function loadGoals() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("goals")
      .select("id,user_id,title,category,category_color,start_date,target_date,status,halfway_date,halfway_note")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) { setErr(error.message); setGoals([]); return; }
    setGoals(data as Goal[]);
  }

  /* ----- open selected goal (load steps + halfway check/extend) ----- */
  async function openGoal(g: Goal) {
    setSelected(g);
    const { data, error } = await supabase
      .from("big_goal_steps")
      .select("*")
      .eq("goal_id", g.id)
      .eq("active", true)
      .order("id", { ascending: true });
    if (error) { setErr(error.message); setDaily([""]); setWeekly([""]); setMonthly([""]); return; }
    const rows = (data as Step[]) || [];
    const m = rows.filter(r => r.cadence === "monthly").map(r => r.description);
    const w = rows.filter(r => r.cadence === "weekly").map(r => r.description);
    const d = rows.filter(r => r.cadence === "daily").map(r => r.description);
    setMonthly(m.length ? m : [""]);
    setWeekly(w.length ? w : [""]);
    setDaily(d.length ? d : [""]);
    setEditCat(normalizeCat(g.category));

    // If we're past halfway, within target, and haven't shown modal for this goal → show it.
    try {
      const today = isoToday();
      const half = (g.halfway_date || "") as string;
      const target = (g.target_date || "") as string;
      const shouldNudge = half && target && today >= half && today <= target && !getHalfwaySeen(g.id);
      setShowHalfway(!!shouldNudge);

      // Silent auto-extend safety: if no future tasks remain, reseed from today.
      if (userId && half && target && today >= half && today <= target) {
        const futureCount = await countFutureBigGoalTasks(userId, g.id, today);
        if (futureCount === 0) {
          await clientReseedTasksForGoal(userId, g.id, today);
        }
      }
    } catch { /* soft fail */ }
  }

  /* ----- save steps (and reseed tasks) ----- */
  async function saveSteps() {
    if (!userId || !selected) return;
    setBusy(true); setErr(null);
    try {
      // replace current active steps with new ones
      const { error: de } = await supabase
        .from("big_goal_steps")
        .update({ active: false })
        .eq("goal_id", selected.id);
      if (de) throw de;

      const rows: any[] = [];
      for (const s of monthly.map(x=>x.trim()).filter(Boolean)) rows.push({ user_id:userId, goal_id:selected.id, cadence:"monthly", description:s, active:true });
      for (const s of weekly.map(x=>x.trim()).filter(Boolean))  rows.push({ user_id:userId, goal_id:selected.id, cadence:"weekly",  description:s, active:true });
      for (const s of daily.map(x=>x.trim()).filter(Boolean))   rows.push({ user_id:userId, goal_id:selected.id, cadence:"daily",   description:s, active:true });
      if (rows.length) {
        const { error: ie } = await supabase.from("big_goal_steps").insert(rows);
        if (ie) throw ie;
      }

      // reseed via RPC or client fallback
      const { error: rerr } = await supabase.rpc("reseed_big_goal_steps", { p_goal_id: selected.id });
      if (rerr) {
        const n = await clientReseedTasksForGoal(userId, selected.id, isoToday());
        alert(`Steps saved. ${n ?? 0} task(s) reseeded for this goal.`);
      } else {
        alert("Steps saved and future tasks updated.");
      }
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ----- create simple goal ----- */
  async function createSimpleGoal() {
    if (!userId) return;
    const title = sgTitle.trim();
    if (!title) return;
    setCreatingSimple(true); setErr(null);
    try {
      const { error } = await supabase
        .from("goals")
        .insert({
          user_id: userId,
          title,
          goal_type: "simple",
          target_date: sgTarget || null,
          category: sgCat,
          category_color: colorOf(sgCat),
          status: "active",
        });
      if (error) throw error;
      setSgTitle(""); setSgTarget("");
      await loadGoals();
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setCreatingSimple(false);
    }
  }

  /* ----- save selected goal details (category) ----- */
  async function saveGoalDetails() {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const cat = editCat;
      const catColor = colorOf(cat);
      const { error } = await supabase
        .from("goals")
        .update({ category: cat, category_color: catColor })
        .eq("id", selected.id);
      if (error) throw error;
      setSelected({ ...selected, category: cat, category_color: catColor });
      await loadGoals();
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ====================== UI ====================== */
  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
      {/* Left: list + creators */}
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Goals</h1>

        {/* Simple goal creator */}
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
          <div className="section-title">Create a simple goal</div>
          <label style={{ display: "grid", gap: 6, marginTop: 6 }}>
            <span className="muted">Title</span>
            <input value={sgTitle} onChange={e => setSgTitle(e.target.value)} placeholder="e.g., Read 12 books" />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <label style={{ flex: 1 }}>
              <div className="muted">Target date (optional)</div>
              <input type="date" value={sgTarget} onChange={e => setSgTarget(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <div className="muted">Category</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={sgCat} onChange={e => setSgCat(e.target.value as CatKey)}>
                  {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <span style={{ width: 16, height: 16, borderRadius: 999, background: colorOf(sgCat), border: "1px solid #ccc" }} />
              </div>
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-primary" onClick={createSimpleGoal} disabled={!sgTitle.trim() || creatingSimple} style={{ borderRadius: 8 }}>
              {creatingSimple ? "Adding…" : "Add Goal"}
            </button>
          </div>
        </div>

        {/* Big Goal wizard */}
        <button className="btn-primary" onClick={() => setShowWizard(true)} style={{ borderRadius: 8 }}>
          + Create Big Goal
        </button>

        <div className="section-title">Your goals</div>
        <ul className="list">
          {goals.length === 0 && <li className="muted">No goals yet.</li>}
          {goals.map(g => (
            <li key={g.id} className="item">
              <button
                style={{ width: "100%", textAlign: "left", display: "flex", gap: 8, alignItems: "center" }}
                onClick={() => openGoal(g)}
              >
                <span
                  title={g.category || "No category"}
                  style={{ width: 10, height: 10, borderRadius: 999, background: g.category_color || "#e5e7eb", border: "1px solid #d1d5db", flex: "0 0 auto" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{g.title}</div>
                  <div className="muted">
                    {(g.category ? `${g.category}` : "uncategorised")}
                    {g.target_date ? ` • target ${g.target_date}` : ""}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>

        {showWizard && (
          <div style={{ marginTop: 8 }}>
            <BigGoalWizard
              onClose={() => setShowWizard(false)}
              onCreated={() => { setShowWizard(false); loadGoals(); }}
            />
          </div>
        )}
      </div>

      {/* Right: details/steps */}
      <div className="card" style={{ display: "grid", gap: 12 }}>
        {!selected ? (
          <div className="muted">Select a goal to view or edit details and steps.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {/* Header */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ width: 14, height: 14, borderRadius: 999, background: selected.category_color || "#e5e7eb", border: "1px solid #d1d5db" }} />
              <div>
                <h2 style={{ margin: 0 }}>{selected.title}</h2>
                <div className="muted">
                  {selected.start_date || "-"} → {selected.target_date || "-"}
                  {selected.category ? ` • ${selected.category}` : ""}
                </div>
              </div>
            </div>

            {/* Category editor */}
            <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
              <div className="section-title">Edit details</div>
              <div style={{ display: "Flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <label>
                  <div className="muted">Category</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={normalizeCat(selected.category)} onChange={e => setEditCat(e.target.value as CatKey)}>
                      {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <span style={{ width: 16, height: 16, borderRadius: 999, background: colorOf(editCat), border: "1px solid #ccc" }} />
                  </div>
                </label>
                <button className="btn-primary" onClick={saveGoalDetails} disabled={busy} style={{ borderRadius: 8, marginLeft: "auto" }}>
                  {busy ? "Saving…" : "Save details"}
                </button>
              </div>
            </div>

            {/* Steps editor — Monthly → Weekly → Daily */}
            <div>
              <h3 style={{ marginTop: 0 }}>Steps</h3>

              <fieldset style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <legend>Monthly</legend>
                {monthly.map((v, i) => (
                  <div key={`m${i}`} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input value={v} onChange={e => setMonthly(monthly.map((x,idx)=>idx===i?e.target.value:x))} placeholder="Monthly step…" style={{ flex: 1 }} />
                    {monthly.length > 1 && <button onClick={() => setMonthly(monthly.filter((_,idx)=>idx!==i))}>–</button>}
                  </div>
                ))}
                <button onClick={() => setMonthly([...monthly, ""])}>+ Add monthly step</button>
              </fieldset>

              <fieldset style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <legend>Weekly</legend>
                {weekly.map((v, i) => (
                  <div key={`w${i}`} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input value={v} onChange={e => setWeekly(weekly.map((x,idx)=>idx===i?e.target.value:x))} placeholder="Weekly step…" style={{ flex: 1 }} />
                    {weekly.length > 1 && <button onClick={() => setWeekly(weekly.filter((_,idx)=>idx!==i))}>–</button>}
                  </div>
                ))}
                <button onClick={() => setWeekly([...weekly, ""])}>+ Add weekly step</button>
              </fieldset>

              <fieldset style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                <legend>Daily</legend>
                {daily.map((v, i) => (
                  <div key={`d${i}`} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input value={v} onChange={e => setDaily(daily.map((x,idx)=>idx===i?e.target.value:x))} placeholder="Daily step…" style={{ flex: 1 }} />
                    {daily.length > 1 && <button onClick={() => setDaily(daily.filter((_,idx)=>idx!==i))}>–</button>}
                  </div>
                ))}
                <button onClick={() => setDaily([...daily, ""])}>+ Add daily step</button>
              </fieldset>

              {err && <div style={{ color: "red", marginTop: 8 }}>{err}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={saveSteps} disabled={busy} className="btn-primary" style={{ borderRadius: 8 }}>
                  {busy ? "Saving…" : "Save steps & reseed"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Halfway modal: Continue / Redefine / Extend */}
      <Modal
        open={!!selected && showHalfway}
        onClose={() => { if (selected) setHalfwaySeen(selected.id); setShowHalfway(false); }}
        title="Halfway reached — want to adjust your plan?"
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">
            You’ve hit the halfway point for <b>{selected?.title}</b>. You can keep your current steps,
            tweak them for the second half, or extend tasks from here to your target date.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              className="btn-soft"
              onClick={() => { if (selected) setHalfwaySeen(selected.id); setShowHalfway(false); }}
              title="Keep going as-is"
            >
              Continue
            </button>
            <button
              className="btn-soft"
              onClick={() => { if (selected) setHalfwaySeen(selected.id); setShowHalfway(false); /* Editor already visible */ }}
              title="Edit your steps below"
            >
              Redefine steps
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!userId || !selected) return;
                try {
                  const n = await clientReseedTasksForGoal(userId, selected.id, isoToday());
                  alert(`Extended ${n ?? 0} task(s) from halfway to target.`);
                } catch (e:any) {
                  alert(e.message || String(e));
                } finally {
                  setHalfwaySeen(selected.id);
                  setShowHalfway(false);
                }
              }}
              title="Seed the second half now"
              style={{ borderRadius: 8 }}
            >
              Extend from halfway
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
