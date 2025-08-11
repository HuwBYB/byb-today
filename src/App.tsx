import { useState } from "react";
import AuthGate from "./AuthGate";
import TodayScreen from "./TodayScreen";
import CalendarScreen from "./CalendarScreen";

export default function App() {
  const [tab, setTab] = useState<"today" | "calendar">("today");

  return (
    <AuthGate>
      <div style={{ padding: 12, borderBottom: "1px solid #eee", display: "flex", gap: 8 }}>
        <button onClick={() => setTab("today")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: tab === "today" ? "#f5f5f5" : "#fff" }}>
          Today
        </button>
        <button onClick={() => setTab("calendar")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: tab === "calendar" ? "#f5f5f5" : "#fff" }}>
          Calendar
        </button>
      </div>
      {tab === "today" ? <TodayScreen /> : <CalendarScreen />}
    </AuthGate>
  );
}
