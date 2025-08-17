import React, { useMemo, useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabaseClient";

/* -------- Alfred image path --------
   If your image lives at a different URL, change this string.
   Example alternatives:
   - "/assets/alfred/goals-alfred.png"
   - "/images/goals-alfred.png"
------------------------------------- */
const ALFRED_SRC = "/alfred/goals-alfred.png";

/* -------- categories + colours (match DB constraint) --------
   Allowed in DB: 'health' | 'personal' | 'financial' | 'career' | 'other'
   We can show user-friendly labels (e.g., "Business") while storing the allowed key.
---------------------------------------------------------------- */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" }, // purple
  { key: "health",    label: "Health",    color: "#22c55e" }, // green
  { key: "career",    label: "Business",  color: "#3b82f6" }, // blue (stored as 'career')
  { key: "financial", label: "Finance",   color: "#f59e0b" }, // amber (stored as 'financial')
  { key: "other",     label: "Other",     color: "#6b7280" }, // gray
] as const;
type AllowedCategory = typeof CATS[number]["key"]; // 'personal'|'health'|'career'|'financial'|'other'
const colorOf = (k: AllowedCategory) => CATS.find(c => c.key === k)?.color || "#6b7280";

/* -------- date helpers (local) -------- */
function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y,(m??1)-1,d??1);
}
function clampDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function lastDayOfMonth(y:number,m0:number){ return new Date(y,m0+1,0).getDate(); }
function addMonthsClamped(base: Date, months: number, anchorDay?: number) {
  const anchor = anchorDay ?? base.getDate();
  const y = base.getFullYear(), m = base.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDayOfMonth(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, ld));
}

/* -------- lightweight modal + help content -------- */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && closeRef.current) closeRef.current.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          maxWidth: 720,
          width: "100%",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>
            ✕
          </button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

function AlfredHelp() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>“A dream with a well thought out plan on how to achieve it becomes a goal. We want to help you achieve your dreams. The best way to help you on your journey is to set it as a goal and plan your route to get to that destination.”</em></p>

      <h4 style={{ margin: "8px 0" }}>Step-by-Step Guidance</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Write down your dream</li>
        <li>Really consider this dream and what you need to do to achieve it.</li>
        <li>Decide on a realistic deadline</li>
        <li>Imagine where you will be halfway there</li>
        <li>Break that into commitments (yearly, monthly, weekly, daily)</li>
        <li>Work on it every day and your dreams can become reality</li>
      </ol>

      <h4 style={{ margin: "8px 0" }}>Alfred’s Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Remember, every small step counts!</li>
        <li>Consistency is the key to turning dreams into reality.</li>
        <li>Be proud of progress, not just results.</li>
      </ul>

      <h4 style={{ margin: "8px 0" }}>How it appears in the app</h4>
      <p>
        In this app you set your dream as your big goal. You then note where you’ll be when you’re halfway through.
        Next you make commitments of what you will do yearly, monthly, weekly and daily. Once you lock this, the steps
        will be transferred to your calendar. When the steps are due they will show on your “Today” screen as top priority –
        after all, fulfilling our dreams should always be a top priority.
      </p>

      <p><strong>Closing Note:</strong> “You’ve turned a dream into a goal, created a plan — now let’s turn it into action together!”</p>
    </div>
  );
}

type Props = { onClose: () => void; onCreated: () => void };

