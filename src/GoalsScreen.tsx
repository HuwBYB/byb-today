import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import BigGoalWizard from "./BigGoalWizard";

type Goal = {
  id: number;
  user_id: string;
  title: string;
  description: string | null;
  status: "active" | "completed" | "archived";
  target_date: string | null;
  goal_type?: "regular" | "big";
};

type Step = {
  id: number;
  user_id: string;
  goal_id: number;
  step_order: number;
  title: string;
  due_date: string | null;
  status: "todo" | "in_progress" | "done";
};

function todayISO() { return new Date().toISOString().slice(0,10); }

export default function GoalsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(true);
  const [goalErr, setGoalErr] = useState<string | null>(null);

  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);

  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDate, setNewGoalDate] = useState<string>("");

  const [newStepTitle, setNewStepTitle] = useState("");
  const [newStepDate, setNewStepDate] = useState<string>("");

  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setGoalErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function loadGoals() {
    if (!userId) return;
    setLoadingGoals(true);
    setGoalErr(null);
    const { data, error } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) { setGoalErr(error.message); setGoals([]); }
    else setGoals((data as any) || []);
    setLoadingGoals(false);
  }
  useEffect(() => { if (userId) loadGoals(); }, [userId]);

  async function loadSteps(goalId: number) {
    if (!userId) return;
    setLoadingSteps(true);
    const { data, error } = await supabase
      .from("goal_steps")
      .select("*")
      .eq("user_id", userId)
      .eq("goal_id", goalId)
      .order("step_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) { setGoalErr(error.message); setSteps([]); }
    else setSteps((data as any) || []);
    setLoadingSteps(false);
  }
  useEffect(() => { if (selectedGoalId) loadSteps(selectedGoalId); }, [selectedGoalId]);

  // Quick regular goal
  async function createGoal() {
    if (!userId || !newGoalTitle.trim()) return;
    const { error } = await supabase.from("goals").insert({
      user_id: userId,
      title: newGoalTitle.trim(),
      target_date: newGoalDate || null,
      status: "active",
      goal_type: "regular",
    });
    if (error) { setGoalErr(error.message); return; }
    setNewGoalTitle(""); setNewGoalDate("");
    await loadGoals();
  }

  async function addStep() {
    if (!userId || !selectedGoalId || !newStepTitle.trim()) return;
    const maxOrder = steps.reduce((m, s) => Math.max(m, s.step_order), 0);
    const { error } = await supabase.from("goal_steps").insert({
      user_id: userId,
      goal_id: selectedGoalId,
      title: newStepTitle.trim(),
      due_date: newStepDate || null,
      step_order: maxOrder + 1,
      status: "todo",
    });
    if (error) { setGoalErr(error.message); return; }
    setNewStepTitle(""); setNewStepDate("");
    await loadSteps(selectedGoalId);
  }

  async function markStepDone(stepId: number, done: boolean) {
    const { error } = await supabase.from("goal_steps").update({ status: done ? "done" : "todo" }).eq("id", stepId);
    if (!error && selectedGoalId) loadSteps(selectedGoalId);
  }

  // Prefix with BIG GOAL if the selected goal is 'big'
  async function sendStepToToday(step: Step) {
    if (!userId) return;
    const goal = selectedGoal;
    const title = goal?.goal_type === "big" ? `BIG GOAL — ${step.title}` : step.title;
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title,
      due_date: step.due_date || todayISO(),
      source: goal?.goal_type === "big" ? "big_goal_step" : "goal",
      priority: 2,
    });
    if (error) { setGoalErr(error.message); return; }
    alert("Sent to Today ✅");
  }

  async function sendGoalToToday(goal: Goal) {
    if (!userId) return;
    const title = goal.goal_type === "big" ? `BIG GOAL — ${goal.title}` : goal.title;
    const src = goal.goal_type === "big" ? "big_goal_target" : "goal_target";
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title,
      due_date: goal.target_date || todayISO(),
      source: src,
      priority: 2,
    });
    if (error) { setGoalErr(error.message); return; }
    alert("Goal sent to Today ✅");
  }

  const selectedGoal = useMemo(() => goals.find(g => g.id === selectedGoalId) || null, [goals, selectedGoalId]);

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Goals</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => setShowWizard(true)} style={{ padding: "8px 12px", border: "1px solid #333", borderRadius: 8 }}>
          Create Big Goal (guided)
        </button>
      </div>

      {showWizard && (
        <div style={{ marginBottom: 16 }}>
          <BigGoalWizard onClose={() => setShowWizard(false)} onCreated={() => { setShowWizard(false); loadGoals(); }} />
        </div>
      )}

      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Create a new goal</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Goal title (e.g., Launch BYB MVP)" value={newGoalTitle} onChange={(e) => setNewGoalTitle(e.target.value)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6, flex: 1, minWidth: 240 }} />
          <input type="date" value={newGoalDate} onChange={(e) => setNewGoalDate(e.target.value)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
          <button onClick={createGoal} style={{ padding: "8px 12px", border: "1px solid #333", borderRadius: 6 }}>Add Goal</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 8, maxHeight: 420, overflow: "auto" }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Your goals</div>
          {loadingGoals ? <div>Loading…</div> : goals.length === 0 ? (
            <div style={{ color: "#666" }}>No goals yet.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {goals.map((g) => (
                <li key={g.id}>
                  <button onClick={() => setSelectedGoalId(g.id)} style={{ width: "100%", textAlign: "left", padding: 8, marginBottom: 6, borderRadius: 8, border: "1px solid #eee", background: selectedGoalId === g.id ? "#f5f5f5" : "#fff" }}>
                    <div style={{ fontWeight: 600 }}>{g.title}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {(g.goal_type || "regular")}{g.target_date ? ` • target ${g.target_date}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          {!selectedGoal ? (
            <div style={{ color: "#666" }}>Select a goal to add steps.</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{selectedGoal.title}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{selectedGoal.status}{selectedGoal.target_date ? ` • target ${selectedGoal.target_date}` : ""}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => loadSteps(selectedGoal.id)}>Refresh</button>
                  <button onClick={() => sendGoalToToday(selectedGoal)}>Send Goal to Today</button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <input placeholder="Step title (e.g., Email 10 beta users)" value={newStepTitle} onChange={(e) => setNewStepTitle(e.target.value)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6, flex: 1, minWidth: 240 }} />
                <input type="date" value={newStepDate} onChange={(e) => setNewStepDate(e.target.value)} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
                <button onClick={addStep} style={{ padding: "8px 12px", border: "1px solid #333", borderRadius: 6 }}>Add Step</button>
              </div>

              {loadingSteps ? <div>Loading…</div> : steps.length === 0 ? (
                <div style={{ color: "#666" }}>No steps yet.</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {steps.map((s) => (
                    <li key={s.id} style={{ display: "flex", justifyContent: "space-between", border: "1px solid #eee", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{s.title}</div>
                        <div style={{ fontSize: 12, color: "#666" }}>{s.status}{s.due_date ? ` • due ${s.due_date}` : ""}</div>
                      </div>
                      <div>
                        <button onClick={() => sendStepToToday(s)} style={{ marginRight: 8 }}>Send to Today</button>
                        <button onClick={() => markStepDone(s.id, s.status !== "done")}>{s.status === "done" ? "Mark Todo" : "Mark Done"}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {goalErr && <div style={{ color: "red", marginTop: 12 }}>{goalErr}</div>}
    </div>
  );
}
