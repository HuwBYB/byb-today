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
import AffirmationBuilder from "./AffirmationBuilder";
import MenuScreen from "./MenuScreen"; // <-- NEW

/* Types */
type ProfileRow = {
  id: string;
  display_name: string | null;
  display_pool: string[] | null; // nicknames
  onboarding_done: boolean | null;
};

/* LocalStorage fallback */
const LS_DONE = "byb:onboarding_done";

/* Tabs (route keys) */
type Tab =
  | "today"
  | "menu"
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
  | "affirmations";

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

  /* ----- bottom bar (no slider) ----- */
  const bottomTabs = useMemo(
    () =>
      [
        { key: "today", label: "Today", icon: "✅" },
        { key: "menu",  label: "Menu",  icon: "🧭" },
      ] as const,
    []
  );

  /* ----- routing ----- */
  function renderTab() {
    switch (tab) {
      case "today":        return <TodayScreen externalDateISO={externalDateISO} />;
      case "menu":         return <MenuScreen onOpenTab={(k) => setTab(k as Tab)} />;
      case "calendar":     return <CalendarScreen />;
      case "goals":        return <GoalsScreen />;
      case "vision":       return <VisionBoardScreen />;
      case "gratitude":    return <GratitudeScreen />;
      case "exercise":     return <ExerciseDiaryScreen />;
      case "wins":         return <WinsScreen />;
      case "alfred":       return <AlfredScreen />;
      case "confidence":   return <ConfidenceScreen />;
      case "notes":        return <NotesScreen />;
      case "focus":        return <FocusAlfredScreen />;
      case "meditation":   return <MeditationScreen />;
      case "affirmations": return <AffirmationBuilder />;
      default:             return <TodayScreen externalDateISO={externalDateISO} />;
    }
  }

  return (
    <AuthGate>
      <div
        className="app-shell"
        style={{
          display: "grid",
          gap: 12,
          // keep content above the fixed bottom nav
          paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0))",
        }}
      >
        {profileLoading ? (
          <div className="card">Loading profile…</div>
        ) : showOnboarding() ? (
          <OnboardingScreen onDone={handleOnboardingDone} />
        ) : (
          <>
            {/* Top header */}
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

            {/* Active route */}
            <div>{renderTab()}</div>

            {/* Bottom bar (two buttons, fixed to viewport bottom) */}
            <nav
              className="tabbar"
              aria-label="Primary"
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
                background: "var(--bg)",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div
                className="tabbar-inner"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  padding: "8px 8px calc(8px + env(safe-area-inset-bottom,0))",
                  maxWidth: "100vw",
                }}
              >
                {bottomTabs.map((t) => (
                  <button
                    key={t.key}
                    className="tab-btn btn-soft"
                    data-active={tab === (t.key as Tab)}
                    onClick={() => setTab(t.key as Tab)}
                    title={t.label}
                    style={{
                      borderRadius: 999,
                      padding: "10px 14px",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: tab === (t.key as Tab) ? 700 : 500,
                    }}
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
