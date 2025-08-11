import AuthGate from "./AuthGate";
import TodayScreen from "./TodayScreen";

export default function App() {
  return (
    <AuthGate>
      <TodayScreen />
    </AuthGate>
  );
}
