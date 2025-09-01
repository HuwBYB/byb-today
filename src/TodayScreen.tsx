// TodayScreen.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* =============================================
   BYB — Today Screen (Top-of-Day + Friendly Greets)
   ============================================= */

/* ===== Types ===== */
type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null;
  status: "pending" | "done" | string;
  priority: number | null; // 3 => Top of Day, 2 => Top, 0 => Normal
  source: string | null;
  goal_id: number | null;
  completed_at: string | null;
};
type GoalLite = { id: number; title: string };
type Props = { externalDateISO?: string };

/* ===== Date helpers ===== */
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function toISO(d: Date) {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function addDays(iso: string, n: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/* ===== Repeat config ===== */
type Repeat = "" | "daily" | "weekdays" | "weekly" | "monthly" | "annually";
const REPEAT_COUNTS: Record<Exclude<Repeat, "">, number> = {
  daily: 14,
  weekdays: 20,
  weekly: 12,
  monthly: 12,
  annually: 5
};
const REPEAT_PREFIX = "today_repeat_";

function generateOccurrences(startISO: string, repeat: Repeat): string[] {
  if (!repeat) return [startISO];

  if (repeat === "weekdays") {
    const count = REPEAT_COUNTS.weekdays;
    const out: string[] = [];
    const d = fromISO(startISO);
    while (out.length < count) {
      const dow = d.getDay(); // Sun=0 .. Sat=6
      if (dow >= 1 && dow <= 5) out.push(toISO(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  const count = REPEAT_COUNTS[repeat];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = fromISO(startISO);
    if (repeat === "daily") d.setDate(d.getDate() + i);
    else if (repeat === "weekly") d.setDate(d.getDate() + 7 * i);
    else if (repeat === "monthly") d.setMonth(d.getMonth() + i);
    else if (repeat === "annually") d.setFullYear(d.getFullYear() + i);
    out.push(toISO(d));
  }
  return out;
}
function getRepeatFromSource(source: string | null): Repeat {
  if (!source || !source.startsWith(REPEAT_PREFIX)) return "";
  const suffix = source.slice(REPEAT_PREFIX.length) as Repeat;
  if (["daily", "weekdays", "weekly", "monthly", "annually"].includes(suffix)) return suffix;
  return "";
}
function makeSeriesKey(repeat: Repeat) {
  return repeat ? `${REPEAT_PREFIX}${repeat}` : "manual";
}

/* ===== Greeting helpers ===== */
const LS_NAME = "byb:display_name";
const LS_POOL = "byb:display_pool"; // string[]
const LS_ROTATE = "byb:rotate_nicknames"; // "1" | "0" (default on)
const LS_LAST_VISIT = "byb:last_visit_ms";

function pickGreetingLabel(): string {
  try {
    const name = (localStorage.getItem(LS_NAME) || "").trim();
    const rotate = localStorage.getItem(LS_ROTATE) !== "0"; // default ON
    const pool = rotate ? (JSON.parse(localStorage.getItem(LS_POOL) || "[]") as string[]) : [];
    const list = [
      ...(name ? [name] : []),
      ...(Array.isArray(pool) ? pool.filter(Boolean) : [])
    ];
    if (list.length === 0) return "";
    return list[Math.floor(Math.random() * list.length)];
  } catch {
    return "";
  }
}

const POSITIVE_GREETS = [
  "Great to see you",
  "Let’s make today a great day",
  "Let’s smash some goals today",
  "Back at it — nice!"
];
const PROGRESS_GREETS = [
  "You’re smashing today",
  "You’re crushing this",
  "Momentum looks great",
  "Lovely progress"
];

function timeGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
function buildGreetingLine(missed: boolean, nameLabel: string, done: number, pending: number) {
  if (missed) return `We missed you${nameLabel ? `, ${nameLabel}` : ""}`;
  const total = done + pending;
  const didHalf = total > 0 && done >= Math.ceil(total / 2);
  const pool = didHalf ? PROGRESS_GREETS : POSITIVE_GREETS;
  const prefix = pool[Math.floor(Math.random() * pool.length)];
  return nameLabel ? `${prefix}, ${nameLabel}` : prefix;
}

/* ===== Summary / tiny helpers ===== */
type Summary = {
  doneToday: number;
  pendingToday: number;
  topDone: number;
  topTotal: number;
  isWin: boolean;
  streak: number;
  bestStreak: number;
};

function formatNiceDate(iso: string): string {
  try {
    const d = fromISO(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short"
    });
  } catch {
    return iso;
  }
}

/* ===== Lightweight Confetti (no deps) ===== */
function fireConfetti() {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.inset = "0";
  container.style.pointerEvents = "none";
  container.style.overflow = "hidden";
  container.style.zIndex = "4000";
  document.body.appendChild(container);
  const pieces = 80;
  const colors = ["#fde68a", "#a7f3d0", "#bfdbfe", "#fbcfe8", "#ddd6fe"];
  for (let i = 0; i < pieces; i++) {
    const el = document.createElement("div");
    const size = Math.random() * 8 + 4;
    el.style.position = "absolute";
    el.style.left = Math.random() * 100 + "%";
    el.style.top = "-10px";
    el.style.width = `${size}px`;
    el.style.height = `${size * 0.6}px`;
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.borderRadius = "2px";
    el.style.opacity = "0.9";
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    el.animate(
      [
        { transform: `translateY(0) rotate(0deg)`, opacity: 1 },
        { transform: `translateY(${window.innerHeight + 40}px) rotate(${360 + Math.random() * 360}deg)`, opacity: 0.6 }
      ],
      { duration: 1200 + Math.random() * 800, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
    container.appendChild(el);
  }
  setTimeout(() => container.remove(), 2200);
}

/* ===== Alfred micro-encouragements ===== */
const ALFRED_LINES = [
  "Lovely momentum. Keep it rolling.",
  "One pebble at a time becomes a mountain.",
  "Stacked: another tiny win in the bank.",
  "You’re doing Future You a favour.",
  "Mic drop. Onto the next."
];
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] as T; }

/* ===== Tiny toast hook ===== */
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  function show(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  }
  const node = (
    <div aria-live="polite" style={{ position: "fixed", left: 0, right: 0, bottom: "calc(16px + env(safe-area-inset-bottom,0))", display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 3500 }}>
      {msg && (
        <div className="card" style={{ background: "#111827", color: "white", borderRadius: 12, padding: "10px 14px", boxShadow: "0 8px 20px rgba(0,0,0,.25)", pointerEvents: "all" }}>
          {msg}
        </div>
      )}
    </div>
  );
  return { node, show };
}

/* =============================================
   Component
   ============================================= */
export default function TodayScreen({ externalDateISO }: Props) {
  /* ===== Global theme + NO-BLEED CSS ===== */
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-byb-global", "1");
    style.innerHTML = `
      :root{
        --bg: #fafafa;
        --bg-gradient: radial-gradient(1200px 600px at 20% -10%, #f7f6ff 10%, transparent 60%),
                       radial-gradient(900px 500px at 120% 10%, #f0fff7 10%, transparent 60%),
                       #fafafa;
        --card:#fff; --border:#e5e7eb; --text:#0f172a; --muted:#6b7280;
        --primary:#6c8cff; --primary-soft:#eef2ff; --success-soft:#dcfce7; --danger-soft:#fee2e2;
        --shadow:0 10px 30px rgba(0,0,0,.06);
      }
      *,*::before,*::after{ box-sizing:border-box; }
      html,body,#root{ margin:0; width:100%; max-width:100%; background:var(--bg-gradient); color:var(--text); }
      html, body { overflow-x: hidden; }
      :root { overflow-x: clip; }
      #root, body { max-width: 100vw; }
      img,svg,video,canvas{ max-width:100%; height:auto; display:block; }
      button img, button svg { max-width:100%; height:auto; display:block; }
      h1,h2,h3,h4,p,span,small,button{ overflow-wrap:anywhere; }
      .card{ width:100%; max-width:100%; background:var(--card); border:1px solid var(--border);
             border-radius:16px; padding:12px; box-shadow:var(--shadow); }
      .badge{ display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px;
              background:var(--primary-soft); color:#273a91; font-size:12px; }
      .muted{ color:var(--muted); }

      .btn-primary{ background:var(--primary); color:#fff; border:0; padding:8px 12px; border-radius:10px;
                    box-shadow:0 6px 14px rgba(108,140,255,.25); transform:translateZ(0); }
      .btn-primary:active{ transform:scale(.98); }
      .btn-soft{ background:#fff; border:1px solid var(--border); padding:8px 12px; border-radius:12px; }
      .btn-ghost{ background:transparent; border:0; color:var(--muted); }

      input,select,button{ max-width:100%; }
      input,select{ width:100%; border:1px solid var(--border); border-radius:10px; padding:10px 12px; background:#fff; }
      input[type="date"]{ width:100%; max-width:180px; }
      @media (max-width: 360px){ input[type="date"]{ max-width:140px; } }

      ul.list{ list-style:none; padding:0; margin:0; display:grid; gap:8px; }
      li.item{ background:#fff; border:1px solid var(--border); border-radius:12px; padding:10px; box-shadow:var(--shadow); }

      .h-scroll{ display:flex; gap:8px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; padding:4px; }
      .h-scroll::-webkit-scrollbar{ display:none; }

      /* Prioritisation rows: mobile-safe 3-column grid (index | title | arrows) */
      .prio-row{
        display:grid;
        grid-template-columns: 28px 1fr auto;
        align-items:center;
        gap:8px;
        width:100%;
      }
      .ellipsis{
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        min-width:0;
      }
      .no-shrink{
        display:flex;
        gap:6px;
        flex:0 0 auto;
      }

      @media (prefers-reduced-motion: reduce){
        *{ animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; }
      }
    `;
    document.head.appendChild(style);
    return () => { try { document.head.removeChild(style); } catch {} };
  }, []);

  /* ===== State ===== */
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(externalDateISO || todayISO());

  const [tasks, setTasks] = useState<Task[]>([]);
  const [goalMap, setGoalMap] = useState<Record<number, string>>({});

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add task (advanced)
  const [newTitle, setNewTitle] = useState("");
  const [newTop, setNewTop] = useState(false);
  const [newRepeat, setNewRepeat] = useState<Repeat>("");
  const [adding, setAdding] = useState(false);

  // Quick capture
  const [now, setNow] = useState<Date>(new Date());
  const [quickTitle, setQuickTitle] = useState("");
  const [quickTop, setQuickTop] = useState(false);
  const [savingQuick, setSavingQuick] = useState(false);

  // Greetings
  const [greetName, setGreetName] = useState<string>("");
  const [missed, setMissed] = useState<boolean>(false);
  const [greetLine, setGreetLine] = useState<string>("");

  // Responsive: <420px treated as compact
  const [isCompact, setIsCompact] = useState<boolean>(false);
  useEffect(() => {
    function check() { setIsCompact(window.innerWidth < 420); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Daily summary
  const [summary, setSummary] = useState<Summary>({
    doneToday: 0,
    pendingToday: 0,
    topDone: 0,
    topTotal: 0,
    isWin: false,
    streak: 0,
    bestStreak: 0
  });

  // streak micro animation
  const prevStreak = useRef(0);
  const [streakPulse, setStreakPulse] = useState(false);
  useEffect(() => {
    if (summary.streak > prevStreak.current) {
      setStreakPulse(true);
      const t = setTimeout(() => setStreakPulse(false), 900);
      return () => clearTimeout(t);
    }
    prevStreak.current = summary.streak;
  }, [summary.streak]);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTop, setEditTop] = useState(false);
  const [editDue, setEditDue] = useState<string | null>(null);
  const [editRepeat, setEditRepeat] = useState<Repeat>("");
  const [applyFuture, setApplyFuture] = useState(false);
  const [busyEdit, setBusyEdit] = useState(false);

  // Onboarding
  const [obStep, setObStep] = useState<0 | 1 | 2 | 3>(0);
  const [obName, setObName] = useState("");
  const [obNicks, setObNicks] = useState("");
  const [obGoal, setObGoal] = useState("");

  // Top of Day
  const [topOfDay, setTopOfDay] = useState<Task | null>(null);
  const [chooseTopOpen, setChooseTopOpen] = useState(false);
  const [chooseCandidates, setChooseCandidates] = useState<Task[]>([]);

  // Prioritisation modal state
  const [prioritiseOpen, setPrioritiseOpen] = useState(false);
  const [prioDraft, setPrioDraft] = useState<Task[]>([]);

  const toast = useToast();

  // external date change
  useEffect(() => { if (externalDateISO) setDateISO(externalDateISO); }, [externalDateISO]);

  // user + greeting + onboarding + last-visit
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      const user = data.user;
      setUserId(user?.id ?? null);

      setGreetName(pickGreetingLabel());

      try {
        const nowMs = Date.now();
        const lastMs = Number(localStorage.getItem(LS_LAST_VISIT) || "0");
        const missedNow = lastMs > 0 ? (nowMs - lastMs) > 86400000 : false;
        setMissed(missedNow);
        localStorage.setItem(LS_LAST_VISIT, String(nowMs));
      } catch {}

      const hasName = (localStorage.getItem(LS_NAME) || "").trim().length > 0;
      if (!hasName) setObStep(1);
    });
  }, []);

  // clock
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);

  // helper
  const isOverdueFn = (t: Task) => !!t.due_date && t.due_date < dateISO && t.status !== "done";

  /* ===== Data loading ===== */
  async function load() {
    if (!userId) return;
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,user_id,title,due_date,status,priority,source,goal_id,completed_at")
        .eq("user_id", userId)
        .lte("due_date", dateISO)
        .order("priority", { ascending: false })
        .order("id", { ascending: true });
      if (error) throw error;

      const raw = (data as Task[]) || [];
      // keep today's + overdue (pending)
      const list = raw.filter((t) => t.due_date === dateISO || (t.due_date! < dateISO && t.status !== "done"));
      setTasks(list);

      const ids = Array.from(new Set(list.map((t) => t.goal_id).filter((v): v is number => typeof v === "number")));
      if (ids.length) {
        const { data: gs, error: ge } = await supabase.from("goals").select("id,title").in("id", ids);
        if (ge) throw ge;
        const map: Record<number, string> = {};
        (gs as GoalLite[]).forEach((g) => (map[g.id] = g.title));
        setGoalMap(map);
      } else {
        setGoalMap({});
      }

      // summary
      const doneToday = list.filter((t) => t.due_date === dateISO && t.status === "done").length;
      const pendingToday = list.filter((t) => t.due_date === dateISO && t.status !== "done").length;
      const topToday = list.filter((t) => t.due_date === dateISO && (t.priority ?? 0) >= 2);
      const topDone = topToday.filter((t) => t.status === "done").length;
      const topTotal = topToday.length;
      const isWin = topDone >= 1 || doneToday >= 3;
      setSummary((s) => ({ ...s, doneToday, pendingToday, topDone, topTotal, isWin }));

      // top of day (for this date)
      setTopOfDay(topToday.find(t => (t.priority ?? 0) >= 3) || null);
    } catch (e: any) {
      setErr(e.message || String(e));
      setTasks([]);
      setGoalMap({});
      setTopOfDay(null);
    } finally { setLoading(false); }
  }

  async function loadStreaks() {
    if (!userId) return;
    try {
      const since = new Date();
      since.setDate(since.getDate() - 180);
      const { data, error } = await supabase
        .from("tasks")
        .select("completed_at,status,user_id")
        .eq("user_id", userId)
        .eq("status", "done")
        .not("completed_at", "is", null)
        .gte("completed_at", since.toISOString());
      if (error) throw error;

      const days = new Set<string>();
      for (const r of (data as Array<{ completed_at: string }>)) {
        const d = new Date(r.completed_at);
        days.add(toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate())));
      }

      let streak = 0; let cursor = todayISO();
      while (days.has(cursor)) { streak += 1; cursor = addDays(cursor, -1); }

      const sorted = Array.from(days).sort();
      let best = 0, run = 0; let prev: string | null = null;
      for (const d of sorted) {
        if (!prev) run = 1;
        else {
          const nextOfPrev = addDays(prev, 1);
          run = d === nextOfPrev ? run + 1 : 1;
        }
        best = Math.max(best, run);
        prev = d;
      }
      setSummary((s) => ({ ...s, streak, bestStreak: best }));
    } catch { /* ignore */ }
  }

  async function loadAll() { await load(); await loadStreaks(); }
  useEffect(() => { if (userId && dateISO) loadAll(); }, [userId, dateISO]);

  // Recompute greeting line when progress or name/missed changes
  useEffect(() => {
    setGreetLine(buildGreetingLine(missed, greetName, summary.doneToday, summary.pendingToday));
  }, [missed, greetName, summary.doneToday, summary.pendingToday]);

  function displayTitle(t: Task) {
    const base = (t.title || "").trim();
    const g = t.goal_id != null ? goalMap[t.goal_id] : "";
    return g ? `${base} (${g})` : base;
  }

  /* ===== Mutations ===== */
  async function toggleDone(t: Task) {
    try {
      const markDone = t.status !== "done";
      const { error } = await supabase
        .from("tasks")
        .update({ status: markDone ? "done" : "pending", completed_at: markDone ? new Date().toISOString() : null })
        .eq("id", t.id);
      if (error) throw error;

      await loadAll();

      if (markDone) {
        fireConfetti();
        toast.show(`Alfred: ${pick(ALFRED_LINES)}`);

        // If Top-of-Day completed, offer to pick another
        if ((t.priority ?? 0) >= 3 && t.due_date === dateISO) {
          const cands = tasks
            .filter(x => x.id !== t.id && x.due_date === dateISO && (x.priority ?? 0) >= 2 && x.status !== "done");
          if (cands.length > 0) {
            setChooseCandidates(cands);
            setChooseTopOpen(true);
          }
        }
      }
    } catch (e: any) { setErr(e.message || String(e)); }
  }

  async function moveToSelectedDate(taskId: number) {
    try {
      const { error } = await supabase.from("tasks").update({ due_date: dateISO }).eq("id", taskId);
      if (error) throw error; await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); }
  }

  async function moveAllOverdueHere() {
    try {
      const overdueIds = tasks.filter(isOverdueFn).map((t) => t.id);
      if (overdueIds.length === 0) return;
      const { error } = await supabase.from("tasks").update({ due_date: dateISO }).in("id", overdueIds);
      if (error) throw error; await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); }
  }

  async function addTaskWithArgs(title: string, top: boolean, repeat: Repeat) {
    if (!userId || !title.trim()) return;
    const clean = title.trim();
    const occurrences = generateOccurrences(dateISO, repeat);
    const rows = occurrences.map((iso) => ({
      user_id: userId, title: clean, due_date: iso, status: "pending",
      priority: top ? 2 : 0, source: repeat ? makeSeriesKey(repeat) : "manual"
    }));
    const { error } = await supabase.from("tasks").insert(rows as any);
    if (error) throw error;
  }

  async function addTask() {
    if (!userId || !newTitle.trim()) return;
    setAdding(true); setErr(null);
    try {
      await addTaskWithArgs(newTitle, newTop, newRepeat);
      setNewTitle(""); setNewTop(false); setNewRepeat("");
      await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); } finally { setAdding(false); }
  }

  async function addQuick() {
    if (!userId || !quickTitle.trim()) return;
    setSavingQuick(true);
    try {
      await addTaskWithArgs(quickTitle, quickTop, "");
      setQuickTitle(""); setQuickTop(false);
      await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); } finally { setSavingQuick(false); }
  }

  // Promote/demote Top of Day (single for this date)
  async function setTopPriorityOfDay(id: number | null) {
    if (!userId) return;
    setErr(null);
    try {
      // Demote any existing Top-of-Day for this date
      await supabase
        .from("tasks")
        .update({ priority: 2 })
        .eq("user_id", userId)
        .eq("due_date", dateISO)
        .eq("priority", 3);

      if (id != null) {
        await supabase.from("tasks").update({ priority: 3 }).eq("id", id);
      }

      await loadAll();
      setChooseTopOpen(false);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  function openChooseTop(forceAllTop = false) {
    const cands = tasks.filter(t =>
      t.due_date === dateISO &&
      (t.priority ?? 0) >= (forceAllTop ? 2 : 2) &&
      t.status !== "done"
    );
    setChooseCandidates(cands);
    setChooseTopOpen(true);
  }

  /* ===== Edit modal helpers ===== */
  function openEdit(t: Task) {
    setEditing(t);
    setEditTitle(t.title || "");
    setEditTop((t.priority ?? 0) >= 2);
    setEditDue(t.due_date);
    setEditRepeat(getRepeatFromSource(t.source));
    setApplyFuture(false);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editing || !userId) return;
    setBusyEdit(true); setErr(null);

    const originalRepeat = getRepeatFromSource(editing.source);
    const originalSeriesKey = editing.source?.startsWith(REPEAT_PREFIX) ? editing.source : null;
    const newSeriesKey = editRepeat ? makeSeriesKey(editRepeat) : "manual";
    const title = editTitle.trim();
    const top = editTop ? 2 : 0;
    const due = editDue || editing.due_date || dateISO;

    try {
      await supabase.from("tasks").update({ title, priority: top, due_date: due, source: newSeriesKey }).eq("id", editing.id);

      if (applyFuture && originalSeriesKey) {
        await supabase
          .from("tasks")
          .update({ title, priority: top })
          .eq("user_id", userId)
          .eq("source", originalSeriesKey)
          .gte("due_date", (editing.due_date || due) as string);
      }

      if (originalSeriesKey && editRepeat !== originalRepeat) {
        await supabase
          .from("tasks")
          .delete()
          .eq("user_id", userId)
          .eq("source", originalSeriesKey)
          .gte("due_date", (editing.due_date || due) as string)
          .neq("id", editing.id);
      }

      if (editRepeat && editRepeat !== originalRepeat) {
        const occurrences = generateOccurrences(due as string, editRepeat).slice(1);
        if (occurrences.length) {
          const rows = occurrences.map((iso) => ({
            user_id: userId, title, due_date: iso, status: "pending", priority: top, source: makeSeriesKey(editRepeat)
          }));
          await supabase.from("tasks").insert(rows as any);
        }
      }

      setEditOpen(false); setEditing(null);
      await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); } finally { setBusyEdit(false); }
  }

  async function deleteTask(scope: "one" | "future" | "all") {
    if (!editing || !userId) return;
    setBusyEdit(true); setErr(null);
    try {
      const originalSeriesKey = editing.source?.startsWith(REPEAT_PREFIX) ? editing.source : null;

      if (scope === "one") {
        await supabase.from("tasks").delete().eq("id", editing.id);
      } else if (scope === "future" && originalSeriesKey) {
        await supabase.from("tasks").delete().eq("user_id", userId).eq("source", originalSeriesKey).gte("due_date", editing.due_date || dateISO);
      } else if (scope === "all" && originalSeriesKey) {
        await supabase.from("tasks").delete().eq("user_id", userId).eq("source", originalSeriesKey);
      } else {
        await supabase.from("tasks").delete().eq("id", editing.id);
      }

      setEditOpen(false); setEditing(null);
      await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); } finally { setBusyEdit(false); }
  }

  /* ===== Prioritisation helpers ===== */

  // Open modal with today's pending tasks sorted by current priority
  function openPrioritise() {
    const todaysPending = tasks.filter(t => t.due_date === dateISO && t.status !== "done");
    const sorted = [...todaysPending].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pb !== pa) return pb - pa;        // 3,2,0 descending
      return a.id - b.id;                   // stable-ish
    });
    setPrioDraft(sorted);
    setPrioritiseOpen(true);
  }

  // Up/Down helper
  function movePrioTask(index: number, dir: -1 | 1) {
    setPrioDraft(prev => {
      const next = [...prev];
      const j = index + dir;
      if (index < 0 || index >= next.length) return next;
      if (j < 0 || j >= next.length) return next;
      const [item] = next.splice(index, 1);
      next.splice(j, 0, item);
      return next;
    });
  }

  // Save: first = priority 3, rest = 2, others (today & pending but not in draft) = 0
  async function savePrioritisation() {
    if (!userId) return;
    try {
      // Demote ALL pending today to 0 first
      await supabase
        .from("tasks")
        .update({ priority: 0 })
        .eq("user_id", userId)
        .eq("due_date", dateISO)
        .neq("status", "done");

      const ids = prioDraft.map(t => t.id);
      if (ids.length > 0) {
        const firstId = ids[0];
        const restIds = ids.slice(1);

        // First -> 3 (Top of Day)
        await supabase.from("tasks").update({ priority: 3 }).eq("id", firstId);

        // Rest -> 2 (Top Priorities)
        if (restIds.length > 0) {
          await supabase.from("tasks").update({ priority: 2 }).in("id", restIds);
        }
      }

      setPrioritiseOpen(false);
      await loadAll();
      toast.show(`Alfred: Priorities locked in. ${pick(ALFRED_LINES)}`);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  /* ===== Computed ===== */
  const niceDate = useMemo(() => formatNiceDate(dateISO), [dateISO]);
  const greeting = useMemo(() => (greetLine || timeGreeting(now)), [greetLine, now]);
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const top = tasks.filter((t) => (t.priority ?? 0) >= 2);
  const rest = tasks.filter((t) => (t.priority ?? 0) < 2);
  const overdueCount = tasks.filter(isOverdueFn).length;

  const pendingToday = useMemo(
    () => tasks.filter(t => t.due_date === dateISO && t.status !== "done"),
    [tasks, dateISO]
  );
  const showPrioritiseButton = !topOfDay && pendingToday.length > 0;

  /* ===== Section helper ===== */
  function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode; }) {
    return (
      <div className="card" style={{ marginBottom: 12, overflowX: "clip", borderRadius: 16 }}>
        <div className="row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap", width: "100%", minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: "break-word", minWidth: 0 }}>{title}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", minWidth: 0 }}>
            {right}
            <button onClick={loadAll} disabled={loading} className="btn-soft">{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
        {children}
      </div>
    );
  }

  /* ===== Render ===== */
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        overflowX: "hidden",
        width: "100%",
        maxWidth: "100vw",
        padding: "12px 12px calc(72px + env(safe-area-inset-bottom,0))",
      }}
    >
      {/* Top app bar */}
      <div
        className="card"
        style={{
          position: "sticky",
          top: "env(safe-area-inset-top, 0)",
          zIndex: 60,
          display: "grid",
          gap: 8,
          background: "#fff",
          borderRadius: 16,
          padding: 12
        }}
      >
        <div className="row" style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap", width: "100%", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>BYB</div>
            <div className="muted" style={{ minWidth: 0 }}>• {niceDate}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
            <span className="badge" title="Win if 1+ top priority or 3+ tasks" style={{ background: summary.isWin ? "var(--success-soft)" : "var(--danger-soft)", border: "1px solid var(--border)" }}>{summary.isWin ? "Win" : "Keep going"}</span>
            <span className="badge" title="Tasks done today">Done: {summary.doneToday}</span>
            {summary.topTotal > 0 && <span className="badge" title="Top priorities done / total">Top: {summary.topDone}/{summary.topTotal}</span>}
            <span className="badge" title="Current streak (best)" style={{ transform: streakPulse ? "scale(1.08)" : "scale(1)", transition: "transform .25s ease" }}>🔥 {summary.streak}{summary.bestStreak > 0 ? ` (best ${summary.bestStreak})` : ""}</span>
          </div>
        </div>

        {/* Greeting line */}
        {(greetName || greetLine) && (
          <div style={{ fontWeight: 700, wordBreak: "break-word" }}>
            {greeting} {missed ? "💜" : ""}
          </div>
        )}

        {/* Quick row */}
        <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>{timeStr}</div>
            <div className="muted" style={{ whiteSpace: "nowrap" }}>{dateISO}</div>
          </div>

          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && quickTitle.trim() && !savingQuick) addQuick(); }}
            placeholder="Quick add a task for today…"
            style={{ flex: "1 1 220px", minWidth: 0, maxWidth: "100%" }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={quickTop} onChange={(e) => setQuickTop(e.target.checked)} /> Top
          </label>
          <button className="btn-primary" onClick={addQuick} disabled={!quickTitle.trim() || savingQuick} style={{ borderRadius: 10, flex: isCompact ? "1 1 100%" : undefined }}>{savingQuick ? "Adding…" : "Add"}</button>
        </div>

        {/* Date controls */}
        <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%", minWidth: 0 }}>
          {overdueCount > 0 && (
            <button
              onClick={moveAllOverdueHere}
              className="btn-soft"
              title="Change due date for all overdue pending tasks to this day"
              style={{ flex: isCompact ? "1 1 100%" : undefined, minWidth: 0 }}
            >
              Move all overdue here ({overdueCount})
            </button>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", flexWrap: "wrap", width: isCompact ? "100%" : "auto", minWidth: 0 }}>
            <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} style={{ flex: isCompact ? "1 1 220px" : undefined, minWidth: 0, maxWidth: "100%" }} />
            <button className="btn-soft" onClick={() => setDateISO(todayISO())} style={{ flex: isCompact ? "1 1 120px" : undefined }}>Today</button>
          </div>
        </div>
        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* Today’s Top Priority */}
      <div className="card" style={{ borderLeft: "6px solid #a7f3d0", borderRadius: 16 }}>
        <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, minWidth: 0 }}>Today’s Top Priority</h2>
          {topOfDay ? <span className="badge" title="Pinned for today">Pinned</span> : <span className="badge" title="Pick one from your Top tasks">Not set</span>}
          <div style={{ marginLeft: "auto", minWidth: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {showPrioritiseButton && (
              <button className="btn-primary" onClick={openPrioritise} style={{ borderRadius: 10 }}>
                Prioritise Today’s Tasks
              </button>
            )}
            {!topOfDay && !showPrioritiseButton && (
              <button className="btn-soft" onClick={() => openChooseTop(true)}>Choose</button>
            )}
            {topOfDay && (
              <>
                <span className="muted ellipsis" style={{ maxWidth: "52vw" }}>
                  {displayTitle(topOfDay)}
                </span>
                <button className="btn-soft" onClick={() => setTopPriorityOfDay(null)}>Clear</button>
              </>
            )}
          </div>
        </div>
        {!topOfDay && <div className="muted" style={{ marginTop: 6 }}>Promote any Top task below to make it your Top of Day.</div>}
      </div>

      {/* Top Priorities */}
      <Section
        title="Top Priorities"
        right={
          top.length > 0
            ? <button className="btn-soft" onClick={openPrioritise} title="Reorder today’s tasks">Reorder</button>
            : null
        }
      >
        {top.length === 0 ? (
          <div className="muted">Nothing marked top priority for this day.</div>
        ) : (
          <ul className="list">
            {top.map((t) => {
              const overdue = isOverdueFn(t);
              const isTopOfDay = (t.priority ?? 0) >= 3 && t.due_date === dateISO;
              return (
                <li key={t.id} className="item">
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                    <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", wordBreak: "break-word", minWidth: 0 }}>
                        <span className="ellipsis">{displayTitle(t)}</span>
                        {isTopOfDay && <span className="badge" title="Today’s Top Priority">Top of Day</span>}
                        {overdue && <span className="badge">Overdue</span>}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {!isTopOfDay && t.status !== "done" && t.due_date === dateISO && (
                            <button className="btn-ghost" onClick={() => setTopPriorityOfDay(t.id)} title="Make this Today’s Top Priority">
                              Make Top of Day
                            </button>
                          )}
                          <button className="btn-ghost" onClick={() => openEdit(t)} title="Edit task">Edit</button>
                        </div>
                      </div>
                      {overdue && (
                        <div className="muted" style={{ marginTop: 4, minWidth: 0 }}>
                          Due {t.due_date} · <button className="btn-ghost" onClick={() => moveToSelectedDate(t.id)}>Move to {dateISO}</button>
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Everything Else */}
      <Section title="Everything Else" right={overdueCount > 0 ? <span className="muted">{overdueCount} overdue</span> : null}>
        {rest.length === 0 ? (
          <div className="muted">Nothing else scheduled.</div>
        ) : (
          <ul className="list">
            {rest.map((t) => {
              const overdue = isOverdueFn(t);
              return (
                <li key={t.id} className="item">
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                    <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", wordBreak: "break-word", minWidth: 0 }}>
                        <span className="ellipsis">{displayTitle(t)}</span>
                        {overdue && <span className="badge">Overdue</span>}
                        <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => openEdit(t)} title="Edit task">Edit</button>
                      </div>
                      {overdue && (
                        <div className="muted" style={{ marginTop: 4, minWidth: 0 }}>
                          Due {t.due_date} · <button className="btn-ghost" onClick={() => moveToSelectedDate(t.id)}>Move to {dateISO}</button>
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Add Task */}
      <div className="card" style={{ display: "grid", gap: 8, overflowX: "clip", borderRadius: 16 }}>
        <h2 style={{ margin: 0 }}>Add Task</h2>
        <label style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Task title</div>
          <input
            type="text"
            placeholder="Enter task…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim() && !adding) addTask(); }}
          />
        </label>

        <div className="row" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={newTop} onChange={(e) => setNewTop(e.target.checked)} /> Mark as Top Priority
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <span className="muted">Repeat</span>
            <select value={newRepeat} onChange={(e) => setNewRepeat(e.target.value as Repeat)} title="Repeat (optional)">
              <option value="">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Daily (Mon–Fri)</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>
          </label>

          <div className="muted" style={{ minWidth: 0, wordBreak: "break-word" }}>
            Will be created for {dateISO}{newRepeat ? " + future repeats" : ""}
          </div>

          <button onClick={addTask} disabled={!newTitle.trim() || adding} className="btn-primary" style={{ marginLeft: "auto", borderRadius: 10 }}>{adding ? "Adding…" : "Add"}</button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* Prioritisation Modal (Up/Down reordering; first becomes Top of Day) */}
      {prioritiseOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Prioritise Today’s Tasks"
          onClick={() => setPrioritiseOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, zIndex: 3000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", height: "100%", maxWidth: "100vw", maxHeight: "100vh", display: "grid", gridTemplateRows: "auto 1fr auto", background: "#fff" }}
          >
            <div className="card" style={{ borderRadius: 0 }}>
              <h3 style={{ margin: 0 }}>Prioritise Today’s Tasks</h3>
              <div className="muted">Reorder with ↑/↓. <b>First</b> becomes <b>Top of Day</b>, the rest become <b>Top Priorities</b>.</div>
            </div>

            <div style={{ overflow: "auto", padding: 12 }}>
              {prioDraft.length === 0 ? (
                <div className="card muted">No pending tasks for today.</div>
              ) : (
                <ul className="list">
                  {prioDraft.map((t, i) => (
                    <li key={t.id} className="item">
                      <div className="prio-row">
                        <div className="badge" aria-hidden style={{ justifyContent: "center" }}>{i + 1}</div>
                        <div className="ellipsis">{displayTitle(t)}</div>
                        <div className="no-shrink">
                          <button className="btn-soft" onClick={() => movePrioTask(i, -1)} disabled={i === 0} title="Move up">↑</button>
                          <button className="btn-soft" onClick={() => movePrioTask(i, +1)} disabled={i === prioDraft.length - 1} title="Move down">↓</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card" style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderRadius: 0 }}>
              <button className="btn-soft" onClick={() => setPrioritiseOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={savePrioritisation} disabled={prioDraft.length === 0} style={{ borderRadius: 10 }}>
                Confirm Priorities
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Choose/Replace Top of Day Prompt */}
      {chooseTopOpen && (
        <div role="dialog" aria-modal="true" aria-label="Choose Top of Day" onClick={() => setChooseTopOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 2100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(680px, 96vw)", borderRadius: 16, padding: 16, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Pick a new Top Priority?</h3>
            <div className="muted" style={{ marginBottom: 8 }}>
              Well done — you completed today’s top priority! 💪<br />
              Would you like to make another task your top priority for the rest of the day? No pressure.
            </div>
            {chooseCandidates.length === 0 ? (
              <div className="muted">No other Top tasks available.</div>
            ) : (
              <ul className="list" style={{ marginTop: 8 }}>
                {chooseCandidates.map((t) => (
                  <li key={t.id} className="item" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="ellipsis" style={{ flex: 1 }}>{displayTitle(t)}</div>
                    <button className="btn-primary" onClick={() => setTopPriorityOfDay(t.id)} style={{ borderRadius: 10 }}>
                      Make Top of Day
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button className="btn-soft" onClick={() => setChooseTopOpen(false)}>Not now</button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Modal */}
      {obStep !== 0 && (
        <div role="dialog" aria-modal="true" aria-label="Onboarding" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 3000 }}>
          <div className="card" style={{ width: "min(520px, 96vw)", borderRadius: 16, padding: 16, background: "#fff" }}>
            {obStep === 1 && (
              <div style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Welcome to BYB 🌈</h3>
                <div className="muted">What should we call you?</div>
                <input value={obName} onChange={(e) => setObName(e.target.value)} placeholder="Your name" />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn-ghost" onClick={obSkip}>Skip</button>
                  <button className="btn-primary" onClick={obSaveAndNext} disabled={!obName.trim()}>Next</button>
                </div>
              </div>
            )}
            {obStep === 2 && (
              <div style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Nicknames (optional)</h3>
                <div className="muted">Comma-separated. We’ll rotate them in greetings.</div>
                <input value={obNicks} onChange={(e) => setObNicks(e.target.value)} placeholder="e.g. Champ, Boss, Legend" />
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" defaultChecked onChange={(e) => localStorage.setItem(LS_ROTATE, e.target.checked ? "1" : "0")} /> Rotate nicknames
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-ghost" onClick={obSkip}>Skip</button>
                    <button className="btn-primary" onClick={obSaveAndNext}>Next</button>
                  </div>
                </div>
              </div>
            )}
            {obStep === 3 && (
              <div style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Set your Big Goal</h3>
                <div className="muted">A north star to guide your daily focus.</div>
                <input value={obGoal} onChange={(e) => setObGoal(e.target.value)} placeholder="e.g. Launch BYB MVP" />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn-ghost" onClick={() => setObStep(0)}>Skip</button>
                  <button className="btn-primary" onClick={obSaveAndNext} disabled={!obGoal.trim()}>Finish</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast node */}
      {toast.node}
    </div>
  );
}
