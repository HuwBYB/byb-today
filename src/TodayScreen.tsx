// src/TodayScreen.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

// ✅ Pull just what we use from the central categories module
import { colorOf, normalizeCat } from "./theme/categories";
// ✅ Keep global CSS as a side-effect import
import "./theme.css";

/* =============================================
   BYB — Today Screen (Profile editor + Boost + Gentle Reset)
   ============================================= */

/* ===== Logo & Toast theme ===== */
const TOAST_LOGO_SRC = "/LogoButterfly.png"; // served from public/
const TOAST_BG = "#D7F0FA";                   // match App banner
const TOAST_BORDER = "#bfe5f3";               // subtle border to suit the bg

/* ===== Types ===== */
type Task = {
  id: number;
  user_id: string;
  title: string;
  due_date: string | null;
  status: "pending" | "done" | "missed" | string; // added "missed" as a soft status
  priority: number | null;
  source: string | null;
  goal_id: number | null;
  completed_at: string | null;
  // category fields
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
      ...(Array.isArray(pool) ? pool.filter(Boolean) : []),
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
  return nameLabel ? `${prefix}, ${nameLabel}` : prefix;
}

/* ===== Summary ===== */
type Summary = {
  doneToday: number;
  pendingToday: number;
  isWin: boolean;
  streak: number;
  bestStreak: number;
};

function formatNiceDate(iso: string): string {
  try {
    const d = fromISO(iso);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

/* ===== Fireworks (canvas) – replaces confetti ===== */
function fireFireworks(durationMs = 2200) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.zIndex = "4000";
  canvas.style.pointerEvents = "none";
  document.body.appendChild(canvas);

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  function resize() {
    canvas.width = Math.floor(window.innerWidth * DPR);
    canvas.height = Math.floor(window.innerHeight * DPR);
  }
  resize();
  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  type Particle = { x:number; y:number; vx:number; vy:number; life:number; maxLife:number; color:string };
  const particles: Particle[] = [];
  const COLORS = ["#fde047", "#60a5fa", "#34d399", "#f472b6", "#a78bfa", "#fb923c"];

  function burst(cx: number, cy: number, count = 60) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 40 + Math.random() * 20,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
  }

  const W = () => canvas.width;
  const H = () => canvas.height;
  const burstCount = 3 + ((Math.random() * 2) | 0);
  for (let i = 0; i < burstCount; i++) {
    const t = i * (durationMs / burstCount);
    setTimeout(() => {
      const x = (0.25 + Math.random() * 0.5) * W();
      const y = (0.25 + Math.random() * 0.5) * H();
      burst(x, y);
    }, t);
  }

  let raf = 0;
  const gravity = 0.06 * DPR;
  const start = performance.now();

  function tick(now: number) {
    // fade frame for trails
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, W(), H());
    ctx.globalCompositeOperation = "lighter";

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += gravity;

      const alpha = 1 - p.life / p.maxLife;
      if (alpha <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 * DPR, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (now - start < durationMs || particles.length > 0) {
      raf = requestAnimationFrame(tick);
    } else {
      cleanup();
    }
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    canvas.remove();
  }

  raf = requestAnimationFrame(tick);
}

/* ===== Encouragements + Toast ===== */
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

/* ===== Big Celebration Message (center overlay) ===== */
function useCelebration() {
  const [text, setText] = useState<string | null>(null);

  function show(message: string, ms = 2200) {
    setText(message);
    window.clearTimeout((show as any)._t);
    (show as any)._t = window.setTimeout(() => setText(null), ms);
  }

  const node = (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        display: text ? "grid" : "none",
        placeItems: "center",
        zIndex: 4500,
        pointerEvents: "none",
      }}
    >
      <div
        className="card"
        style={{
          pointerEvents: "auto",
          background: "rgba(255,255,255,0.96)",
          border: "1px solid #e5e7eb",
          padding: "18px 22px",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.15)",
          maxWidth: "min(92vw, 720px)",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            fontSize: "clamp(20px, 4.5vw, 36px)",
            textAlign: "center",
            lineHeight: 1.2,
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );

  return { node, show };
}

/* ===== Nickname options (match onboarding) ===== */
const DEFAULT_NICKNAMES = [
  "King","Champ","Legend","Boss","Chief","Star","Ace","Hero","Captain","Tiger",
  "Queen","Princess","Gurl","Boss Lady","Diva","Hot Stuff","Girlfriend",
];

