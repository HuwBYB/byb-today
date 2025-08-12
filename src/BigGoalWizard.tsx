import { useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

type Props = {
  onClose: () => void;
  onCreated: () => void; // called after inserts succeed
};

export default function BigGoalWizard({ onClose, onCreated }: Props) {
  const today = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [targetDate, setTargetDate] = useState("");
  const [halfwayNote, setHalfwayNote] = useState("");
  const [monthlyCommit, setMonthlyCommit] = useState("");
  const [weeklyCommit, setWeeklyCommit] = useState("");
  const [dailyCommit, setDailyCommit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const computedHalfDate = useMemo(() => {
    if (!targetDate) return "";
    const a = fromISO(startDate);
    const b = fromISO(targetDate);
    if (b < a) return "";
    const mid = new Date((a.getTime() + b.getTime()) / 2);
    return toISO(mid);
  }, [startDate, targetDate]);

  async function create() {
    setErr(null);
    if (!title.trim()) { setErr("Please enter a goal title."); return; }
    if (!targetDate) { setErr("Please choose a target date."); return; }
    setBusy(true);
    try {
      // 1) who am I
      const { data: userData, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in.");

      // 2) insert goal
      const { data: goal, error: gerr } = await supabase.from("goals")
        .insert({
          user_id: userId,
          title: title.trim(),
          goal_type: "big",
          start_date: startDate,
          target_date: targetDate,
          halfway_note: halfwayNote || null,
          halfway_date: computedHalfDate || null,
          monthly_commitment: monthlyCommit || null,
          weekly_commitment: weeklyCommit || null,
          daily_commitment: dailyCommit || null,
          status: "active",
        })
        .select()
        .single();
      if (gerr) throw gerr;

      // 3) seed tasks
      const start = fromISO(startDate);
      const end = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: any[] = [];

      // target/milestone
      tasks.push({
        user_id: userId,
        title: goal.title,
        due_date: targetDate,
        source: "big_goal_target",
        priority: 0,
      });
      if (computedHalfDate && halfwayNote.trim()) {
        tasks.push({
          user_id: userId,
          title: `Halfway: ${halfwayNote.trim()}`,
          due_date: computedHalfDate,
          source: "big_goal_halfway",
          priority: 0,
        });
      }

      // monthly on the same day-of-month as start
      if (monthlyCommit.trim()) {
        let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        while (d <= end) {
          tasks.push({
            user_id: userId,
            title: `Monthly: ${monthlyCommit.trim()}`,
            due_date: toISO(d),
            source: "big_goal_monthly",
            priority: 0,
          });
          d.setMonth(d.getMonth() + 1);
        }
      }

      // weekly on the same weekday as start
      if (weeklyCommit.trim()) {
        let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        while (d <= end) {
          tasks.push({
            user_id: userId,
            title: `Weekly: ${weeklyCommit.trim()}`,
            due_date: toISO(d),
            source: "big_goal_weekly",
            priority: 0,
          });
          d.setDate(d.getDate() + 7);
        }
      }

      // daily — only seed next 30 days to avoid huge inserts
      if (dailyCommit.trim()) {
        const limit = new Date();
        limit.setDate(limit.getDate() + 30);
        const dailyEnd = end < limit ? end : limit;
        let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        // if start is in the past, begin from today
        const todayDate = new Date();
        if (d < todayDate) d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
        while (d <= dailyEnd) {
          tasks.push({
            user_id: userId,
            title: `Daily: ${dailyCommit.trim()}`,
            due_date: toISO(d),
            source: "big_goal_daily",
            priority: 0,
          });
          d.setDate(d.getDate() + 1);
        }
      }

      if (tasks.length > 0) {
        const { error: terr } = await supabase.from("tasks").insert(tasks);
        if (terr) throw terr;
      }

      onCreated(); // refresh goals list in parent
      onClose();
      alert(`Big goal created! Seeded ${tasks.length} calendar item(s).`);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, background: "#fff" }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Create a Big Goal (guided)</h2>

      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Big goal title</div>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Grow CHH revenue by 30%" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Start date</div>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Target date</div>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
          </label>
        </div>

        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>How will you know when you’re halfway?</div>
          <input value={halfwayNote} onChange={e => setHalfwayNote(e.target.value)} placeholder="e.g., Hit £X MRR or 50 beta clients" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
          {computedHalfDate && <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>We’ll place a halfway milestone on <b>{computedHalfDate}</b>.</div>}
        </label>

        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Monthly commitment (optional)</div>
          <input value={monthlyCommit} onChange={e => setMonthlyCommit(e.target.value)} placeholder="e.g., Review KPIs + plan next month" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
        </label>

        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Weekly commitment (optional)</div>
          <input value={weeklyCommit} onChange={e => setWeeklyCommit(e.target.value)} placeholder="e.g., Do 2 outreach sessions & 1 demo" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
        </label>

        <label>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Daily commitment (optional)</div>
          <input value={dailyCommit} onChange={e => setDailyCommit(e.target.value)} placeholder="e.g., 30-min deep work on BYB" style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6 }} />
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>We’ll seed the next 30 days of daily items (you can repeat later).</div>
        </label>

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={create} disabled={busy} style={{ padding: "8px 12px", border: "1px solid #333", borderRadius: 6 }}>
            {busy ? "Creating…" : "Create Big Goal"}
          </button>
          <button onClick={onClose} disabled={busy} style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, background: "#fafafa" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
