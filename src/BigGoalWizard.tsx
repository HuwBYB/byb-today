import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* -------- categories + colours (match DB constraint) --------
   Allowed in DB: 'health' | 'personal' | 'financial' | 'career' | 'other'
---------------------------------------------------------------- */
const CATS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" }, // purple
  { key: "health",    label: "Health",    color: "#22c55e" }, // green
  { key: "career",    label: "Business",  color: "#3b82f6" }, // blue (stored as 'career')
  { key: "financial", label: "Finance",   color: "#f59e0b" }, // amber (stored as 'financial')
  { key: "other",     label: "Other",     color: "#6b7280" }, // gray
] as const;
type AllowedCategory = typeof CATS[number]["key"];
const colorOf = (k: AllowedCategory) => CATS.find(c => c.key === k)?.color || "#6b7280";

/* -------- date helpers (local) -------- */
function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function clampDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function lastDayOfMonth(y: number, m0: number) { return new Date(y, m0 + 1, 0).getDate(); }
function addMonthsClamped(base: Date, months: number, anchorDay?: number) {
  const anchor = anchorDay ?? base.getDate();
  const y = base.getFullYear(), m = base.getMonth() + months;
  const first = new Date(y, m, 1);
  const ld = lastDayOfMonth(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, ld));
}
function daysInMonth(year: number, monthIndex0: number) {
  return lastDayOfMonth(year, monthIndex0);
}

/* -------- props -------- */
export type BigGoalWizardProps = {
  onClose?: () => void;
  onCreated?: () => void;
};

/* -------- steps -------- */
type StepKey = "title" | "category" | "dates" | "halfway" | "monthly" | "weekly" | "daily" | "review";
const STEP_ORDER: StepKey[] = ["title","category","dates","halfway","monthly","weekly","daily","review"];

/* ========================= Component ========================= */

