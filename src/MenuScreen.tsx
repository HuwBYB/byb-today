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
  { key: "calendar",     label: "Calendar",        icon: "🗓️" },
  { key: "goals",        label: "Goals",           icon: "🎯" },
  { key: "vision",       label: "Vision Board",    icon: "🌈" },
  { key: "gratitude",    label: "Gratitude",       icon: "🙏" },
  { key: "exercise",     label: "Exercise",        icon: "🏋️" },
  { key: "wins",         label: "Your Successes",  icon: "🏆" },
  { key: "alfred",       label: "Alfred",          icon: "🤖" },
  { key: "confidence",   label: "Confidence",      icon: "🔥" },
  { key: "notes",        label: "Notes",           icon: "📝" },
  { key: "focus",        label: "Focus",           icon: "🎧" },
  { key: "meditation",   label: "Meditation",      icon: "📺" },
  { key: "affirmations", label: "Affirmations",    icon: "✨" },
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

      <div className="card" style={{ padding: 12 }}>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))", // <-- fixed two columns
          }}
        >
          {ITEMS.map((it) => (
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
              <div style={{ fontSize: 28 }} aria-hidden>
                {it.icon}
              </div>
              <div style={{ fontWeight: 700 }}>{it.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
