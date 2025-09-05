// src/MenuScreen.tsx
import type { ReactNode } from "react";

/** Public path helper (works with Vite/CRA/Vercel/GH Pages) */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}

// Path to your butterfly logo in /public
const EVA_ICON_SRC = publicPath("/LogoButterfly.png");

type MenuItem = {
  key:
    | "today"
    | "calendar"
    | "goals"
    | "vision"
    | "gratitude"
    | "exercise"
    | "wins"
    | "eva"
    | "confidence"
    | "notes"
    | "focus"
    | "meditation"
    | "affirmations";
  label: string;
  icon: ReactNode; // supports emoji or <img>
  desc?: string;
};

const EvaIcon = () => (
  <img
    src={EVA_ICON_SRC}
    alt="Eva"
    width={28}
    height={28}
    style={{ display: "block" }}
    onError={(e) => {
      // fallback to 🦋 emoji if image fails
      const span = document.createElement("span");
      span.textContent = "🦋";
      span.style.fontSize = "28px";
      const parent = e.currentTarget.parentElement;
      if (parent) {
        parent.replaceChild(span, e.currentTarget);
      }
    }}
  />
);

const ITEMS: MenuItem[] = [
  { key: "today",        label: "Today Page",   icon: "✅" },
  { key: "calendar",     label: "Calendar",     icon: "🗓️" },
  { key: "goals",        label: "Goals",        icon: "🎯" },
  { key: "vision",       label: "Vision Board", icon: "🌈" },
  { key: "gratitude",    label: "Gratitude",    icon: "🙏" },
  { key: "exercise",     label: "Exercise",     icon: "🏋️" },
  { key: "wins",         label: "Your Wins",    icon: "🏆" }, // updated label
  { key: "eva",          label: "Eva",          icon: <EvaIcon /> }, // updated name + logo
  { key: "confidence",   label: "Confidence",   icon: "🔥" },
  { key: "notes",        label: "Notes",        icon: "📝" },
  { key: "focus",        label: "Focus",        icon: "🎧" },
  { key: "meditation",   label: "Meditation",   icon: "📺" },
  { key: "affirmations", label: "Affirmations", icon: "✨" },
];

export default function MenuScreen({
  onOpenTab,
}: {
  onOpenTab: (key: MenuItem["key"]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Today Page card right at the top */}
      <div
        className="card"
        style={{
          borderLeft: "6px solid #eef2ff",
          padding: "16px",
          cursor: "pointer",
        }}
        onClick={() => onOpenTab("today")}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Today Page</h2>
        <div className="muted">Jump straight back to your main view.</div>
      </div>

      {/* Rest of the menu */}
      <div className="card" style={{ padding: 12 }}>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
   {ITEMS.filter((it) => it.key !== "today").map((it) => (
  <button
    key={it.key}
    onClick={() => onOpenTab(it.key)}
    className="btn-soft"
    style={{
      borderRadius: 16,
      padding: 14,
      display: "grid",
      gap: 6,
      alignContent: "center",
      justifyItems: "center",
      textAlign: "center",
      minHeight: 110,
    }}
  >
    <div style={{ fontSize: 28, lineHeight: 0 }} aria-hidden>
      {it.icon}
    </div>
    {/* ⬇️ added marginTop */}
    <div style={{ fontWeight: 700, marginTop: 8 }}>{it.label}</div>
  </button>
))}
        </div>
      </div>
    </div>
  );
}
