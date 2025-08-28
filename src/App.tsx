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

/* Types */
type ProfileRow = {
  id: string;
  display_name: string | null;
  display_pool: string[] | null; // nicknames
  onboarding_done: boolean | null;
};

/* LocalStorage fallback keys (keep in sync with OnboardingScreen) */
const LS_DONE = "byb:onboarding_done";
const LS_NAME = "byb:display_name";
const LS_POOL = "byb:display_pool";

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
  | "focus";

export default function App() {
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
    return () => { try { unsub?.(); } catch {} };
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
      if (error) {
        // No profiles table/row? Fall back to local
        setProfile(null);
      } else {
        setProfile(data as ProfileRow);
      }
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  function onboardingLocalDone(): boolean {
    try {
      return localStorage.getItem(LS_DONE) === "1";
    } catch {
      return false;
    }
  }

  function profileSaysDone(p: ProfileRow | null): boolean {
    return !!p?.onboarding_done;
  }

  function showOnboarding(): boolean {
    // gate: if profile says done, fine
    if (profileSaysDone(profile)) return false;
    // if profile missing or not done, but local says done, proceed (avoid getting stuck)
    if (onboardingLocalDone()) return false;
    // otherwise, still need onboarding
    return true;
  }

  async function handleOnboardingDone() {
    // If user is signed in, refresh their profile (so onboarding_done = true shows up)
    if (userId) await loadProfile(userId);
  }

  /* ----- tabs ----- */
  const tabs = useMemo(
    () =>
      [
        { key: "today",      label: "Today",      icon: "✅" },
        { key: "calendar",   label: "Calendar",   icon: "🗓️" },
        { key: "goals",      label: "Goals",      icon: "🎯" },
        { key: "vision",     label: "Vision",     icon: "🌈" },
        { key: "gratitude",  label: "Gratitude",  icon: "🙏" },
        { key: "exercise",   label: "Exercise",   icon: "🏋️" },
        { key: "wins",       label: "Wins",       icon: "🏆" },
        { key: "alfred",     label: "Alfred",     icon: "🤖" },
        { key: "confidence", label: "Confidence", icon: "🔥" },
        { key: "notes",      label: "Notes",      icon: "📝" },
        { key: "focus",      label: "Focus",      icon: "🎧" },
      ] as const,
    []
  );

  /* ----- render one tab ----- */
  function renderTab() {
    switch (tab) {
      case "today":
        return <TodayScreen externalDateISO={externalDateISO} />;
      case "calendar":
        return <CalendarScreen />;
      case "goals":
        return <GoalsScreen />;
      case "vision":
        return <VisionBoardScreen />;
      case "gratitude":
        return <GratitudeScreen />;
      case "exercise":
        return <ExerciseDiaryScreen />;
      case "wins":
        return <WinsScreen />;
      case "alfred":
        return <AlfredScreen />;
      case "confidence":
        return <ConfidenceScreen />;
      case "notes":
        return <NotesScreen />;
      case "focus":
        return <FocusAlfredScreen />;
      default:
        return <TodayScreen externalDateISO={externalDateISO} />;
    }
  }

  /* ----- app shell ----- */
  return (
    <AuthGate>
      <div className="app" style={{ display: "grid", gap: 12 }}>
        {/* Onboarding gate */}
        {profileLoading ? (
          <div className="card">Loading profile…</div>
        ) : showOnboarding() ? (
          <OnboardingScreen onDone={handleOnboardingDone} />
        ) : (
          <>
            {/* Top bar */}
            <div
              className="card"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 800 }}>BYB</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  onChange={(e) => setExternalDateISO(e.target.value || undefined)}
                />
                <button onClick={() => setExternalDateISO(undefined)}>Today</button>
              </div>
            </div>

            {/* Active tab */}
            <div>{renderTab()}</div>

            {/* Tabs */}
            <div
              className="card"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
                position: "sticky",
                bottom: 0,
                background: "#fff",
                zIndex: 10,
              }}
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  className="tab-btn"
                  data-active={tab === (t.key as Tab)}
                  onClick={() => setTab(t.key as Tab)}
                  title={t.label}
                >
                  <span className="icon" aria-hidden>
                    {t.icon}
                  </span>
                  <span className="label">{t.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <style>{`
        .tab-btn{
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          border: 1px solid var(--border);
          background: #fff; color: var(--text);
          border-radius: 12px; padding: 8px 10px; min-width: 72px;
        }
        .tab-btn .icon{ font-size: 18px; line-height: 1; }
        .tab-btn .label{ font-size: 12px; }
        .tab-btn[data-active="true"]{
          background: hsl(var(--pastel-hsl) / .60);
          border-color: hsl(var(--pastel-hsl) / .75);
          color: var(--primary);
        }
      `}</style>
    </AuthGate>
  );
}
