// src/App.tsx
import { useEffect, useRef, useState } from "react";
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
import MeditationScreen from "./meditation";
import MotivationScreen from "./motivation";   // ⬅️ NEW
import AffirmationBuilder from "./AffirmationBuilder";
import MenuScreen from "./MenuScreen";

/* Types */
type ProfileRow = {
  id: string;
  display_name: string | null;
  display_pool: string[] | null;
  onboarding_done: boolean | null;
};

const LS_DONE = "byb:onboarding_done";

/* Tabs (route keys) */
type Tab =
  | "today" | "menu" | "calendar" | "goals" | "vision" | "gratitude"
  | "exercise" | "wins" | "alfred" | "confidence" | "notes"
  | "focus" | "meditation" | "motivation" | "affirmations"; // ⬅️ added "motivation"

/* Helpers */
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

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
      try {
        unsub?.();
      } catch {}
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
    if (profileSaysDone(profile)) return false;
    if (onboardingLocalDone()) return false;
    return true;
  }
  async function handleOnboardingDone() {
    if (userId) await loadProfile(userId);
  }

  /* ----- routing ----- */
  function renderTab() {
    switch (tab) {
      case "today":
        return <TodayScreen externalDateISO={externalDateISO} />;
      case "menu":
        return <MenuScreen onOpenTab={(k) => setTab(k as Tab)} />;
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
      case "meditation":
        return <MeditationScreen />;
      case "motivation":                      {/* ⬅️ NEW route */}
        return <MotivationScreen />;
      case "affirmations":
        return <AffirmationBuilder />;
      default:
        return <TodayScreen externalDateISO={externalDateISO} />;
    }
  }

  // Optional: keep a hidden date input for other screens that might read externalDateISO later.
  const dateInputRef = useRef<HTMLInputElement>(null);
  const selectedISO = externalDateISO ?? todayISO();

  return (
    <AuthGate>
      {/* Top bar — left-aligned banner, opens the Menu */}
      <header
        role="button"
        aria-label="Open menu"
        onClick={() => setTab("menu")}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setTab("menu");
        }}
        style={{
          position: "sticky",
          top: "env(safe-area-inset-top, 0)",
          zIndex: 1000,
          background: "#D7F0FA",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          cursor: "pointer",
        }}
      >
        <img
          src="/BannerMenu"
          alt="Best You Blueprint"
          style={{
            height: 56,
            width: "auto",
            objectFit: "contain",
            borderRadius: 6,
            flex: "0 0 auto",
          }}
        />
      </header>

      {/* Hidden date input (kept for future use; not visible) */}
      <input
        ref={dateInputRef}
        type="date"
        value={selectedISO}
        onChange={(e) => setExternalDateISO(e.target.value || undefined)}
        style={{
          position: "absolute",
          opacity: 0,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
        aria-hidden
      />

      {/* App body */}
      <div
        className="app-shell"
        style={{
          display: "grid",
          gap: 12,
          padding: "12px",
          paddingTop: 12,
          paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0))",
        }}
      >
        {profileLoading ? (
          <div className="card">Loading profile…</div>
        ) : showOnboarding() ? (
          <OnboardingScreen onDone={handleOnboardingDone} />
        ) : (
          <div>{renderTab()}</div>
        )}
      </div>
    </AuthGate>
  );
}
