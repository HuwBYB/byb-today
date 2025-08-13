import { useState } from "react";
import AuthGate from "./AuthGate";

import TodayScreen from "./TodayScreen";
import CalendarScreen from "./CalendarScreen";
import GoalsScreen from "./GoalsScreen";
import VisionBoardScreen from "./VisionBoardScreen";
import GratitudeScreen from "./GratitudeScreen";
import WinsScreen from "./WinsScreen";
import AlfredScreen from "./AlfredScreen";
import ConfidenceScreen from "./ConfidenceScreen";

type Tab =
  | "today"
  | "calendar"
  | "goals"
  | "vision"
  | "gratitude"
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

  return (
    <AuthGate>
      <div style={{ display: "grid", gap: 12, padding: 12, maxWidth: 1100, margin: "0 auto" }}>
        {/* Top bar / nav */}
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong>Best You Blueprint</strong>
            <span className="muted">• build your ideal day</span>
          </div>
          <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <NavBtn active={tab === "today"} onClick={() => { setExternalDateISO(undefined); setTab("today"); }} label="Today" />
            <NavBtn active={tab === "calendar"} onClick={() => setTab("calendar")} label="Calendar" />
            <NavBtn active={tab === "goals"} onClick={() => setTab("goals")} label="Goals" />
            <NavBtn active={tab === "vision"} onClick={() => setTab("vision")} label="Vision" />
            <NavBtn active={tab === "gratitude"} onClick={() => setTab("gratitude")} label="Gratitude" />
            <NavBtn active={tab === "wins"} onClick={() => setTab("wins")} label="Successes" />
            <NavBtn active={tab === "alfred"} onClick={() => setTab("alfred")} label="Alfred" />
            <NavBtn active={tab === "confidence"} onClick={() => setTab("confidence")} label="Confidence" />
          </nav>
        </div>

        {/* Screens */}
        {tab === "today" && <TodayScreen externalDateISO={externalDateISO} />}

        {tab === "calendar" && (
          <CalendarScreen
            onSelectDate={(iso) => openTodayFor(iso)} // click a day → jump to Today for that date
          />
        )}

        {tab === "goals" && <GoalsScreen />}

        {tab === "vision" && <VisionBoardScreen />}

        {tab === "gratitude" && <GratitudeScreen />}

        {tab === "wins" && <WinsScreen />}

        {tab === "alfred" && <AlfredScreen />}

        {tab === "confidence" && <ConfidenceScreen />}
      </div>
    </AuthGate>
  );
}

function NavBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid",
        borderColor: active ? "#111" : "#ddd",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
      }}
    >
      {label}
    </button>
  );
}