export default function BigGoalWizard({ onClose, onCreated }: BigGoalWizardProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const todayISO = useMemo(() => toISO(new Date()), []);
  const [step, setStep] = useState<StepKey>("title");

  // form state
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AllowedCategory>("other");
  const [startDate, setStartDate] = useState(todayISO);
  const [targetDate, setTargetDate] = useState("");
  const [halfwayNote, setHalfwayNote] = useState("");
  const [monthlyCommit, setMonthlyCommit] = useState("");
  const [weeklyCommit, setWeeklyCommit] = useState("");
  const [dailyCommit, setDailyCommit] = useState("");

  // ux / system
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const catColor = colorOf(category);

  // focus the title automatically when wizard mounts
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);

  // HARD BLOCK: swallow global hotkeys while typing inside the wizard (capture phase)
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const t = ev.target as Node | null;
      if (t && root.contains(t)) {
        // Let native typing happen, but stop bubbling to app-level hotkeys
        ev.stopPropagation();
      }
    };
    window.addEventListener("keydown", handler, true); // capture
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // halfway = exact midpoint between start and target
  const computedHalfDate = useMemo(() => {
    if (!targetDate) return "";
    const a = fromISO(startDate), b = fromISO(targetDate);
    if (b < a) return "";
    return toISO(new Date((a.getTime() + b.getTime()) / 2));
  }, [startDate, targetDate]);

  const stepIndex = STEP_ORDER.indexOf(step);
  const progressPct = ((stepIndex + 1) / STEP_ORDER.length) * 100;

  // prevent global shortcuts from stealing focus while typing (React layer)
  function stopKeyBubble(e: React.KeyboardEvent) {
    e.stopPropagation();
  }

  function goNext() {
    setErr(null);
    const idx = STEP_ORDER.indexOf(step);
    const next = STEP_ORDER[idx + 1];
    if (!next) return;
    // light validation on required steps
    if (step === "title" && !title.trim()) { setErr("Give your goal a name you’re proud of."); return; }
    if (step === "dates") {
      if (!targetDate) { setErr("Pick your target date."); return; }
      const a = fromISO(startDate), b = fromISO(targetDate);
      if (b < a) { setErr("Target must be after the start."); return; }
    }
    setStep(next);
  }
  function goBack() {
    setErr(null);
    const idx = STEP_ORDER.indexOf(step);
    const prev = STEP_ORDER[idx - 1];
    if (prev) setStep(prev);
  }

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

      // 1) create goal
      const { data: goal, error: gerr } = await supabase.from("goals")
        .insert({
          user_id: userId,
          title: title.trim(),
          goal_type: "big",
          category,
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

      // 2) seed tasks — ONLY FIRST HALF (up to halfway date inclusive)
      const start = fromISO(startDate);
      const end   = fromISO(targetDate);
      if (end < start) throw new Error("Target date is before start date.");

      const tasks: any[] = [];
      const cat = goal.category as AllowedCategory;
      const col = goal.category_color;

      // Milestones
      tasks.push({
        user_id: userId,
        goal_id: goal.id,
        title: `BIG GOAL — Target: ${goal.title}`,
        due_date: targetDate,
        source: "big_goal_target",
        priority: 2,
        category: cat,
        category_color: col
      });

      if (computedHalfDate) {
        tasks.push({
          user_id: userId,
          goal_id: goal.id,
          title: `BIG GOAL — Midpoint Review${halfwayNote.trim() ? `: ${halfwayNote.trim()}` : ""}`,
          due_date: computedHalfDate,
          source: "big_goal_midpoint_review",
          priority: 2,
          category: cat,
          category_color: col
        });
      }

      const halfISO = computedHalfDate || targetDate;
      const half = fromISO(halfISO);
      const withinFirstHalf = (d: Date) => d <= half;

      // Monthly
      if (monthlyCommit.trim()) {
        let d = addMonthsClamped(start, 1, start.getDate());
        while (withinFirstHalf(d)) {
          tasks.push({
            user_id: userId, goal_id: goal.id,
            title: `BIG GOAL — Monthly: ${monthlyCommit.trim()}`,
            due_date: toISO(d), source: "big_goal_monthly", priority: 2,
            category: cat, category_color: col
          });
          d = addMonthsClamped(d, 1, start.getDate());
        }
      }
      // Weekly
      if (weeklyCommit.trim()) {
        let d = new Date(start); d.setDate(d.getDate() + 7);
        while (withinFirstHalf(d)) {
          tasks.push({
            user_id: userId, goal_id: goal.id,
            title: `BIG GOAL — Weekly: ${weeklyCommit.trim()}`,
            due_date: toISO(d), source: "big_goal_weekly", priority: 2,
            category: cat, category_color: col
          });
          d.setDate(d.getDate() + 7);
        }
      }
      // Daily
      if (dailyCommit.trim()) {
        let d = clampDay(new Date(Math.max(Date.now(), start.getTime())));
        while (withinFirstHalf(d)) {
          tasks.push({
            user_id: userId, goal_id: goal.id,
            title: `BIG GOAL — Daily: ${dailyCommit.trim()}`,
            due_date: toISO(d), source: "big_goal_daily", priority: 2,
            category: cat, category_color: col
          });
          d.setDate(d.getDate() + 1);
        }
      }

      for (let i = 0; i < tasks.length; i += 500) {
        const slice = tasks.slice(i, i + 500);
        const { error: terr } = await supabase.from("tasks").insert(slice);
        if (terr) throw terr;
      }

      onCreated?.();
      onClose?.();
      alert(`🔥 Big goal created! Seeded ${tasks.length} item(s) for the first half.`);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------- UI Building Blocks ---------------------- */

  const Header = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ height: 8, background: "#eef2ff", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${progressPct}%`, height: "100%", background: "#6d28d9", transition: "width 300ms ease" }} />
      </div>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span>Step {stepIndex + 1} of {STEP_ORDER.length}</span>
        <span>{Math.round(progressPct)}%</span>
      </div>
    </div>
  );

  function Nav({ showSkip }: { showSkip?: boolean }) {
    return (
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button type="button" onClick={goBack} disabled={step === "title" || busy}>Back</button>
        <div style={{ flex: 1 }} />
        {showSkip && <button type="button" onClick={goNext} disabled={busy}>Skip</button>}
        {step !== "review" ? (
          <button type="button" className="btn-primary" onClick={goNext} disabled={busy} style={{ borderRadius: 8 }}>
            Next →
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={create} disabled={busy} style={{ borderRadius: 8 }}>
            {busy ? "Creating…" : "Create Big Goal"}
          </button>
        )}
      </div>
    );
  }

  function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
      <div
        className="card"
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 16,
          background: "#fff",
          boxShadow: "0 10px 30px rgba(109,40,217,0.06)",
          animation: "fadeIn 220ms ease",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
        {subtitle && <div className="muted" style={{ marginTop: 4 }}>{subtitle}</div>}
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    );
  }

  /* -------- Segmented Date Picker (Day / Month / Year) -------- */

  function SegmentedDate({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;            // YYYY-MM-DD (or "")
    onChange: (iso: string) => void;
  }) {
    // parse incoming date or default to today
    const base = value ? fromISO(value) : new Date();
    const [y, setY] = useState(base.getFullYear());
    const [m, setM] = useState(base.getMonth()); // 0..11
    const [d, setD] = useState(base.getDate());

    // keep day in range if month/year change
    const dim = daysInMonth(y, m);
    const safeD = Math.min(d, dim);

    // build ISO on any change
    function emit(nextY = y, nextM = m, nextD = safeD) {
      const iso = toISO(new Date(nextY, nextM, nextD));
      onChange(iso);
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const years: number[] = [];
    for (let yy = currentYear - 50; yy <= currentYear + 50; yy++) years.push(yy); // wide range for long goals
    const months = [
      "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"
    ];

    return (
      <div onKeyDown={stopKeyBubble} onKeyUp={stopKeyBubble}>
        <div className="muted" style={{ marginBottom: 6 }}>{label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: 8 }}>
          {/* Day */}
          <select
            value={safeD}
            onChange={(e) => { const nd = Number(e.target.value); setD(nd); emit(y, m, nd); }}
            onWheel={(e) => {
              e.preventDefault();
              const dir = Math.sign(e.deltaY);
              const nd = Math.min(Math.max(1, safeD + dir), daysInMonth(y, m));
              setD(nd); emit(y, m, nd);
            }}
            aria-label="Day"
          >
            {Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1).map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>

          {/* Month */}
          <select
            value={m}
            onChange={(e) => {
              const nm = Number(e.target.value);
              setM(nm);
              const nd = Math.min(safeD, daysInMonth(y, nm));
              setD(nd);
              emit(y, nm, nd);
            }}
            onWheel={(e) => {
              e.preventDefault();
              const dir = Math.sign(e.deltaY);
              let nm = m + dir;
              if (nm < 0) nm = 11;
              if (nm > 11) nm = 0;
              setM(nm);
              const nd = Math.min(safeD, daysInMonth(y, nm));
              setD(nd);
              emit(y, nm, nd);
            }}
            aria-label="Month"
          >
            {months.map((mm, idx) => (
              <option key={mm} value={idx}>{mm}</option>
            ))}
          </select>

          {/* Year */}
          <select
            value={y}
            onChange={(e) => {
              const ny = Number(e.target.value);
              setY(ny);
              const nd = Math.min(safeD, daysInMonth(ny, m));
              setD(nd);
              emit(ny, m, nd);
            }}
            onWheel={(e) => {
              e.preventDefault();
              const dir = Math.sign(e.deltaY);
              const ny = y + dir;
              setY(ny);
              const nd = Math.min(safeD, daysInMonth(ny, m));
              setD(nd);
              emit(ny, m, nd);
            }}
            aria-label="Year"
          >
            {years.map(yy => (
              <option key={yy} value={yy}>{yy}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  /* ----------------------------- Steps ----------------------------- */

  function StepTitle() {
    return (
      <Card
        title="Name your Big Goal"
        subtitle="Make it inspiring and specific — this is your North Star."
      >
        <input
          ref={titleRef}
          data-biggoal-title
          autoComplete="off"
          inputMode="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { stopKeyBubble(e); if (e.key === "Enter") goNext(); }}
          onKeyUp={stopKeyBubble}
          placeholder="e.g., Grow revenue to £25k/mo"
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Tip: Start with a verb — “grow”, “launch”, “run”, “write”.
        </div>
        <Nav />
      </Card>
    );
  }

  function StepCategory() {
    return (
      <Card
        title="Which area of life?"
        subtitle="Helps keep your goals balanced."
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 8 }}>
            {CATS.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className="btn-soft"
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: category === c.key ? `2px solid ${c.color}` : "1px solid var(--border)",
                  boxShadow: category === c.key ? "0 0 0 4px rgba(0,0,0,0.03)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "center",
                  fontWeight: category === c.key ? 700 : 500,
                }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 999, background: c.color }} />
                {c.label}
              </button>
            ))}
          </div>
          <Nav />
        </div>
      </Card>
    );
  }

  function StepDates() {
    return (
      <Card
        title="When will you start and finish?"
        subtitle="Set your start and target dates. We’ll calculate the halfway point."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <SegmentedDate
            label="Start date"
            value={startDate}
            onChange={setStartDate}
          />
          <SegmentedDate
            label="Target date"
            value={targetDate || todayISO}
            onChange={setTargetDate}
          />

          {targetDate && computedHalfDate && (
            <div
              style={{
                marginTop: 6,
                padding: 10,
                borderRadius: 10,
                border: "1px dashed #c084fc",
                background: "#faf5ff",
                color: "#4c1d95"
              }}
            >
              Halfway milestone: <b>{computedHalfDate}</b>
            </div>
          )}
          {err && <div style={{ color: "crimson" }}>{err}</div>}
          <Nav />
        </div>
      </Card>
    );
  }

  function StepHalfway() {
    return (
      <Card
        title="How will you know you’re halfway?"
        subtitle="Describe the checkpoint that proves you’re on track."
      >
        <input
          autoComplete="off"
          inputMode="text"
          value={halfwayNote}
          onChange={(e) => setHalfwayNote(e.target.value)}
          onKeyDown={(e) => { stopKeyBubble(e); if (e.key === "Enter") goNext(); }}
          onKeyUp={stopKeyBubble}
          placeholder="e.g., 50% of users onboarded, £12.5k MRR, 15 clients…"
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          This appears on your midpoint review task to refocus your plan.
        </div>
        <Nav showSkip />
      </Card>
    );
  }

  function StepMonthly() {
    return (
      <Card
        title="Monthly commitment"
        subtitle="What will you do each month to move the needle?"
      >
        <input
          autoComplete="off"
          inputMode="text"
          value={monthlyCommit}
          onChange={(e) => setMonthlyCommit(e.target.value)}
          onKeyDown={(e) => { stopKeyBubble(e); if (e.key === "Enter") goNext(); }}
          onKeyUp={stopKeyBubble}
          placeholder="e.g., Close 2 new customers"
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          We’ll schedule these each month in the first half (from your start).
        </div>
        <Nav showSkip />
      </Card>
    );
  }

  function StepWeekly() {
    return (
      <Card
        title="Weekly commitment"
        subtitle="Small, repeatable actions build momentum."
      >
        <input
          autoComplete="off"
          inputMode="text"
          value={weeklyCommit}
          onChange={(e) => setWeeklyCommit(e.target.value)}
          onKeyDown={(e) => { stopKeyBubble(e); if (e.key === "Enter") goNext(); }}
          onKeyUp={stopKeyBubble}
          placeholder="e.g., Book 5 prospect calls"
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          We’ll schedule these weekly in the first half.
        </div>
        <Nav showSkip />
      </Card>
    );
  }

  function StepDaily() {
    return (
      <Card
        title="Daily commitment"
        subtitle="Tiny daily actions create outsized results."
      >
        <input
          autoComplete="off"
          inputMode="text"
          value={dailyCommit}
          onChange={(e) => setDailyCommit(e.target.value)}
          onKeyDown={(e) => { stopKeyBubble(e); if (e.key === "Enter") goNext(); }}
          onKeyUp={stopKeyBubble}
          placeholder="e.g., Reach out to 15 people"
          style={{ width: "100%" }}
        />
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          We’ll seed daily tasks up to the halfway date.
        </div>
        <Nav showSkip />
      </Card>
    );
  }

  function StepReview() {
    return (
      <Card
        title="Review & launch 🚀"
        subtitle="Here’s your plan for the first half. Ready to make it real?"
      >
        <div style={{ display: "grid", gap: 10 }}>
          <Row label="Goal" value={title || "—"} />
          <Row label="Category" value={CATS.find(c => c.key === category)?.label || "—"} dotColor={catColor} />
          <Row label="Start → Target" value={`${startDate || "—"}  →  ${targetDate || "—"}`} />
          <Row label="Halfway date" value={computedHalfDate || "—"} />
          <Row label="Halfway checkpoint" value={halfwayNote || "—"} />
          <Row label="Monthly" value={monthlyCommit || "—"} />
          <Row label="Weekly" value={weeklyCommit || "—"} />
          <Row label="Daily" value={dailyCommit || "—"} />
        </div>
        {err && <div style={{ color: "crimson", marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={goBack} disabled={busy}>Back</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-primary" onClick={create} disabled={busy} style={{ borderRadius: 8 }}>
            {busy ? "Creating…" : "Create Big Goal"}
          </button>
        </div>
      </Card>
    );
  }

  function Row({ label, value, dotColor }: { label: string; value: string; dotColor?: string }) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid #f1f5f9", padding: "8px 10px", borderRadius: 8 }}>
        <div style={{ width: 120, color: "#64748b", fontSize: 12, textTransform: "uppercase" }}>{label}</div>
        {dotColor && <span style={{ width: 10, height: 10, borderRadius: 999, background: dotColor, marginRight: 4 }} />}
        <div style={{ fontWeight: 600 }}>{value}</div>
      </div>
    );
  }

  /* --------------------------- Render --------------------------- */

  return (
    <div ref={rootRef} style={{ border: "1px solid #ddd", borderRadius: 16, padding: 16, background: "#fff" }}>
      {Header}

      <div style={{ marginTop: 12 }}>
        {step === "title"    && <StepTitle />}
        {step === "category" && <StepCategory />}
        {step === "dates"    && <StepDates />}
        {step === "halfway"  && <StepHalfway />}
        {step === "monthly"  && <StepMonthly />}
        {step === "weekly"   && <StepWeekly />}
        {step === "daily"    && <StepDaily />}
        {step === "review"   && <StepReview />}
      </div>

      {/* subtle keyframe for card entrance */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .btn-primary {
          background:#6d28d9; border:1px solid #5b21b6; color:#fff; padding:10px 14px; font-weight:700;
        }
        .btn-soft {
          background:#fff; border:1px solid #e5e7eb;
        }
        .muted { color:#6b7280; }
      `}</style>
    </div>
  );
}
