import { useState } from "react";
import AuthGate from "./AuthGate";
import TodayScreen from "./TodayScreen";
import GoalsScreen from "./GoalsScreen";
import CalendarScreen from "./CalendarScreen";
import AlfredScreen from "./AlfredScreen";
import VisionBoardScreen from "./VisionBoardScreen";
import GratitudeScreen from "./GratitudeScreen";

type Tab = "today" | "goals" | "calendar" | "vision" | "alfred" | "gratitude";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [selectedDateISO, setSelectedDateISO] = useState<string>(todayISO());

  function gotoToday() {
    setSelectedDateISO(todayISO());
    setTab("today");
  }

  return (
    <AuthGate>
      {/* Top bar */}
      <div className="topbar">
        <div
          className="container"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 10,
            paddingBottom: 10,
          }}
        >
          <div className="brand">
            <span className="logo" />
            Best You Blueprint
          </div>
          <nav className="tabs">
            <button className="tab" aria-current={tab === "today" ? "page" : undefined} onClick={gotoToday}>Today</button>
            <button className="tab" aria-current={tab === "goals" ? "page" : undefined} onClick={() => setTab("goals")}>Goals</button>
            <button className="tab" aria-current={tab === "calendar" ? "page" : undefined} onClick={() => setTab("calendar")}>Calendar</button>
            <button className="tab" aria-current={tab === "vision" ? "page" : undefined} onClick={() => setTab("vision")}>Vision</button>
            <button className="tab" aria-current={tab === "alfred" ? "page" : undefined} onClick={() => setTab("alfred")}>Alfred</button>
            <button className="tab" aria-current={tab === "gratitude" ? "page" : undefined} onClick={() => setTab("gratitude")}>Gratitude</button>
          </nav>
        </div>
      </div>

      {/* Screen container */}
      <div className="container" style={{ paddingTop: 16 }}>
        {tab === "today" && <TodayScreen externalDateISO={selectedDateISO} />}

        {tab === "goals" && <GoalsScreen />}

        {tab === "calendar" && (
          <CalendarScreen
            onSelectDate={(iso) => {
              setSelectedDateISO(iso);
              setTab("today");
            }}
          />
        )}

        {tab === "vision" && <VisionBoardScreen />}

        {tab === "alfred" && <AlfredScreen />}

        {tab === "gratitude" && <GratitudeScreen />}
      </div>
    </AuthGate>
  );
}
