import { useState } from "react";
import AuthGate from "./AuthGate";
import TodayScreen from "./TodayScreen";
import GoalsScreen from "./GoalsScreen";
import CalendarScreen from "./CalendarScreen";

type Tab = "today" | "goals" | "calendar";

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
    setSelectedDateISO(todayISO()); // always reset to actual today
    setTab("today");
  }

  return (
    <AuthGate>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 12 }}>
        {/* Top nav */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={gotoToday}
            style={{
              padding: "8px 12px",
              border: "1px solid #333",
              borderRadius: 8,
              background: tab === "today" ? "#f5f5f5" : "#fff",
            }}
          >
            Today
          </button>
          <button
            onClick={() => setTab("goals")}
            style={{
              padding: "8px 12px",
              border: "1px solid #333",
              borderRadius: 8,
              background: tab === "goals" ? "#f5f5f5" : "#fff",
            }}
          >
            Goals
          </button>
          <button
            onClick={() => setTab("calendar")}
            style={{
              padding: "8px 12px",
              border: "1px solid #333",
              borderRadius: 8,
              background: tab === "calendar" ? "#f5f5f5" : "#fff",
            }}
          >
            Calendar
          </button>
        </div>

        {/* Screens */}
        {tab === "today" && <TodayScreen externalDateISO={selectedDateISO} />}

        {tab === "goals" && <GoalsScreen />}

        {tab === "calendar" && (
          <CalendarScreen
            onSelectDate={(iso) => {
              // Selecting a date (or the Calendar's "Today" button) jumps to Day view at that date
              setSelectedDateISO(iso);
              setTab("today");
            }}
          />
        )}
      </div>
    </AuthGate>
  );
}
