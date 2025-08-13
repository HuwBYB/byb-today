import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null;     // 'YYYY-MM-DD'
  status: "pending" | "done" | string;
  priority: number | null;     // >=2 = Top 3 Focus
  source: string | null;       // e.g. 'big_goal_daily'
  category: string | null;
  category_color: string | null;
  completed_at: string | null; // ISO timestamp
};

type Props = {
  /** When provided, Today screen shows this date (YYYY-MM-DD). */
  externalDateISO?: string;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Ensure we show a clean title without duplicate BIG GOAL prefix */
function displayTitle(t: Task) {
  const base = (t.title || "").trim();
  const isBigSource = (t.source || "").startsWith("big_goal");
  const alreadyPrefixed = base.toUpperCase().startsWith("BIG GOAL");
  return isBigSource && !alreadyPrefixed ? `BIG GOAL — ${base}` : base;
}

export default function TodayScreen({ externalDateISO }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(externalDateISO || todayISO());

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add form
  const [newTitle, setNewTitle] = useState("");
  const [newTop, setNewTop] = useState(false);
  const [adding, setAdding] = useState(false);

  // Sync when parent changes selected date
  useEffect(() => {
    if (externalDateISO) setDateISO(externalDateISO);
  }, [externalDateISO]);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .eq("due_date", dateISO)
        .order("priority", { ascending: false })
        .order("id", { ascending: true });
      if (error) throw error;
      setTasks((data as Task[]) || []);
    } catch (e: any) {
      setErr(e.message || String(e));
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (userId && dateISO) load(); }, [userId, dateISO]);

  const top = tasks.filter(t => (t.priority ?? 0) >= 2);
  const rest = tasks.filter(t => (t.priority ?? 0) < 2);

  async function toggleDone(t: Task) {
    try {
      const markDone = t.status !== "done";
      const { error } = await supabase
        .from("tasks")
        .update({
          status: markDone ? "done" : "pending",
          completed_at: markDone ? new Date().toISOString() : null, // important for Wins
        })
        .eq("id", t.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function addTask() {
    const title = newTitle.trim();
    if (!userId || !title) return;
    setAdding(true); setErr(null);
    try {
      const { error } = await supabase.from("tasks").insert({
        user_id: userId,
        title,
        due_date: dateISO,
        status: "pending",
        priority: newTop ? 2 : 0,
        source: "manual",
      });
      if (error) throw error;
      setNewTitle("");
      setNewTop(false);
      await load();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setAdding(false);
    }
  }

  function Section({ title, children }: { title: string; children: any }) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>Today</h1>
          <div className="muted">{dateISO}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="date"
            value={dateISO}
            onChange={e => setDateISO(e.target.value)}
            title="Change date"
          />
          <button onClick={() => setDateISO(todayISO())}>Today</button>
        </div>
      </div>

      {/* Top 3 Focus */}
      <Section title="Top 3 Focus">
        {top.length === 0 ? (
          <div className="muted">Nothing marked top priority for this day.</div>
        ) : (
          <ul className="list">
            {top.map(t => (
              <li key={t.id} className="item">
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    onChange={() => toggleDone(t)}
                    title={t.status === "done" ? "Mark as not done" : "Mark as done"}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{displayTitle(t)}</div>
                    {/* removed the source line to keep the UI clean */}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Everything Else */}
      <Section title="Everything Else">
        {rest.length === 0 ? (
          <div className="muted">Nothing else scheduled.</div>
        ) : (
          <ul className="list">
            {rest.map(t => (
              <li key={t.id} className="item">
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    onChange={() => toggleDone(t)}
                    title={t.status === "done" ? "Mark as not done" : "Mark as done"}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: (t.priority ?? 0) >= 2 ? 600 : 400 }}>{displayTitle(t)}</div>
                    {/* removed the source line to keep the UI clean */}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Add Task */}
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Add Task</h2>
        <label style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Task title</div>
          <input
            type="text"
            placeholder="e.g., Buy gift for Carys"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={newTop} onChange={(e) => setNewTop(e.target.checked)} />
            Mark as Top Priority
          </label>
          <div className="muted">Will be created for {dateISO}</div>
          <button
            onClick={addTask}
            disabled={!newTitle.trim() || adding}
            className="btn-primary"
            style={{ marginLeft: "auto", borderRadius: 8 }}
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>
    </div>
  );
}