export default function BigGoalWizard({ onClose, onCreated }: Props) {
  const todayISO = useMemo(() => toISO(new Date()), []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AllowedCategory>("other"); // now matches DB
  const [startDate, setStartDate] = useState(todayISO);
  const [targetDate, setTargetDate] = useState("");
  const [halfwayNote, setHalfwayNote] = useState("");
  const [monthlyCommit, setMonthlyCommit] = useState("");
  const [weeklyCommit, setWeeklyCommit] = useState("");
  const [dailyCommit, setDailyCommit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showHelp, setShowHelp] = useState(false);

  const catColor = colorOf(category);

  // halfway = exact midpoint between start and target
  const computedHalfDate = useMemo(() => {
    if (!targetDate) return "";
    const a = fromISO(startDate), b = fromISO(targetDate);
    if (b < a) return "";
    return toISO(new Date((a.getTime() + b.getTime()) / 2));
  }, [startDate, targetDate]);

  async function create() {
    setErr(null);
    if (!title.trim()) { setErr("Please enter a goal title."); return; }
    if (!targetDate)   { setErr("Please choose a target date."); return; }
    setBusy(true);
    try {
      const { data: userData, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in.");

      // 1) create goal (store category that DB accepts)
      const { data: goal, error: gerr } = await supabase.from("goals")
        .insert({
          user_id: userId,
          title: title.trim(),
          goal_type: "big",
          category,                 // <-- matches DB constraint
          category_color: catColor,
          start_date: startDate,
          target_date: targetDate,
          halfway_note: halfwayNote || null,
          halfway_date: computedHalfDate || null,
          status: "active",
        })
        .select()
        .single();
      if (gerr) throw gerr;

      // 2) seed tasks (Top Priorities) — monthly, weekly, daily
      const start = fromISO(startDate), end = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: any[] = [];
      const cat = goal.category as AllowedCategory;
      const col = goal.category_color;

      // Milestones
      tasks.push({
        user_id:userId,
        title:`BIG GOAL — Target: ${goal.title}`,
        due_date: targetDate,
        source:"big_goal_target",
        priority:2,
        category:cat,             // <-- allowed
        category_color:col
      });
      if (computedHalfDate && halfwayNote.trim()) {
        tasks.push({
          user_id:userId,
          title:`BIG GOAL — Halfway: ${halfwayNote.trim()}`,
          due_date: computedHalfDate,
          source:"big_goal_halfway",
          priority:2,
          category:cat,
          category_color:col
        });
      }

      // Monthly — start next month, same DOM
      if (monthlyCommit.trim()) {
        let d = addMonthsClamped(start, 1, start.getDate());
        while (d <= end) {
          tasks.push({
            user_id:userId,
            title:`BIG GOAL — Monthly: ${monthlyCommit.trim()}`,
            due_date: toISO(d),
            source:"big_goal_monthly",
            priority:2,
            category:cat,
            category_color:col
          });
          d = addMonthsClamped(d, 1, start.getDate());
        }
      }

      // Weekly — start next week (same weekday)
      if (weeklyCommit.trim()) {
        let d = new Date(start); d.setDate(d.getDate() + 7);
        while (d <= end) {
          tasks.push({
            user_id:userId,
            title:`BIG GOAL — Weekly: ${weeklyCommit.trim()}`,
            due_date: toISO(d),
            source:"big_goal_weekly",
            priority:2,
            category:cat,
            category_color:col
          });
          d.setDate(d.getDate() + 7);
        }
      }

      // Daily — from today (or future start) through end
      if (dailyCommit.trim()) {
        let d = clampDay(new Date(Math.max(Date.now(), start.getTime())));
        while (d <= end) {
          tasks.push({
            user_id:userId,
            title:`BIG GOAL — Daily: ${dailyCommit.trim()}`,
            due_date: toISO(d),
            source:"big_goal_daily",
            priority:2,
            category:cat,
            category_color:col
          });
          d.setDate(d.getDate() + 1);
        }
      }

      // 3) bulk insert
      for (let i = 0; i < tasks.length; i += 500) {
        const slice = tasks.slice(i, i + 500);
        const { error: terr } = await supabase.from("tasks").insert(slice);
        if (terr) throw terr;
      }

      onCreated();
      onClose();
      alert(`Big goal created! Seeded ${tasks.length} item(s).`);
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
        position: "relative", // allow top-right Alfred
      }}
    >
      {/* Alfred in the top-right */}
      <button
        onClick={() => setShowHelp(true)}
        aria-label="Open Alfred help"
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
        }}
      >
        <img
          src={ALFRED_SRC}
          alt="Alfred — open help"
          style={{ width: 56, height: 56 }}
        />
      </button>

      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Create a Big Goal (guided)</h2>

      <div style={{ display: "grid", gap: 10 }}>
        {/* title */}
        <label>
          <div className="muted">Big goal title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Get 30 new customers" />
        </label>

        {/* category */}
        <label>
          <div className="muted">Category</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={category} onChange={e=>setCategory(e.target.value as AllowedCategory)}>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span title="Category color" style={{ display:"inline-block", width:18, height:18, borderRadius:999, background:catColor, border:"1px solid #ccc" }} />
          </div>
        </label>

        {/* dates */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="muted">Start date</div>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="muted">Target date</div>
            <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} />
          </label>
        </div>

        {/* halfway note */}
        <label>
          <div className="muted">How will you know you’re halfway?</div>
          <input value={halfwayNote} onChange={e=>setHalfwayNote(e.target.value)} placeholder="e.g., 15 customers or £X MRR" />
          {computedHalfDate && <div className="muted" style={{ marginTop:6 }}>Halfway milestone: <b>{computedHalfDate}</b></div>}
        </label>

        {/* commitments — ORDER: Monthly → Weekly → Daily */}
        <label>
          <div className="muted">Monthly commitment (optional)</div>
          <input value={monthlyCommit} onChange={e=>setMonthlyCommit(e.target.value)} placeholder="e.g., At least 2 new customers" />
          <div className="muted" style={{ marginTop:6 }}>Starts next month on same day-of-month.</div>
        </label>

        <label>
          <div className="muted">Weekly commitment (optional)</div>
          <input value={weeklyCommit} onChange={e=>setWeeklyCommit(e.target.value)} placeholder="e.g., 5 new prospects" />
          <div className="muted" style={{ marginTop:6 }}>Starts next week on same weekday.</div>
        </label>

        <label>
          <div className="muted">Daily commitment (optional)</div>
          <input value={dailyCommit} onChange={e=>setDailyCommit(e.target.value)} placeholder="e.g., Call or email 15 people" />
          <div className="muted" style={{ marginTop:6 }}>Seeds every day from today (or future start) through target date.</div>
        </label>

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={create} disabled={busy} className="btn-primary" style={{ borderRadius:8 }}>{busy?"Creating…":"Create Big Goal"}</button>
          <button onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Goals — Help">
        <div style={{ display: "flex", gap: 16 }}>
          <img
            src={ALFRED_SRC}
            alt=""
            aria-hidden="true"
            style={{ width: 72, height: 72, flex: "0 0 auto" }}
          />
          <AlfredHelp />
        </div>
      </Modal>
    </div>
  );
}
