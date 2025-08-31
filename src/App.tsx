// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import AuthGate from "./AuthGate";
import { supabase } from "./lib/supabaseClient";

/* Screens */
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
import OnboardingScreen from "./OnboardingScreen";
import MeditationScreen from "./meditation"; // <-- matches src/meditation.tsx
import AffirmationBuilder from "./AffirmationBuilder"; // <-- NEW

/* Types */
type ProfileRow = {
  id: string;
  display_name: string | null;
  display_pool: string[] | null; // nicknames
  onboarding_done: boolean | null;
};

/* LocalStorage fallback */
const LS_DONE = "byb:onboarding_done";

/* Tabs */
type Tab =
  | "today"
  | "calendar"
  | "goals"
  | "vision"
  | "gratitude"
  | "exercise"
  | "wins"
  | "alfred"
  | "confidence"
  | "notes"
  | "focus"
  | "meditation"
  | "affirmations"; // <-- NEW

export default function App() {
  // Ensure we start on Today
  const [tab, setTab] = useState<Tab>("today");
  const [externalDateISO, setExternalDateISO] = useState<string | undefined>(undefined);

  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  /* ----- auth ----- */
  useEffect(() => {
    let unsub: (() => void) | null = null;
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setUserId(u?.id ?? null);
      if (u?.id) loadProfile(u.id);
      else setProfileLoading(false);
    });
    const sub = supabase.auth.onAuthStateChange((_evt, sess) => {
      const u = sess?.user || null;
      setUserId(u?.id ?? null);
      if (u?.id) loadProfile(u.id);
      else {
        setProfile(null);
        setProfileLoading(false);
      }
    });
    unsub = () => sub.data.subscription.unsubscribe();
    return () => {
      try { unsub?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile(uid: string) {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,display_pool,onboarding_done")
        .eq("id", uid)
        .limit(1)
        .single();
      if (error) setProfile(null);
      else setProfile(data as ProfileRow);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  function onboardingLocalDone(): boolean {
    try { return localStorage.getItem(LS_DONE) === "1"; } catch { return false; }
  }
  function profileSaysDone(p: ProfileRow | null): boolean { return !!p?.onboarding_done; }
  function showOnboarding(): boolean {
    if (profileSaysDone(profile)) return false;
    if (onboardingLocalDone()) return false;
    return true;
  }
  async function handleOnboardingDone() {
    if (userId) await loadProfile(userId);
  }

  /* ----- tabs ----- */
  const tabs = useMemo(
    () =>
      [
        { key: "today",        label: "Today",         icon: "✅" },
        { key: "calendar",     label: "Calendar",      icon: "🗓️" },
        { key: "goals",        label: "Goals",         icon: "🎯" },
        { key: "vision",       label: "Vision",        icon: "🌈" },
        { key: "gratitude",    label: "Gratitude",     icon: "🙏" },
        { key: "exercise",     label: "Exercise",      icon: "🏋️" },
        { key: "wins",         label: "Wins",          icon: "🏆" },
        { key: "alfred",       label: "Alfred",        icon: "🤖" },
        { key: "confidence",   label: "Confidence",    icon: "🔥" },
        { key: "notes",        label: "Notes",         icon: "📝" },
        { key: "focus",        label: "Focus",         icon: "🎧" },
        { key: "meditation",   label: "Meditation",    icon: "📺" },
        { key: "affirmations", label: "Affirmations",  icon: "✨" }, // <-- NEW
      ] as const,
    []
  );

  function renderTab() {
    switch (tab) {
      case "today":         return <TodayScreen externalDateISO={externalDateISO} />;
      case "calendar":      return <CalendarScreen />;
      case "goals":         return <GoalsScreen />;
      case "vision":        return <VisionBoardScreen />;
      case "gratitude":     return <GratitudeScreen />;
      case "exercise":      return <ExerciseDiaryScreen />;
      case "wins":          return <WinsScreen />;
      case "alfred":        return <AlfredScreen />;
      case "confidence":    return <ConfidenceScreen />;
      case "notes":         return <NotesScreen />;
      case "focus":         return <FocusAlfredScreen />;
      case "meditation":    return <MeditationScreen />;
      case "affirmations":  return <AffirmationBuilder />; // <-- NEW
      default:              return <TodayScreen externalDateISO={externalDateISO} />;
    }
  }

  return (
    <AuthGate>
      <div className="app-shell" style={{ display: "grid", gap: 12 }}>
        {profileLoading ? (
          <div className="card">Loading profile…</div>
        ) : showOnboarding() ? (
          <OnboardingScreen onDone={handleOnboardingDone} />
        ) : (
          <>
            {/* Top header: 2-column grid that stacks on small screens */}
            <div className="card header">
              <div className="brand">BYB</div>
              <div className="header-actions">
                <input
                  type="date"
                  value={externalDateISO ?? ""}
                  onChange={(e) => setExternalDateISO(e.target.value || undefined)}
                />
                <button onClick={() => setExternalDateISO(undefined)}>Today</button>
              </div>
            </div>

            {/* Active tab */}
            <div>{renderTab()}</div>

            {/* Bottom shortcuts — horizontal scroll bar */}
            <nav className="tabbar" aria-label="Primary">
              <div className="tabbar-inner">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    className="tab-btn"
                    data-active={tab === (t.key as Tab)}
                    onClick={() => setTab(t.key as Tab)}
                    title={t.label}
                  >
                    <span className="icon" aria-hidden>{t.icon}</span>
                    <span className="label">{t.label}</span>
                  </button>
                ))}
              </div>
            </nav>
          </>
        )}
      </div>
    </AuthGate>
  );
}
