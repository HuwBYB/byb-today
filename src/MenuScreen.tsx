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
    | "ideas"      // Big Ideas page
    | "focus"
    | "meditation"
    | "motivation"
    | "affirmations"
    | "tutorials"
    | "terms"      // Terms page
    | "charity";   // NEW: Charity Pledge page
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
  { key: "ideas",        label: "Big Ideas",       icon: "🧠" },
  { key: "focus",        label: "Focus",           icon: "🎧" },
  { key: "meditation",   label: "Meditation",      icon: "📺" },
  { key: "motivation",   label: "Motivation",      icon: "🚀" },
  { key: "affirmations", label: "Affirmations",    icon: "✨" },
  { key: "tutorials",    label: "Tutorials",       icon: "🎓" },
  { key: "terms",        label: "Terms",           icon: "📜" },
  { key: "charity",      label: "Charity Pledge",  icon: "❤️" }, // NEW
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
          background: "linear-gradient(180deg, #eef2ff 0%, #ffffff 90%)",
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

      {/* Grid menu — 4 per row, compact tiles */}
      <div className="card" style={{ padding: 10, position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))", // four per row
          }}
        >
          {ITEMS.filter((it) => it.key !== "today").map((it) => (
            <button
              key={it.key}
              onClick={() => onOpenTab(resolveKey(it.key))}
              className="btn-soft"
              style={{
                borderRadius: 12,
                padding: 10,
                display: "grid",
                gap: 4,
                alignContent: "center",
                justifyItems: "center",
                textAlign: "center",
                minHeight: 96, // smaller but still a good tap target
              }}
              title={it.label}
              aria-label={it.label}
            >
              {/* Icon container for emoji or images */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-hidden
              >
                {it.icon.endsWith?.(".png") || it.icon.endsWith?.(".jpg") ? (
                  <img
                    src={it.icon}
                    alt=""
                    style={{ maxWidth: 28, maxHeight: 28, objectFit: "contain" }}
                  />
                ) : (
                  <span style={{ fontSize: 24, lineHeight: 1 }}>{it.icon}</span>
                )}
              </div>

              {/* Label — reduced ~20% for tighter fit */}
              <div
                style={{
                  fontWeight: 700,
                  marginTop: 6,
                  fontSize: 10, // ~20% smaller than the old size
                  lineHeight: 1.1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                }}
              >
                {it.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom spacer to guarantee tap room beyond any fixed elements */}
      <div style={{ height: 24 }} />
    </div>
  );
}
