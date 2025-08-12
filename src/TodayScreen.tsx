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

// ---- recurrence helpers (local time) ----
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function addDaysISO(iso: string, days: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}
function lastDayOfMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}
function addMonthsClampedISO(iso: string, months: number) {
  const d = fromISO(iso);
  const anchor = d.getDate();
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDayOfMonth(first.getFullYear(), first.getMonth());
  const day = Math.min(anchor, ld);
  return toISO(new Date(first.getFullYear(), first.getMonth(), day));
}
function nextDue(iso: string, freq: string) {
  switch (freq) {
    case "daily": return addDaysISO(iso, 1);
    case "weekly": return addDaysISO(iso, 7);
    case "monthly": return addMonthsClampedISO(iso, 1);
    case "yearly": return addMonthsClampedISO(iso, 12);
    default: return iso;
  }
}

export default function TodayScreen({ externalDateISO }: { externalDateISO?: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(todayISO());
  const [items, setItems] = useState<any[]>([]);
  const [affirmation, setAffirmation] = useState<any>(null);
  const [affirmationText, setAffirmationText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  // Add Task form
  const [newTask, setNewTask] = useState<string>("");
  const [newTaskDate, setNewTaskDate] = useState<string>(todayISO());
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [recurFreq, setRecurFreq] = useState<"daily" | "weekly" | "monthly" | "yearly">("daily");

  // pick up date from Calendar when provided
  useEffect(() => {
    if (externalDateISO) {
      setDateISO(externalDateISO);
      setNewTaskDate(externalDateISO);
    }
  }, [externalDateISO]);

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

  const topPriority = useMemo(() => items.filter(i => i.priority === 2), [items]);
  const others = useMemo(() => items.filter(i => i.priority !== 2), [items]);

  async function addTask() {
    if (!newTask.trim() || !userId) return;
    const payload: any = {
      user_id: userId,
      title: newTask.trim(),
      due_date: newTaskDate,
      source: "manual",
    };
    if (isRecurring) {
      payload.is_recurring = true;
      payload.recur_freq = recurFreq;
    }
    const { error } = await supabase.from("tasks").insert(payload);
    if (error) { setErr(error.message); return; }
    setNewTask("");
    setIsRecurring(false);
    setRecurFreq("daily");
    setNewTaskDate(dateISO);
    refresh();
  }

  // mark item complete; if recurring task, spawn the next occurrence
  async function completeItem(itemType: ItemType, id: number) {
    if (itemType !== "task") {
      // if you later add daily_actions, handle separately
      const { error } = await supabase.from("daily_actions").update({ status: "done" }).eq("id", id);
      if (error) { setErr(error.message); return; }
      refresh();
      return;
    }

    try {
      // get the task (to know if recurring, its freq, and its due_date)
      const { data: row, error: selErr } = await supabase
        .from("tasks")
        .select("id,user_id,title,priority,source,due_date,is_recurring,recur_freq,recur_until")
        .eq("id", id)
        .single();
      if (selErr) throw selErr;

      // mark done
      const { error: upErr } = await supabase.from("tasks").update({ status: "done" }).eq("id", id);
      if (upErr) throw upErr;

      // if recurring, create the next one
      if (row?.is_recurring && row.recur_freq && row.due_date) {
        const next = nextDue(row.due_date, row.recur_freq);
        // respect optional end date
        const until = row.recur_until as string | null;
        if (!until || next <= until) {
          const { error: insErr } = await supabase.from("tasks").insert({
            user_id: row.user_id,
            title: row.title,
            due_date: next,
            source: row.source || "manual",
            priority: row.priority ?? 0,
            is_recurring: true,
            recur_freq: row.recur_freq,
            recur_until: until || null,
          });
          if (insErr) throw insErr;
        }
      }
      refresh();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
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
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Day view — {dateISO}
      </h1>
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
          <h2 style={{ fontSize: 18 }}>Top Priority</h2>
          <button onClick={() => refresh()}>Refresh</button>
        </div>
        {loading ? <div>Loading…</div> :
         topPriority.length === 0 ? <div style={{ color: "#666" }}>No top-priority items yet.</div> :
         <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
           {topPriority.map(i => (
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
                 <button onClick={() => setFocus(i.item_type, i.item_id, true)} style={{ marginRight: 8 }}>Make Top</button>
                 <button onClick={() => completeItem(i.item_type, i.item_id)}>Done</button>
               </div>
             </li>
           ))}
         </ul>}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Add Task</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Task title (e.g., Buy gift for Carys)"
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
          <input
            type="date"
            value={newTaskDate}
            onChange={e => setNewTaskDate(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
          <button onClick={addTask} style={{ padding: "8px 12px", border: "1px solid #333", borderRadius: 6 }}>Add</button>
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
            Repeat
          </label>
          <select
            disabled={!isRecurring}
            value={recurFreq}
            onChange={e => setRecurFreq(e.target.value as any)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <span style={{ fontSize: 12, color: "#666" }}>
            {isRecurring ? "Next one auto-creates when you mark it Done." : " "}
          </span>
        </div>
      </div>

      {err && <div style={{ color: "red", marginTop: 12 }}>{err}</div>}
    </div>
  );
}
