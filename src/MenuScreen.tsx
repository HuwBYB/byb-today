// src/MenuScreen.tsx
type MenuItem = {
  key:
    | "today"
    | "calendar"
    | "goals"
    | "vision"
    | "gratitude"
    | "exercise"
    | "wins"
    | "alfred"     // keep router key for Eva
    | "eva"        // optional: keep in the type for future-proofing
    | "confidence"
    | "notes"
    | "focus"
    | "meditation"
    | "motivation" // ⬅️ NEW
    | "affirmations";
  label: string;
  icon: string; // emoji OR image path
  desc?: string;
};

const ITEMS: MenuItem[] = [
  { key: "today",        label: "Today Page",      icon: "✅" },
  { key: "calendar",     label: "Calendar",        icon: "🗓️" },
  { key: "goals",        label: "Goals",           icon: "🎯" },
  { key: "vision",       label: "Vision Board",    icon: "🌈" },
  { key: "gratitude",    label: "Gratitude",       icon: "🙏" },
  { key: "exercise",     label: "Exercise",        icon: "🏋️" },
  { key: "wins",         label: "Your Wins",       icon: "🏆" },
  // Use the router's existing key but the new name
  { key: "alfred",       label: "Eva",             icon: "💡" },
  { key: "confidence",   label: "Confidence",      icon: "🔥" },
  { key: "notes",        label: "Notes / Journal", icon: "📝" },
  { key: "focus",        label: "Focus",           icon: "🎧" },
  { key: "meditation",   label: "Meditation",      icon: "📺" },
  { key: "motivation",   label: "Motivation",      icon: "🚀" }, // ⬅️ NEW
  { key: "affirmations", label: "Affirmations",    icon: "✨" },
];

export default function MenuScreen({
  onOpenTab,
}: {
  onOpenTab: (key: MenuItem["key"]) => void;
}) {
  // Back-compat if "eva" ever appears in ITEMS
  const resolveKey = (k: MenuItem["key"]): MenuItem["key"] =>
    k === "eva" ? "alfred" : k;

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        // Safe padding so bottom items are fully tappable above mobile toolbars/overlays
        paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* Today — long primary-style button with Home icon */}
      <button
        onClick={() => onOpenTab("today")}
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 16,
          borderRadius: 16,
          borderLeft: "6px solid #c7d2fe",
          background:
            "linear-gradient(180deg, #eef2ff 0%, #ffffff 90%)",
        }}
        aria-label="Go to Today page"
        title="Go to Today"
      >
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: "#ffffff",
            border: "1px solid var(--border)",
            boxShadow: "0 6px 14px rgba(0,0,0,.06)",
            flex: "0 0 auto",
          }}
        >
          <span style={{ fontSize: 24, lineHeight: 1 }}>🏠</span>
        </div>
        <div style={{ display: "grid", gap: 2, textAlign: "left" }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Today</div>
          <div className="muted">Jump straight back to your main view.</div>
        </div>
      </button>

      {/* Rest of the menu */}
      <div className="card" style={{ padding: 12, position: "relative", zIndex: 1 }}>
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
              onClick={() => onOpenTab(resolveKey(it.key))}
              className="btn-soft"
              style={{
                borderRadius: 16,
                padding: 14,
                display: "grid",
                gap: 6,
                alignContent: "center",
                justifyItems: "center",
                textAlign: "center",
                minHeight: 120, // comfortable tap area
              }}
              title={it.label}
              aria-label={it.label}
            >
              {/* Icon container for both emoji and image */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-hidden
              >
                {it.icon.endsWith(".png") || it.icon.endsWith(".jpg") ? (
                  <img
                    src={it.icon}
                    alt=""
                    style={{ maxWidth: 32, maxHeight: 32, objectFit: "contain" }}
                  />
                ) : (
                  <span style={{ fontSize: 28, lineHeight: 1 }}>{it.icon}</span>
                )}
              </div>

              {/* Label */}
              <div style={{ fontWeight: 700, marginTop: 12 }}>{it.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom spacer to guarantee tap room beyond any fixed elements */}
      <div style={{ height: 40 }} />
    </div>
  );
}