/* ===== Boost lines (unisex, always positive) ===== */
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

  // Add task (top composer)
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

  // Supportive backlog reset
  const [gentleOpen, setGentleOpen] = useState(false);

  // Responsive
  const [isCompact, setIsCompact] = useState<boolean>(false);
  useEffect(() => {
    function check() { setIsCompact(window.innerWidth < 420); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Summary
  const [summary, setSummary] = useState<Summary>({
    doneToday: 0,
    pendingToday: 0,
    isWin: false,
    streak: 0,
    bestStreak: 0,
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

  const toast = useToast();
  const celebration = useCelebration();

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

  // Overdue helper
  const isOverdueFn = (t: Task) =>
    !!t.due_date && t.status !== "done" && fromISO(t.due_date.slice(0, 10)).getTime() < fromISO(dateISO).getTime();

  /* ===== Data loading (DEFENSIVE) ===== */
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

      const list = normalized.filter(
        (t) => t.due_date !== null && (t.due_date === dateISO || (t.due_date < dateISO && t.status !== "done"))
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
      const pendingToday = normalized.filter((t) => t.due_date === dateISO && t.status !== "done").length;
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
        fireFireworks();
        celebration.show(pick(ENCOURAGE_LINES));
        // Optionally keep the tiny toast too:
        // toast.show(pick(ENCOURAGE_LINES));
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

  // ===== Gentle Reset helpers =====
  async function gentleResetBacklog() {
    if (!userId) return;
    const backlogIds = tasks.filter(t => isOverdueFn(t)).map(t => t.id);
    if (backlogIds.length === 0) { setGentleOpen(false); return; }
    try {
      // Mark overdue as "missed" (soft archive) and clear due_date so they no longer appear
      const { error } = await supabase
        .from("tasks")
        .update({ status: "missed", due_date: null, completed_at: null })
        .in("id", backlogIds);
      if (error) throw error;
      await loadAll();
      setGentleOpen(false);
      toast.show("Fresh page set — you’re good to go.");
    } catch (e: any) {
      setErr(e.message || String(e));
    }
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
      fireFireworks();
      celebration.show(pick(ENCOURAGE_LINES));
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  /* ===== Boost helpers (fix build errors & use BOOST_LINES) ===== */
  function openBoost() {
    setBoostLine(pick(BOOST_LINES));
    setBoostOpen(true);
  }
  function nextBoost() {
    setBoostLine(pick(BOOST_LINES));
  }

  /* ===== Computed ===== */
  const niceDate = useMemo(() => formatNiceDate(dateISO), [dateISO]);
  const greeting = useMemo(() => (greetLine || timeGreeting(now)), [greetLine, now]);
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const overdue = tasks.filter(isOverdueFn);
  const todayPending = tasks.filter((t) => t.due_date === dateISO && t.status !== "done");

  /* ===== Section helper ===== */
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
            <button
              onClick={moveAllOverdueHere}
              className="btn-soft"
              title="Change due date for all overdue pending tasks to this day"
              style={{ flex: isCompact ? "1 1 100%" : undefined, minWidth: 0 }}
            >
              Move all overdue here ({overdue.length})
            </button>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", flexWrap: "wrap", width: isCompact ? "100%" : "auto", minWidth: 0 }}>
            <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} style={{ flex: isCompact ? "1 1 220px" : undefined, minWidth: 0, maxWidth: "100%" }} />
            <button className="btn-soft" onClick={() => setDateISO(todayISO())} style={{ flex: isCompact ? "1 1 120px" : undefined }}>Today</button>
          </div>
        </div>

        {/* Gentle Reset banner (shows if you were away and have backlog) */}
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
              <button className="btn-soft" onClick={() => setGentleOpen(true)}>🌤️ Mark as Missed & Reset</button>
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
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                  <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", wordBreak: "break-word", minWidth: 0 }}>
                      {/* Category dot */}
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10, height: 10, borderRadius: 999, flex: "0 0 auto",
                          background: (t.category_color || colorOf(normalizeCat(t.category))) || "#E5E7EB",
                          border: "1px solid #d1d5db",
                        }}
                      />
                      <span style={{ minWidth: 0 }}>{displayTitle(t)}</span>
                    </div>
                  </div>
                </label>
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
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                  <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", wordBreak: "break-word", minWidth: 0 }}>
                      {/* Category dot */}
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
                      <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => moveToSelectedDate(t.id)}>
                        Move to {dateISO}
                      </button>
                    </div>
                    <div className="muted" style={{ marginTop: 4, minWidth: 0 }}>
                      Due {t.due_date}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ===== Fixed Bottom Bar: Boost (left) + Profile (right) ===== */}
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
              background: "#99F6E4", // pastel teal
              color: "#000",          // black text
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
              background: "#E9D5FF", // pastel purple
              color: "#000",          // black text
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
            {/* Header row with close */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div id="boost-title" style={{ fontWeight: 800, fontSize: 18 }}>Here’s a little boost</div>
              <button className="btn-ghost" onClick={() => setBoostOpen(false)} aria-label="Close boost">Close</button>
            </div>

            {/* Message + BYB logo on the right */}
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

            {/* Actions */}
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

              {/* Selected chips incl. customs (removable) */}
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
              We’ll mark your overdue tasks as <b>Missed</b> (no penalty) and clear them from today so you can focus on a clean list.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-soft" onClick={() => setGentleOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={gentleResetBacklog}>🌤️ Mark as Missed & Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* Celebration + Toast nodes */}
      {celebration.node}
      {toast.node}
    </div>
  );

  /* ===== Profile helpers (placed at the end to keep main flow readable) ===== */
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
