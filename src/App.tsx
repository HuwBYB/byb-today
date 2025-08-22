import { useMemo, useState } from "react";
import AuthGate from "./AuthGate";

import TodayScreen from "./TodayScreen";
import CalendarScreen from "./CalendarScreen";
import GoalsScreen from "./GoalsScreen";
import VisionBoardScreen from "./VisionBoardScreen";
import GratitudeScreen from "./GratitudeScreen";
import ExerciseDiaryScreen from "./ExerciseDiaryScreen";
import WinsScreen from "./WinsScreen";
import AlfredScreen from "./AlfredScreen";
import ConfidenceScreen from "./ConfidenceScreen";
import NotesScreen from "./NotesScreen";
import FocusAlfredScreen from "./FocusAlfredScreen";
import AffirmationBuilderScreen from "./AffirmationBuilderScreen"; // ⬅️ NEW

type Tab =
  | "today"
  | "calendar"
  | "goals"
  | "vision"
  | "gratitude"
  | "exercise"
  | "notes"
  | "wins"
  | "alfred"
  | "focus"
  | "confidence"
  | "builder"; // ⬅️ NEW

export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [externalDateISO, setExternalDateISO] = useState<string | undefined>(undefined);

  function openTodayFor(iso: string) {
    setExternalDateISO(iso);
    setTab("today");
  }

  const tabs = useMemo(
    () =>
      [
        { key: "today",      label: "Today",       icon: "✅" },
        { key: "calendar",   label: "Calendar",    icon: "🗓️" },
        { key: "goals",      label: "Goals",       icon: "🎯" },
        { key: "vision",     label: "Vision",      icon: "🖼️" },
        { key: "gratitude",  label: "Gratitude",   icon: "🙏" },
        { key: "exercise",   label: "Exercise",    icon: "🏋️" },
        { key: "notes",      label: "Notes",       icon: "📝" },
        { key: "wins",       label: "Successes",   icon: "🏆" },
        { key: "alfred",     label: "Alfred",      icon: "🤖" },
        { key: "focus",      label: "Focus",       icon: "⏱️" },
        { key: "confidence", label: "Confidence",  icon: "⚡" },
        { key: "builder",    label: "Builder",     icon: "✨" }, // ⬅️ NEW
      ] as Array<{ key: Tab; label: string; icon: string }>,
    []
  );

  return (
    <AuthGate>
      {/* Page-scoped styles for header visibility + bottom tabbar */}
      <style>{CSS_APP}</style>

      {/* Desktop header (hidden on small screens via CSS) */}
      <div className="only-desktop">
        <div className="container" style={{ padding: 12 }}>
          <div
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong>Best You Blueprint</strong>
              <span className="muted">• build your ideal day</span>
            </div>
            <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    if (t.key === "today") setExternalDateISO(undefined);
                    setTab(t.key);
                  }}
                  className={tab === t.key ? "btn-primary" : ""}
                  style={{ borderRadius: 10 }}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* Content shell (inside container; extra bottom padding for tabbar) */}
      <div className="app-shell">
        <div className="container" style={{ display: "grid", gap: 12 }}>
          {tab === "today" && <TodayScreen externalDateISO={externalDateISO} />}

          {tab === "calendar" && (
            <CalendarScreen onSelectDate={(iso) => openTodayFor(iso)} />
          )}

          {tab === "goals" && <GoalsScreen />}

          {tab === "vision" && <VisionBoardScreen />}

          {tab === "gratitude" && <GratitudeScreen />}

          {tab === "exercise" && <ExerciseDiaryScreen />}

          {tab === "notes" && <NotesScreen />}

          {tab === "wins" && <WinsScreen />}

          {tab === "alfred" && <AlfredScreen />}

          {tab === "focus" && <FocusAlfredScreen />}

          {tab === "confidence" && <ConfidenceScreen />}

          {tab === "builder" && <AffirmationBuilderScreen />}{/* ⬅️ NEW */}
        </div>
      </div>

      {/* Mobile sticky bottom tab bar */}
      <MobileTabbar
        active={tab}
        setActive={(t) => {
          if (t === "today") setExternalDateISO(undefined);
          setTab(t);
        }}
        tabs={tabs}
      />
    </AuthGate>
  );
}

function MobileTabbar({
  active,
  setActive,
  tabs,
}: {
  active: Tab;
  setActive: (t: Tab) => void;
  tabs: Array<{ key: Tab; label: string; icon: string }>;
}) {
  return (
    <div className="tabbar" role="navigation" aria-label="Bottom tabs">
      <div className="container">
        <div className="tabbar-inner">
          {tabs.map((t) => (
            <button
              key={t.key}
              className="tab-btn"
              data-active={active === t.key}
              onClick={() => setActive(t.key)}
              title={t.label}
            >
              <div className="icon" aria-hidden>{t.icon}</div>
              <div className="label">{t.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- Local CSS to guarantee correct mobile layout & bottom nav --------- */
const CSS_APP = `
/* hide desktop header on small screens */
.only-desktop { display: block; }
@media (max-width: 900px){ .only-desktop { display: none; } }

/* keep content clear of the fixed bottom bar (with iOS safe area) */
.app-shell { padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }

/* bottom tab bar */
.tabbar{
  position: fixed; left: 0; right: 0; bottom: 0;
  background: rgba(255,255,255,.85);
  backdrop-filter: saturate(1.2) blur(8px);
  border-top: 1px solid var(--border);
  z-index: 40;
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 900px){ .tabbar { display: none; } }

.tabbar-inner{
  display: flex;
  justify-content: space-around;
  gap: 8px;
}

/* pill-style buttons that reflect active tab */
.tab-btn{
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  border-radius: 12px;
  padding: 8px 10px;
  min-width: 72px;
}
.tab-btn .icon{ font-size: 18px; line-height: 1; }
.tab-btn .label{ font-size: 12px; }

.tab-btn[data-active="true"]{
  background: hsl(var(--pastel-hsl) / .60);
  border-color: hsl(var(--pastel-hsl) / .75);
  color: var(--primary);
}
`;
