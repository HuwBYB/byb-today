import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import BigGoalWizard from "./BigGoalWizard";

/* ---------- Categories + colours ---------- */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" },
  { key: "health",    label: "Health",    color: "#22c55e" },
  { key: "business",  label: "Business",  color: "#3b82f6" },
  { key: "finance",   label: "Finance",   color: "#f59e0b" },
  { key: "other",     label: "Other",     color: "#6b7280" },
] as const;
type CatKey = typeof CATS[number]["key"];
const colorOf = (k: CatKey) => CATS.find(c => c.key === k)?.color || "#6b7280";

/* ---------- Types ---------- */
type Goal = {
  id: number;
  user_id: string;
  title: string;
  category: string | null;
  category_color: string | null;
  start_date: string | null;
  target_date: string | null;
  status: string | null;
};

type Step = {
  id: number;
  user_id: string;
  goal_id: number;
  cadence: "daily" | "weekly" | "monthly";
  description: string;
  active: boolean;
};

export default function GoalsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selected, setSelected] = useState<Goal | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const [daily, setDaily] = useState<string[]>([]);
  const [weekly, setWeekly] = useState<string[]>([]);
  const [monthly, setMonthly] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [sgTitle, setSgTitle] = useState("");
  const [sgTarget, setSgTarget] = useState("");
  const [sgCat, setSgCat] = useState<CatKey>("personal");
  const [creatingSimple, setCreatingSimple] = useState(false);

  const [editCat, setEditCat] = useState<CatKey>("other");
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => { if (userId) loadGoals(); }, [userId]);

  async function loadGoals() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("goals")
      .select("id,user_id,title,category,category_color,start_date,target_date,status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) { setErr(error.message); setGoals([]); return; }
    setGoals(data as Goal[]);
  }

  async function openGoal(g: Goal) {
    setSelected(g);
    const { data, error } = await supabase
      .from("big_goal_steps")
      .select("*")
      .eq("goal_id", g.id)
      .eq("active", true)
      .order("id", { ascending: true });
    if (error) { setErr(error.message); setDaily([]); setWeekly([]); setMonthly([]); return; }
    const rows = (data as Step[]) || [];
    setMonthly(rows.filter(r => r.cadence === "monthly").map(r => r.description));
    setWeekly(rows.filter(r => r.cadence === "weekly").map(r => r.description));
    setDaily(rows.filter(r => r.cadence === "daily").map(r => r.description));

    // prime category editor
    const k = (g.category || "other") as CatKey;
    setEditCat(CATS.some(c => c.key === k) ? k : "other");
  }

  function add(setter: (xs: string[]) => void, xs: string[]) { setter([...xs, ""]); }
  function upd(setter: (xs: string[]) => void, xs: string[], i: number, v: string) { setter(xs.map((x, idx) => idx === i ? v : x)); }
  function rm(setter: (xs: string[]) => void, xs: string[], i: number) { setter(xs.filter((_, idx) => idx !== i)); }

  async function saveSteps() {
    if (!userId || !selected) return;
    setBusy(true); setErr(null);
    try {
      const { error: de } = await supabase
        .from("big_goal_steps")
        .update({ active: false })
        .eq("goal_id", selected.id);
      if (de) throw de;

      const rows: any[] = [];
      const push = (cad: "daily" | "weekly" | "monthly", arr: string[]) => {
        for (const s of arr.map(x => x.trim()).filter(Boolean)) {
          rows.push({ user_id: userId, goal_id: selected.id, cadence: cad, description: s, active: true });
        }
      };
      push("monthly", monthly);
      push("weekly", weekly);
      push("daily", daily);

      if (rows.length) {
        const { error: ie } = await supabase.from("big_goal_steps").insert(rows);
        if (ie) throw ie;
      }
      await supabase.rpc("reseed_big_goal_steps", { p_goal_id: selected.id });

      alert("Steps saved and future tasks updated.");
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

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

  async function saveGoalDetails() {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const catColor = colorOf(editCat);
      const { error } = await supabase
        .from("goals")
        .update({ category: editCat, category_color: catColor })
        .eq("id", selected.id);
      if (error) throw error;
      setSelected({ ...selected, category: editCat, category_color: catColor });
      await loadGoals();
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
      {/* Left */}
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h1>Goals</h1>

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
              <button style={{ width: "100%", textAlign: "left", display: "flex", gap: 8, alignItems: "center" }} onClick={() => openGoal(g)}>
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

      {/* Right: details + steps */}
      <div className="card">
        {!selected ? (
          <div className="muted">Select a goal to view or edit details and steps.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {/* Header */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ width: 14, height: 14, borderRadius: 999, background: selected.category_color || "#e5e7eb", border: "1px solid #d1d5dB" }} />
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
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                <label>
                  <div className="muted">Category</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={editCat} onChange={e => setEditCat(e.target.value as CatKey)}>
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

            {/* Steps editor — ORDER: Monthly → Weekly → Daily */}
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
    </div>
  );
}
