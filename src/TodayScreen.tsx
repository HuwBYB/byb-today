import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type ItemType = "task" | "daily_action";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function TodayScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(todayISO());
  const [items, setItems] = useState<any[]>([]);
  const [affirmation, setAffirmation] = useState<any>(null);
  const [affirmationText, setAffirmationText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<string>("");
  const [newTaskDate, setNewTaskDate] = useState<string>(todayISO());

  // get signed-in user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // load today items + current affirmation
  async function refresh() {
    if (!userId) return;
    setLoading(true);
    setErr(null);
    try {
      const [{ data: list, error: e1 }, { data: aff, error: e2 }] = await Promise.all([
        supabase.from("daily_items_v").select("*")
          .eq("user_id", userId)
          .eq("item_date", dateISO)
          .order("priority", { ascending: false })
          .order("created_at", { ascending: true }),
        supabase.from("affirmations").select("*")
          .eq("user_id", userId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle(),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setItems(list || []);
      setAffirmation(aff || null);
      setAffirmationText("");
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (userId) refresh(); }, [userId, dateISO]);

  const top3 = useMemo(() => items.filter(i => i.priority === 2), [items]);
  const others = useMemo(() => items.filter(i => i.priority !== 2), [items]);

  async function addTask() {
    if (!newTask.trim() || !userId) return;
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title: newTask.trim(),
      due_date: newTaskDate,
      source: "manual"
    });
    if (error) { setErr(error.message); return; }
    setNewTask("");
    setNewTaskDate(dateISO);
    refresh();
  }

  async function completeItem(itemType: ItemType, id: number) {
    const table = itemType === "task" ? "tasks" : "daily_actions";
    const { error } = await supabase.from(table).update({ status: "done" }).eq("id", id);
    if (error) { setErr(error.message); return; }
    refresh();
  }

  async function setFocus(itemType: ItemType, id: number, isFocus: boolean) {
    const table = itemType === "task" ? "tasks" : "daily_actions";
    const { error } = await supabase.from(table).update({ priority: isFocus ? 2 : 0 }).eq("id", id);
    if (error) { setErr(error.message); return; }
    refresh();
  }

  // save a brand-new active affirmation
  async function saveAffirmation() {
    if (!userId) return;
    const text = affirmationText.trim();
    if (!text) return;
    const { error } = await supabase.from("affirmations").insert({
      user_id: userId,
      text,
      is_active: true,
      generated_by: "user"
    });
    if (error) { setErr(error.message); return; }
    refresh();
  }

  return (
    <div style={{ padding: 16, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Today</h1>
      <input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />

      {/* Affirmation viewer + builder */}
      <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Affirmation</div>
        {affirmation ? (
          <div style={{ fontSize: 18, marginBottom: 8 }}>{affirmation.text}</div>
        ) : (
          <div style={{ color: "#666", marginBottom: 8 }}>No active affirmation yet.</div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Write a new affirmation…"
            value={affirmationText}
            onChange={e => setAffirmationText(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6, flex: 1, minWidth: 200 }}
          />
          <button onClick={saveAffirmation} style={{ padding: "8px 12px", border: "1px solid #333", borderRadius: 6 }}>
            Save new affirmation
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ fontSize: 18 }}>Top 3 Focus</h2>
          <button onClick={() => refresh()}>Refresh</button>
        </div>
        {loading ? <div>Loading…</div> :
         top3.length === 0 ? <div style={{ color: "#666" }}>No focus items yet.</div> :
         <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
           {top3.map(i => (
             <li key={`${i.item_type}-${i.item_id}`} style={{ display: "flex", justifyContent: "space-between", border: "1px solid #eee", borderRadius: 8, padding: 8, marginBottom: 8 }}>
               <div>
                 <div style={{ fontWeight: 600 }}>{i.title}</div>
                 <div style={{ fontSize: 12, color: "#666" }}>{i.item_type === "daily_action" ? "Big Goal step" : i.source}</div>
               </div>
               <div>
                 <button onClick={() => setFocus(i.item_type, i.item_id, false)} style={{ marginRight: 8 }}>Unfocus</button>
                 <button onClick={() => completeItem(i.item_type, i.item_id)}>Done</button>
               </div>
             </li>
           ))}
         </ul>}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Everything Else</h2>
        {loading ? <div>Loading…</div> :
         others.length === 0 ? <div style={{ color: "#666" }}>Nothing else scheduled.</div> :
         <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
           {others.map(i => (
             <li key={`${i.item_type}-${i.item_id}`} style={{ display: "flex", justifyContent: "space-between", border: "1px solid #eee", borderRadius: 8, padding: 8, marginBottom: 8 }}>
               <div>
                 <div style={{ fontWeight: 600 }}>{i.title}</div>
                 <div style={{ fontSize: 12, color: "#666" }}>{i.item_type === "daily_action" ? "Big Goal step" : i.source}</div>
               </div>
               <div>
                 <button onClick={() => setFocus(i.item_type, i.item_id, true)} style={{ marginRight: 8 }}>Make Top 3</button>
                 <button onClick={() => completeItem(i.item_type, i.item_id)}>Done</button>
               </div>
             </li>
           ))}
         </ul>}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Add Task</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Task title (e.g., Buy gift for Carys)"
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6, flex: 1, minWidth: 200 }}
          />
          <input
            type="date"
            value={newTaskDate}
            onChange={e => setNewTaskDate(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
          <button onClick={addTask} style={{ padding: "8px 12px", border: "1px solid #333", borderRadius: 6 }}>Add</button>
        </div>
      </div>

      {err && <div style={{ color: "red", marginTop: 12 }}>{err}</div>}
    </div>
  );
}

