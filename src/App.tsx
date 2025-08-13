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

type Tab =
  | "today"
  | "calendar"
  | "goals"
  | "vision"
  | "gratitude"
  | "exercise"
  | "wins"
  | "alfred"
  | "confidence";

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
        { key: "today",      label: "Today",      icon: "✅" },
        { key: "calendar",   label: "Calendar",   icon: "🗓️" },
        { key: "goals",      label: "Goals",      icon: "🎯" },
        { key: "vision",     label: "Vision",     icon: "🖼️" },
        { key: "gratitude",  label: "Gratitude",  icon: "🙏" },
        { key: "exercise",   label: "Exercise",   icon: "🏋️" },
        { key: "wins",       label: "Successes",  icon: "🏆" },
        { key: "alfred",     label: "Alfred",     icon: "🤖" },
        { key: "confidence", label: "Confidence", icon: "⚡" },
      ] as Array<{ key: Tab; label: string; icon: string }>,
    []
  );

  return (
    <AuthGate>
      {/* Desktop header (kept minimal, hidden on small screens via CSS) */}
      <div className="only-desktop" style={{ padding: 12 }}>
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

      {/* Content shell (adds bottom padding so tabbar never overlaps content) */}
      <div className="app-shell">
        {tab === "today" && <TodayScreen externalDateISO={externalDateISO} />}

        {tab === "calendar" && (
          <CalendarScreen onSelectDate={(iso) => openTodayFor(iso)} />
        )}

        {tab === "goals" && <GoalsScreen />}

        {tab === "vision" && <VisionBoardScreen />}

        {tab === "gratitude" && <GratitudeScreen />}

        {tab === "exercise" && <ExerciseDiaryScreen />}

        {tab === "wins" && <WinsScreen />}

        {tab === "alfred" && <AlfredScreen />}

        {tab === "confidence" && <ConfidenceScreen />}
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
    <div className="tabbar">
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
  );
}
