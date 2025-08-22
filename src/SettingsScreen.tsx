import ProfileTitleAndPinCard from "./ProfileTitleAndPinCard";

export default function SettingsScreen() {
  return (
    <div className="container" style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Settings</h1>
        <div className="muted">Manage how we address you and your PIN.</div>
      </div>

      <ProfileTitleAndPinCard />
    </div>
  );
}
