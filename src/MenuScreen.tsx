// src/MenuScreen.tsx
type MenuItem = {
  key:
    | "calendar"
    | "goals"
    | "vision"
    | "gratitude"
    | "exercise"
    | "wins"
    | "alfred"
    | "confidence"
    | "notes"
    | "focus"
    | "meditation"
    | "affirmations";
  label: string;
  icon: string;
  desc?: string;
};

const ITEMS: MenuItem[] = [
  { key: "calendar",     label: "Calendar",     icon: "🗓️", desc: "Plan your days" },
  { key: "goals",        label: "Goals",        icon: "🎯", desc: "Track big aims" },
  { key: "vision",       label: "Vision Board", icon: "🌈", desc: "See your why" },
  { key: "gratitude",    label: "Gratitude",    icon: "🙏", desc: "Daily thanks" },
  { key: "exercise",     label: "Exercise",     icon: "🏋️", desc: "Move & log" },
  { key: "wins",         label: "Your Successes", icon: "🏆", desc: "Celebrate progress" },
  { key: "alfred",       label: "Alfred",       icon: "🤖", desc: "Your AI helper" },
  { key: "confidence",   label: "Confidence",   icon: "🔥", desc: "Confidence moves" },
  { key: "notes",        label: "Notes",        icon: "📝", desc: "Capture thoughts" },
  { key: "focus",        label: "Focus",        icon: "🎧", desc: "Deep work mode" },
  { key: "meditation",   label: "Meditation",   icon: "📺", desc: "Guided & saved" },
  { key: "affirmations", label: "Affirmations", icon: "✨", desc: "Builder & archive" },
];

export default function MenuScreen({
  onOpenTab,
}: {
  onOpenTab: (key: MenuItem["key"]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ borderLeft: "6px solid #eef2ff" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Menu</h2>
        <div className="muted">Everything in one place.</div>
      </div>

      {/* Grid menu */}
      <div
        className="card"
        style={{
          padding: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          }}
        >
          {ITEMS.map((it) => (
            <button
              key={it.key}
              onClick={() => onOpenTab(it.key)}
              className="btn-soft"
              style={{
                textAlign: "left",
                borderRadius: 14,
                padding: 12,
                display: "grid",
                gap: 6,
                alignContent: "start",
              }}
            >
              <div style={{ fontSize: 22 }} aria-hidden>
                {it.icon}
              </div>
              <div style={{ fontWeight: 700 }}>{it.label}</div>
              {it.desc && <div className="muted" style={{ fontSize: 12 }}>{it.desc}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
