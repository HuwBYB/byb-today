// src/TodayScreen.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";
import { colorOf, normalizeCat } from "./theme/categories";
import "./theme.css";

/* ===== Toast theme ===== */
const TOAST_LOGO_SRC = "/LogoButterfly.png";
const TOAST_BG = "#D7F0FA";
const TOAST_BORDER = "#bfe5f3";

/* ===== Types ===== */
type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null;
  status: "pending" | "done" | "skipped" | string;
  priority: number | null;
  source: string | null;
  goal_id: number | null;
  completed_at: string | null;
  category?: string | null;
  category_color?: string | null;
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
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
const dateOnly = (s?: string | null) => (s ? s.slice(0, 10) : null);

/* ===== Repeat helpers ===== */
type Repeat = "" | "daily" | "weekdays" | "weekly" | "monthly" | "annually";
const REPEAT_COUNTS: Record<Exclude<Repeat, "">, number> = {
  daily: 14,
  weekdays: 20,
  weekly: 12,
  monthly: 12,
  annually: 5,
};
const REPEAT_PREFIX = "today_repeat_";

function generateOccurrences(startISO: string, repeat: Repeat): string[] {
  if (!repeat) return [startISO];
  if (repeat === "weekdays") {
    const out: string[] = [];
    const d = fromISO(startISO);
    while (out.length < REPEAT_COUNTS.weekdays) {
      const dow = d.getDay(); // 0=Sun..6=Sat
      if (dow >= 1 && dow <= 5) out.push(toISO(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  const out: string[] = [];
  for (let i = 0; i < REPEAT_COUNTS[repeat]; i++) {
    const d = fromISO(startISO);
    if (repeat === "daily") d.setDate(d.getDate() + i);
    else if (repeat === "weekly") d.setDate(d.getDate() + 7 * i);
    else if (repeat === "monthly") d.setMonth(d.getMonth() + i);
    else if (repeat === "annually") d.setFullYear(d.getFullYear() + i);
    out.push(toISO(d));
  }
  return out;
}
function makeSeriesKey(repeat: Repeat) {
  return repeat ? `${REPEAT_PREFIX}${repeat}` : "manual";
}

/* ===== Greeting helpers ===== */
const LS_NAME = "byb:display_name";
const LS_POOL = "byb:display_pool";
const LS_ROTATE = "byb:rotate_nicknames";
const LS_LAST_VISIT = "byb:last_visit_ms";

function pickGreetingLabel(): string {
  try {
    const name = (localStorage.getItem(LS_NAME) || "").trim();
    const rotate = localStorage.getItem(LS_ROTATE) !== "0";
    const pool = rotate ? (JSON.parse(localStorage.getItem(LS_POOL) || "[]") as string[]) : [];
    const list = [...(name ? [name] : []), ...(Array.isArray(pool) ? pool.filter(Boolean) : [])];
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
  "Back at it — nice!",
];
const PROGRESS_GREETS = [
  "You’re smashing today",
  "You’re crushing this",
  "Momentum looks great",
  "Lovely progress",
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
  return nameLabel ? `${prefix}, ${nameLabel}` : `${prefix}`;
}

/* ===== Summary ===== */
type Summary = { doneToday: number; pendingToday: number; isWin: boolean; streak: number; bestStreak: number };

function formatNiceDate(iso: string): string {
  try {
    const d = fromISO(iso);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

/* ===== Celebration (Fireworks + Big Message) ===== */
function useCelebration() {
  const [msg, setMsg] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Fit canvas to viewport
  useEffect(() => {
    function fit() {
      const c = canvasRef.current;
      if (!c) return;
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Animation loop
  useEffect(() => {
    if (!active) return;

    const c = canvasRef.current;
    if (!c) return;

    const maybe = c.getContext("2d");
    if (!(maybe instanceof CanvasRenderingContext2D)) return;
    const context: CanvasRenderingContext2D = maybe; // non-nullable

    type Particle = { x: number; y: number; vx: number; vy: number; life: number; ttl: number };
    const particles: Particle[] = [];
    let lastSpawn = 0;

    function spawnBurst(cx: number, cy: number) {
      const count = 90;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 2 + Math.random() * 3.8;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          ttl: 52 + Math.floor(Math.random() * 30),
        });
      }
    }

    function spawnRocket() {
      const cx = Math.random() * c.width * 0.8 + c.width * 0.1;
      const cy = Math.random() * c.height * 0.4 + c.height * 0.15;
      spawnBurst(cx, cy);
    }

    function step(ts: number) {
      // translucent clear for trails
      context.fillStyle = "rgba(0,0,0,0.08)";
      context.fillRect(0, 0, c.width, c.height);

      if (ts - lastSpawn > 170) {
        spawnRocket();
        lastSpawn = ts;
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03; // gravity
        p.life += 1;

        const fade = Math.max(0, 1 - p.life / p.ttl);
        context.globalAlpha = fade;
        context.beginPath();
        context.arc(p.x, p.y, 2 + fade * 2, 0, Math.PI * 2);
        const hue = ((p.x + p.y + ts / 10) % 360) | 0;
        context.fillStyle = `hsl(${hue}, 80%, 60%)`;
        context.fill();

        if (p.life >= p.ttl) particles.splice(i, 1);
      }

      context.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);

    const timer = setTimeout(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setActive(false);
      setMsg(null);
    }, 2000);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      clearTimeout(timer);
    };
  }, [active]);

  function boom(text: string) {
    setMsg(text);
    setActive(true);
  }

  const node = !active ? null : (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        pointerEvents: "none",
        display: "grid",
        placeItems: "center",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {msg && (
        <div
          style={{
            position: "relative",
            padding: "16px 22px",
            borderRadius: 18,
            background: "rgba(255,255,255,0.95)",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 24px 70px rgba(0,0,0,.22)",
            fontWeight: 900,
            fontSize: 24,
            textAlign: "center",
            color: "#0f172a",
            maxWidth: "90vw",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );

  return { node, boom };
}

/* ===== Toast (small messages) ===== */
const ENCOURAGE_LINES = [
  "Lovely momentum. Keep it rolling.",
  "One pebble at a time becomes a mountain.",
  "Stacked: another tiny win in the bank.",
  "You’re doing Future You a favour.",
  "Mic drop. Onto the next.",
];
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  function show(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  }
  const node = (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: "calc(16px + env(safe-area-inset-bottom,0))",
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 3500,
      }}
    >
      {msg && (
        <div
          className="card"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: TOAST_BG,
            color: "var(--text)",
            borderRadius: 14,
            padding: "10px 14px",
            boxShadow: "0 8px 20px rgba(0,0,0,.10)",
            border: `1px solid ${TOAST_BORDER}`,
            pointerEvents: "all",
          }}
        >
          <img
            src={TOAST_LOGO_SRC}
            alt=""
            width={22}
            height={22}
            style={{
              display: "block",
              objectFit: "contain",
              borderRadius: 6,
              border: `1px solid ${TOAST_BORDER}`,
              background: "#ffffff88",
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <span style={{ fontWeight: 700 }}>{msg}</span>
        </div>
      )}
    </div>
  );
  return { node, show };
}

/* ===== Defaults (nicknames, boost) ===== */
const DEFAULT_NICKNAMES = [
  "King","Champ","Legend","Boss","Chief","Star","Ace","Hero","Captain","Tiger",
  "Queen","Princess","Gurl","Boss Lady","Diva","Hot Stuff","Girlfriend",
];
const BOOST_LINES = [
  "You have the power to make a difference.",
  "The world is a better place with you in it.",
  "Be the role model you would have wanted.",
  "You are the only you in this world — embrace your uniqueness.",
  "Try to inspire others by being the best you that you can be.",
  "Be a positive light in this world.",
  "Your effort matters, even when it’s quiet.",
  "You’re allowed to start small and think big.",
  "Show up today — your future will notice.",
  "Every step counts more than you feel.",
  "Your calm is a superpower.",
  "Effort today becomes ease tomorrow.",
  "You turn doubts into data.",
  "You’re building trust with yourself — keep it up.",
  "Start where you are; use what you have; do what you can.",
  "Your patience is planting something beautiful.",
  "You’ve got more in the tank than you think.",
  "You make hard work look hopeful.",
  "Small wins stack — you’re stacking them.",
  "You rise without needing permission.",
  "You’re proof that persistence works.",
  "You’re learning faster than you realise.",
  "You do brave things quietly.",
  "Progress is your pace — keep it.",
  "You turn ‘what if’ into ‘why not’.",
  "There’s room for your dreams here.",
  "Your kindness to yourself fuels everything else.",
  "You don’t quit — you recalibrate.",
  "Your standard is growth, not perfection.",
  "You make consistency look good.",
  "Your effort today is a gift to tomorrow.",
  "You’ve already overcome so much — carry that evidence.",
  "You can reset at any moment — including now.",
  "You’re becoming who you once needed.",
  "You keep promises to yourself — that’s power.",
  "Curiosity over judgment — always.",
  "You’re allowed to take breaks and still be unstoppable.",
  "The work you’re doing matters, even when it’s unseen.",
  "You meet challenges with solutions.",
  "You are brave enough to begin again.",
  "Your energy changes the room — in the best way.",
  "You build momentum with one honest action.",
  "You belong in every room you walk into.",
  "You’re mastering the art of showing up.",
  "You create calm by choosing what matters.",
  "Your perspective is needed.",
  "Your goals are worthy of your time.",
  "You’re writing a future you’ll love living in.",
  "You turn pressure into purpose.",
  "You’re capable, creative, and consistent.",
  "You’ve got this — and if not yet, you will.",
  "Keep going — your best chapters are ahead.",
  "You prove to yourself what’s possible.",
  "You are stronger than your strongest excuse.",
  "Your discipline is a form of self-respect.",
  "You’re exactly where you need to be to take the next step.",
  "Tiny steps today become giant wins tomorrow.",
  "You’ve handled hard things before — you can handle this too.",
  "Your kindness has a ripple effect you’ll never fully see.",
  "Progress over perfection — always.",
  "You are building a life Future You will thank you for.",
  "Your presence changes rooms. In a good way.",
  "You’re allowed to take up space and dream big.",
  "Momentum loves action — you just started it.",
  "You don’t need to be amazing to begin; beginning is amazing.",
  "You’re closer than you think.",
  "Energy follows focus — and your focus is strong.",
  "You bring clarity where others find noise.",
  "The way you show up inspires people you don’t even know.",
  "You make difficult things look doable.",
  "Courage is showing up — which you just did.",
  "You are worthy of the goals you’re chasing.",
  "Your future self is cheering for you right now.",
  "Your consistency is quietly powerful.",
  "You’ve got resilience in your bones.",
  "You turn challenges into checkpoints.",
  "Your ideas matter — keep going.",
  "You can create something today that didn’t exist yesterday.",
  "You lead by example without saying a word.",
  "Your best is enough. And it compounds.",
  "You’re writing a story you’ll be proud to tell.",
  "You turn ‘someday’ into ‘done’.",
  "Your best is enough.",
  "Greatness comes from persistence.",
  "You have got this.",
  "Make your inner voice kind - you listen to it.",
  "Your dreams can become goals when you put a plan in place.",
  "Sometimes growth in uncomfortable - find comfort there.",
  "Your best is more than enough.",
  "Let's inspire people with our work ethic.",
  "You have the power to do your best.",
  "Glass ceilings are there to be broken.",
  "You bring warmth and strength in equal measure.",
  "Someone believes in you because you’ve earned it.",
  "You don’t chase perfect; you build progress.",
];

/* =============================================
   Component
   ============================================= */
export default function TodayScreen({ externalDateISO }: Props) {
  /* ===== Global theme injection ===== */
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
      .btn-ghost{ background:transparent; border:0; color:#fff; }
      input,select,button{ max-width:100%; }
      input,select{ width:100%; border:1px solid var(--border); border-radius:10px; padding:10px 12px; background:#fff; }
      input[type="date"]{ width:100%; max-width:180px; }
      @media (max-width: 360px){ input[type="date"]{ max-width:140px; } }
      ul.list{ list-style:none; padding:0; margin:0; display:grid; gap:8px; }
      li.item{ background:#fff; border:1px solid var(--border); border-radius:12px; padding:10px; box-shadow:var(--shadow); }
      .h-scroll{ display:flex; gap:8px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; padding:4px; }
      .h-scroll::-webkit-scrollbar{ display:none; }
      .overlay{ position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 80; display: grid; place-items: center; padding: 16px; }
      .sheet{ width: 100%; max-width: 640px; background: #fff; border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); padding: 16px; }
      .chip{ display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:#f1f5f9; border:1px solid var(--border); font-size:12px; }
      .chip button{ border:0; background:transparent; cursor:pointer; color:#64748b; }
      .chip button:focus{ outline: 2px solid #c7d2fe; outline-offset: 2px; border-radius: 8px; }
      @media (prefers-reduced-motion: reduce){
        *{ animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      try { document.head.removeChild(style); } catch {}
    };
  }, []);

  /* ===== State ===== */
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(externalDateISO || todayISO());

  const [tasks, setTasks] = useState<Task[]>([]);
  const [goalMap, setGoalMap] = useState<Record<number, string>>({});

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add task
  const [newTitle, setNewTitle] = useState("");
  const [newRepeat, setNewRepeat] = useState<Repeat>("");
  const [adding, setAdding] = useState(false);

  // Greetings / clock
  const [now, setNow] = useState<Date>(new Date());
  const [greetName, setGreetName] = useState<string>("");
  const [missed, setMissed] = useState<boolean>(false);
  const [greetLine, setGreetLine] = useState<string>("");

  // Profile editor state
  const [profileOpen, setProfileOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [poolInput, setPoolInput] = useState<string[]>([]);
  const [customNicks, setCustomNicks] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Boost modal
  const [boostOpen, setBoostOpen] = useState(false);
  const [boostLine, setBoostLine] = useState<string>("");

  // Gentle Reset
  const [gentleOpen, setGentleOpen] = useState(false);

  // Confirm skip ALL overdue
  const [confirmSkipAllOpen, setConfirmSkipAllOpen] = useState(false);

  // Confirm skip ONE task
  const [taskToSkip, setTaskToSkip] = useState<Task | null>(null);

  // Celebration overlay
  const celebration = useCelebration();

  // Responsive
  const [isCompact, setIsCompact] = useState<boolean>(false);
  useEffect(() => {
    function check() { setIsCompact(window.innerWidth < 420); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Summary
  const [summary, setSummary] = useState<Summary>({ doneToday: 0, pendingToday: 0, isWin: false, streak: 0, bestStreak: 0 });

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

  const toast = useToast();

  // external date change
  useEffect(() => { if (externalDateISO) setDateISO(externalDateISO); }, [externalDateISO]);

  // user + greeting + last-visit
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
    });
  }, []);

  // clock
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);

  // Overdue helper — exclude "skipped"
  const isOverdueFn = (t: Task) =>
    !!t.due_date &&
    t.status !== "done" &&
    t.status !== "skipped" &&
    fromISO(t.due_date.slice(0, 10)).getTime() < fromISO(dateISO).getTime();

  /* ===== Data loading ===== */
  async function load() {
    if (!userId) return;
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,user_id,title,due_date,status,priority,source,goal_id,completed_at,category,category_color")
        .eq("user_id", userId);
      if (error) throw error;

      const raw = (data as Task[]) || [];
      const normalized: Task[] = raw.map((t) => ({
        ...t,
        due_date: t.due_date ? t.due_date.slice(0, 10) : null,
        completed_at: t.completed_at,
      }));

      // Exclude done + skipped from the working set; include today's and overdue
      const list = normalized.filter(
        (t) =>
          t.due_date !== null &&
          (t.due_date === dateISO || t.due_date < dateISO) &&
          t.status !== "done" &&
          t.status !== "skipped"
      );

      list.sort((a, b) => {
        const aOver = a.due_date! < dateISO ? 0 : 1;
        const bOver = b.due_date! < dateISO ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        if (aOver === 0) {
          if (a.due_date! !== b.due_date!) return a.due_date! < b.due_date! ? -1 : 1;
        }
        return a.id - b.id;
      });

      setTasks(list);

      // goals
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

      const doneToday = normalized.filter((t) => t.status === "done" && dateOnly(t.completed_at) === dateISO).length;
      const pendingToday = normalized.filter((t) => t.due_date === dateISO && t.status !== "done" && t.status !== "skipped").length;
      const isWin = doneToday >= 3;
      setSummary((s) => ({ ...s, doneToday, pendingToday, isWin }));
    } catch (e: any) {
      setErr(e.message || String(e));
      setTasks([]);
      setGoalMap({});
    } finally {
      setLoading(false);
    }
  }

  async function loadStreaks() {
    if (!userId) return;
    try {
      const since = new Date(); since.setDate(since.getDate() - 180);
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

  // Recompute greeting line
  useEffect(() => {
    setGreetLine(buildGreetingLine(missed, greetName, summary.doneToday, summary.pendingToday));
  }, [missed, greetName, summary.doneToday, summary.pendingToday]);

  function displayTitle(t: Task | null) {
    if (!t) return "";
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
        celebration.boom(pick(ENCOURAGE_LINES)); // big centered message + fireworks
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
      const overdueIds = tasks.filter(isOverdueFn).map(t => t.id);
      if (overdueIds.length === 0) return;
      const { error } = await supabase.from("tasks").update({ due_date: dateISO }).in("id", overdueIds);
      if (error) throw error; await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); }
  }

  async function addTaskWithArgs(title: string, repeat: Repeat) {
    if (!userId || !title.trim()) return;
    const clean = title.trim();
    const occurrences = generateOccurrences(dateISO, repeat);
    const rows = occurrences.map((iso) => ({
      user_id: userId, title: clean, due_date: iso, status: "pending",
      priority: 0, source: repeat ? makeSeriesKey(repeat) : "manual"
    }));
    const { error } = await supabase.from("tasks").insert(rows as any);
    if (error) throw error;
  }

  async function addTask() {
    if (!userId || !newTitle.trim()) return;
    setAdding(true); setErr(null);
    try {
      await addTaskWithArgs(newTitle, newRepeat);
      setNewTitle(""); setNewRepeat("");
      await loadAll();
    } catch (e: any) { setErr(e.message || String(e)); } finally { setAdding(false); }
  }

  // Skip all overdue
  async function skipAllOverdue() {
    if (!userId) return;
    const backlogIds = tasks.filter(t => isOverdueFn(t)).map(t => t.id);
    if (backlogIds.length === 0) { setGentleOpen(false); setConfirmSkipAllOpen(false); return; }
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "skipped", due_date: null, completed_at: null })
        .in("id", backlogIds);
      if (error) throw error;

      await loadAll();
      setGentleOpen(false);
      setConfirmSkipAllOpen(false);
      toast.show("Overdue skipped — fresh page set.");
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  // Gentle Reset uses skipAllOverdue
  async function gentleResetBacklog() {
    await skipAllOverdue();
  }

  async function completeAllOverdue() {
    if (!userId) return;
    const backlogIds = tasks.filter(t => isOverdueFn(t)).map(t => t.id);
    if (backlogIds.length === 0) { setGentleOpen(false); return; }
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .in("id", backlogIds);
      if (error) throw error;
      await loadAll();
      setGentleOpen(false);
      celebration.boom(pick(ENCOURAGE_LINES));
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  // Skip ONE task
  function askSkipTask(t: Task) { setTaskToSkip(t); }
  async function confirmSkipTask() {
    if (!taskToSkip) return;
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "skipped", due_date: null, completed_at: null })
        .eq("id", taskToSkip.id);
      if (error) throw error;
      setTaskToSkip(null);
      await loadAll();
      toast.show("Task skipped.");
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  /* ===== Boost helpers ===== */
  function openBoost() { setBoostLine(pick(BOOST_LINES)); setBoostOpen(true); }
  function nextBoost() { setBoostLine(pick(BOOST_LINES)); }

  /* ===== Computed ===== */
  const niceDate = useMemo(() => formatNiceDate(dateISO), [dateISO]);
  const greeting = useMemo(() => (greetLine || timeGreeting(now)), [greetLine, now]);
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const overdue = tasks.filter(isOverdueFn);
  const todayPending = tasks.filter((t) => t.due_date === dateISO && t.status !== "done" && t.status !== "skipped");

  /* ===== Section ===== */
  function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
    return (
      <div className="card" style={{ marginBottom: 12, overflowX: "clip", borderRadius: 16 }}>
        <div
          className="row"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
            gap: 8,
            flexWrap: "wrap",
            width: "100%",
            minWidth: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: "break-word", minWidth: 0 }}>{title}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", minWidth: 0 }}>
            {right}
            <button onClick={loadAll} disabled={loading} className="btn-soft">
              {loading ? "Refreshing…" : "Refresh"}
            </button>
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
        padding: "12px 12px calc(56px + env(safe-area-inset-bottom,0))",
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
          padding: 12,
        }}
      >
        <div
          className="row"
          style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap", width: "100%", minWidth: 0 }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <div className="muted" style={{ minWidth: 0 }}>{niceDate}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
            <span
              className="badge"
              title="Win if 3+ tasks done"
              style={{ background: summary.isWin ? "var(--success-soft)" : "var(--danger-soft)", border: "1px solid var(--border)" }}
            >
              {summary.isWin ? "Win" : "Keep going"}
            </span>
            <span className="badge" title="Tasks done today">Done: {summary.doneToday}</span>
            <span
              className="badge"
              title="Current streak (best)"
              style={{ transform: streakPulse ? "scale(1.08)" : "scale(1)", transition: "transform .25s ease" }}
            >
              🔥 {summary.streak}{summary.bestStreak > 0 ? ` (best ${summary.bestStreak})` : ""}
            </span>
          </div>
        </div>

        {(greetName || greetLine) && (
          <div style={{ fontWeight: 700, wordBreak: "break-word" }}>
            {greeting} {missed ? "💜" : ""}
          </div>
        )}

        {/* Composer row */}
        <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>{timeStr}</div>
          </div>

          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim() && !adding) addTask(); }}
            placeholder="Add a task for today…"
            style={{ flex: "1 1 220px", minWidth: 0, maxWidth: "100%" }}
            aria-label="Task title"
          />

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

          <button className="btn-primary" onClick={addTask} disabled={!newTitle.trim() || adding} style={{ borderRadius: 10, flex: isCompact ? "1 1 100%" : undefined }}>
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
        <div className="muted" style={{ marginTop: -4 }}>
          {`Will be created for ${dateISO}${newRepeat ? " + future repeats" : ""}`}
        </div>

        {/* Date controls */}
        <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%", minWidth: 0 }}>
          {overdue.length > 0 && (
            <>
              <button
                onClick={moveAllOverdueHere}
                className="btn-soft"
                title="Change due date for all overdue pending tasks to this day"
                style={{ flex: isCompact ? "1 1 100%" : undefined, minWidth: 0 }}
              >
                Move all overdue here ({overdue.length})
              </button>
              <button
                onClick={() => setConfirmSkipAllOpen(true)}
                className="btn-soft"
                title="Skip all overdue tasks and clear their due dates"
                style={{ flex: isCompact ? "1 1 100%" : undefined, minWidth: 0 }}
              >
                Skip overdue ({overdue.length})
              </button>
            </>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", flexWrap: "wrap", width: isCompact ? "100%" : "auto", minWidth: 0 }}>
            <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} style={{ flex: isCompact ? "1 1 220px" : undefined, minWidth: 0, maxWidth: "100%" }} />
            <button className="btn-soft" onClick={() => setDateISO(todayISO())} style={{ flex: isCompact ? "1 1 120px" : undefined }}>Today</button>
          </div>
        </div>

        {/* Gentle Reset banner */}
        {(missed && overdue.length > 0) && (
          <div
            className="card"
            style={{
              background: "#F1F5F9",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 10,
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              Looks like life’s been full lately — that’s okay. Let’s give you a fresh start so today feels like a clean page.
            </div>
            <div className="muted">You have {overdue.length} past-due task{overdue.length === 1 ? "" : "s"}.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-soft" onClick={() => setGentleOpen(true)}>🌤️ Skip overdue & reset</button>
              <button className="btn-soft" onClick={completeAllOverdue}>✅ Mark all as Done</button>
            </div>
          </div>
        )}

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* Today (pending) */}
      <Section title="Today">
        {todayPending.length === 0 ? (
          <div className="muted">Nothing due today.</div>
        ) : (
          <ul className="list">
            {todayPending.map((t) => (
              <li key={t.id} className="item">
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                  <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", wordBreak: "break-word", minWidth: 0 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10, height: 10, borderRadius: 999, flex: "0 0 auto",
                          background: (t.category_color || colorOf(normalizeCat(t.category))) || "#E5E7EB",
                          border: "1px solid #d1d5db",
                        }}
                      />
                      <span style={{ minWidth: 0 }}>{displayTitle(t)}</span>
                      <button className="btn-soft" style={{ marginLeft: "auto" }} onClick={() => askSkipTask(t)} title="Skip this task">
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Overdue (pending) */}
      <Section title="Overdue" right={overdue.length > 0 ? <span className="muted">{overdue.length}</span> : null}>
        {overdue.length === 0 ? (
          <div className="muted">Nothing overdue. Nice!</div>
        ) : (
          <ul className="list">
            {overdue.map((t) => (
              <li key={t.id} className="item">
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                  <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", wordBreak: "break-word", minWidth: 0 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10, height: 10, borderRadius: 999, flex: "0 0 auto",
                          background: (t.category_color || colorOf(normalizeCat(t.category))) || "#E5E7EB",
                          border: "1px solid #d1d5db",
                        }}
                      />
                      <span style={{ minWidth: 0 }}>{displayTitle(t)}</span>
                      <span className="badge">Overdue</span>
                      <button className="btn-ghost" onClick={() => moveToSelectedDate(t.id)} title="Move to selected date">
                        Move to {dateISO}
                      </button>
                      <button className="btn-soft" onClick={() => askSkipTask(t)} title="Skip this overdue task">
                        Skip
                      </button>
                    </div>
                    <div className="muted" style={{ marginTop: 4, minWidth: 0 }}>
                      Due {t.due_date}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Bottom toolbar */}
      <div
        role="toolbar"
        aria-label="Quick actions"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 70,
          paddingBottom: "env(safe-area-inset-bottom,0)",
          background: "#F9FAFB",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            width: "100%",
            maxWidth: "800px",
            margin: "0 auto",
            height: 44,
          }}
        >
          <button
            onClick={openBoost}
            title="Need a Boost"
            aria-label="Need a Boost"
            style={{
              appearance: "none",
              border: 0,
              background: "#99F6E4",
              color: "#000",
              fontWeight: 700,
              fontSize: 14,
              lineHeight: "44px",
              height: "100%",
              width: "100%",
              borderRight: "1px solid #ffffff88",
            }}
          >
            ⚡ Need a Boost
          </button>

          <button
            onClick={async () => { await loadProfileIntoForm(); setProfileOpen(true); }}
            title="Profile"
            aria-label="Profile"
            style={{
              appearance: "none",
              border: 0,
              background: "#E9D5FF",
              color: "#000",
              fontWeight: 700,
              fontSize: 14,
              lineHeight: "44px",
              height: "100%",
              width: "100%",
            }}
          >
            👤 Profile
          </button>
        </div>
      </div>

      {/* Boost Modal */}
      {boostOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="boost-title">
          <div className="sheet" style={{ maxWidth: 520 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div id="boost-title" style={{ fontWeight: 800, fontSize: 18 }}>Here’s a little boost</div>
              <button className="btn-ghost" onClick={() => setBoostOpen(false)} aria-label="Close boost">Close</button>
            </div>
            <div
              className="card"
              style={{
                borderRadius: 14,
                border: `1px solid ${TOAST_BORDER}`,
                background: TOAST_BG,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
                {boostLine}
              </div>
              <img
                src={TOAST_LOGO_SRC}
                alt="BYB"
                width={40}
                height={40}
                style={{ marginRight: 10, borderRadius: 10, border: `1px solid ${TOAST_BORDER}`, background: "#fff", flex: "0 0 auto" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn-soft" onClick={nextBoost} title="Show another">Another</button>
              <button className="btn-primary" onClick={() => setBoostOpen(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Modal */}
      {profileOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Edit profile">
          <div className="sheet">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Edit your profile</div>
              <button className="btn-ghost" onClick={() => setProfileOpen(false)} aria-label="Close profile">Close</button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <div className="section-title">Your name</div>
                <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Enter your name" />
              </label>

              <div className="section-title">Pick nicknames</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DEFAULT_NICKNAMES.map((n) => {
                  const on = poolInput.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleNick(n)}
                      className="btn-soft"
                      style={{
                        borderRadius: 999,
                        background: on ? "#e0f2fe" : "",
                        border: on ? "1px solid #38bdf8" : "1px solid var(--border)",
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>

              <div>
                <div className="section-title" style={{ marginBottom: 6 }}>Selected nicknames</div>
                {poolInput.length === 0 ? (
                  <div className="muted">None yet.</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {poolInput.map((n) => (
                      <span key={n} className="chip">
                        <span>{n}</span>
                        <button aria-label={`Remove ${n}`} onClick={() => removeNick(n)} title={`Remove ${n}`}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={customNicks}
                  onChange={(e) => setCustomNicks(e.target.value)}
                  placeholder="Add custom nicknames (comma-separated)…"
                  onKeyDown={(e) => { if (e.key === "Enter") addCustomFromInput(); }}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button className="btn-soft" onClick={addCustomFromInput}>Add</button>
                <button className="btn-soft" onClick={() => setConfirmResetOpen(true)} title="Clear all nicknames">Reset</button>
              </div>

              {err && <div style={{ color: "red" }}>{err}</div>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                <button className="btn-soft" onClick={() => setProfileOpen(false)}>Cancel</button>
                <button className="btn-primary" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gentle Reset Modal */}
      {gentleOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="gentle-title">
          <div className="sheet" style={{ maxWidth: 520 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div id="gentle-title" style={{ fontWeight: 800, fontSize: 18 }}>Start fresh?</div>
              <button className="btn-ghost" onClick={() => setGentleOpen(false)} aria-label="Close">Close</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              We’ll <b>skip</b> your overdue tasks (no penalty) and clear their due dates so you can focus on a clean list.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-soft" onClick={() => setGentleOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={gentleResetBacklog}>🌤️ Skip overdue & reset</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Skip ALL Overdue */}
      {confirmSkipAllOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="skip-overdue-title">
          <div className="sheet" style={{ maxWidth: 520 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div id="skip-overdue-title" style={{ fontWeight: 800, fontSize: 18 }}>Skip all overdue?</div>
              <button className="btn-ghost" onClick={() => setConfirmSkipAllOpen(false)} aria-label="Close">Close</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              This will <b>skip</b> your overdue tasks (no penalty) and clear their due dates so you can start fresh.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-soft" onClick={() => setConfirmSkipAllOpen(false)}>No, keep them</button>
              <button className="btn-primary" onClick={skipAllOverdue}>Yes — skip overdue</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Skip ONE Task */}
      {taskToSkip && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="skip-one-title">
          <div className="sheet" style={{ maxWidth: 520 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div id="skip-one-title" style={{ fontWeight: 800, fontSize: 18 }}>Skip this task?</div>
              <button className="btn-ghost" onClick={() => setTaskToSkip(null)} aria-label="Close">Close</button>
            </div>
            <p style={{ marginTop: 0 }}>
              <b>{displayTitle(taskToSkip)}</b>
            </p>
            <p className="muted" style={{ marginTop: 0 }}>
              This will mark it as <b>skipped</b> and clear its due date. You can always re-add it later.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-soft" onClick={() => setTaskToSkip(null)}>No, keep it</button>
              <button className="btn-primary" onClick={confirmSkipTask}>Yes — skip it</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast & Celebration nodes */}
      {toast.node}
      {celebration.node}
    </div>
  );

  /* ===== Profile helpers (inside component for state access) ===== */
  async function loadProfileIntoForm() {
    try {
      if (userId) {
        const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
        if (!error && data) {
          const dn = (data as any).display_name ?? localStorage.getItem(LS_NAME) ?? "";
          setNameInput(dn);
          const raw = (data as any).display_pool;
          if (Array.isArray(raw)) {
            setPoolInput(raw as string[]);
          } else if (typeof raw === "string") {
            try { setPoolInput(JSON.parse(raw)); } catch { setPoolInput([]); }
          } else {
            try { setPoolInput(JSON.parse(localStorage.getItem(LS_POOL) || "[]")); } catch { setPoolInput([]); }
          }
          return;
        }
      }
      setNameInput(localStorage.getItem(LS_NAME) || "");
      try { setPoolInput(JSON.parse(localStorage.getItem(LS_POOL) || "[]")); } catch { setPoolInput([]); }
    } catch {
      setNameInput(localStorage.getItem(LS_NAME) || "");
      try { setPoolInput(JSON.parse(localStorage.getItem(LS_POOL) || "[]")); } catch { setPoolInput([]); }
    }
  }

  function toggleNick(n: string) {
    const v = n.trim();
    if (!v) return;
    setPoolInput((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }
  function removeNick(n: string) {
    setPoolInput((prev) => prev.filter((x) => x !== n));
  }
  function addCustomFromInput() {
    const parts = customNicks.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const merged = Array.from(new Set([...(poolInput || []), ...parts]));
    setPoolInput(merged);
    setCustomNicks("");
  }
  async function saveProfile() {
    const cleanName = (nameInput || "").trim() || "Friend";
    const chosenPool = poolInput || [];
    setSavingProfile(true);
    let wroteToDB = false;
    try {
      if (userId) {
        try {
          const payload: any = { display_name: cleanName, display_pool: chosenPool, onboarding_done: true };
          const { error } = await supabase.from("profiles").upsert({ id: userId, ...payload }).select().limit(1);
          if (error) throw error;
          wroteToDB = true;
        } catch {
          const { error: e2 } = await supabase
            .from("profiles")
            .upsert({ id: userId, display_name: cleanName, onboarding_done: true })
            .select()
            .limit(1);
          if (!e2) wroteToDB = true;
        }
      }
      try {
        localStorage.setItem(LS_NAME, cleanName);
        localStorage.setItem(LS_POOL, JSON.stringify(chosenPool));
      } catch {}
      setGreetName(pickGreetingLabel());
      toast.show(wroteToDB ? "Profile updated" : "Saved locally (no display_pool column)");
      setProfileOpen(false);
    } catch (e: any) {
      setErr(e.message || String(e));
      toast.show("Couldn’t save profile");
    } finally {
      setSavingProfile(false);
    }
  }
}
