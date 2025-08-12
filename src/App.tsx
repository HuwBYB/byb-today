import { useState } from "react";
import AuthGate from "./AuthGate";
import TodayScreen from "./TodayScreen";
import CalendarScreen from "./CalendarScreen";
import GoalsScreen from "./GoalsScreen";

export default function App() {
  const [tab, setTab] = useState<"today" | "calendar" | "goals">("today");
  const [selectedDateISO, setSelectedDateISO] = useState<string | null>(null);

  return (
    <AuthGate>
      <div style={{ padding: 12, borderBottom: "1px solid #eee", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setTab("today")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: tab === "today" ? "#f5f5f5" : "#fff" }}>
          Today
        </button>
        <button onClick={() => setTab("calendar")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: tab === "calendar" ? "#f5f5f5" : "#fff" }}>
          Calendar
        </button>
        <button onClick={() => setTab("goals")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: tab === "goals" ? "#f5f5f5" : "#fff" }}>
          Goals
        </button>
      </div>

      {tab === "today" ? (
        <TodayScreen externalDateISO={selectedDateISO ?? undefined} />
      ) : tab === "calendar" ? (
        <CalendarScreen
          onSelectDate={(iso) => {
            setSelectedDateISO(iso);
            setTab("today");
          }}
        />
      ) : (
        <GoalsScreen />
      )}
    </AuthGate>
  );
}
