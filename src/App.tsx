// App.tsx
import { useEffect, useMemo, useState } from "react";
import AuthGate from "./AuthGate";
import { supabase } from "./lib/supabaseClient";

/* Existing screens */
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

/* New screens */
import OnboardingScreen from "./OnboardingScreen";
import SettingsScreen from "./SettingsScreen";

/* Overlay gate */
import PINGate from "./PINGate";

/* ---------- local onboarding flag so we never get stuck ---------- */
const ONBOARD_KEY = "byb:onboarded:v1";

type Tab =
  | "today"
  | "calendar"
  | "goals"
  | "vision"
  | "gratitude"
  | "exercise"
  | "notes"
  | "wins"
  | "alfred"
  | "focus"
  | "confidence"
  | "settings";

type ProfileRow = {
  id: string;
  display_name: string | null;
  title: string | null;
  dob: string | null;
  onboarded_at: string | null; // if null => hasn’t finished onboarding
  pin_enabled?: boolean | null;
  pin_hash?: string | null;
};

export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [externalDateISO, setExternalDateISO] = useState<string | undefined>(undefined);

  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const tabs = useMemo(
    () =>
      [
        { key: "today",      label: "Today",      icon: "✅" },
        { key: "calendar",   label: "Calendar",   icon: "🗓️" },
        { key: "goals",      label: "Goals",      icon: "🎯" },
        { key: "vision",     label: "Vision",     icon: "🖼️" },
        { key: "gratitude",  label: "Gratitude",  icon: "🙏" },
        { key: "exercise",   label: "Exercise",   icon: "🏋️" },
        { key: "notes",      label: "Notes",      icon: "📝" },
        { key: "wins",       label: "Successes",  icon: "🏆" },
        { key: "alfred",     label: "Alfred",     icon: "🤖" },
        { key: "focus",      label: "Focus",      icon: "⏱️" },
        { key: "confidence", label: "Confidence", icon: "⚡" },
        { key: "settings",   label: "Settings",   icon: "⚙️" },
      ] as Array<{ key: Tab; label: string; icon: string }>,
    []
  );

  function openTodayFor(iso: string) {
    setExternalDateISO(iso);
    setTab("today");
  }

  /* -------- Load/ensure profile -------- */
  useEffect(() => {
    let cancelled = false;

    async function ensureProfile() {
      setProfileLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      if (cancelled) return;

      setUserId(uid);
      if (!uid) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const { data: row, error } = await supabase
        .from("profiles")
        .select("id,display_name,title,dob,onboarded_at,pin_enabled,pin_hash")
        .eq("id", uid)
        .single();

      if (cancelled) return;

      if (row) {
        setProfile(row as ProfileRow);
      } else {
        // Create a stub row if missing, then refetch once.
        if (error?.code === "PGRST116" || error?.message?.toLowerCase().includes("row not found")) {
          await supabase.from("profiles").insert({
            id: uid,
            display_name: null,
            title: null,
            dob: null,
            onboarded_at: null,
          } as any);
          const { data: row2 } = await supabase
            .from("profiles")
            .select("id,display_name,title,dob,onboarded_at,pin_enabled,pin_hash")
            .eq("id", uid)
            .single();
          setProfile((row2 || null) as any);
        }
      }
      setProfileLoading(false);
    }

    ensureProfile();
    return () => { cancelled = true; };
  }, []);

  async function refreshProfile() {
    if (!userId) return;
    const { data } = await supabase
      .from("profiles")
      .select("id,display_name,title,dob,onboarded_at,pin_enabled,pin_hash")
      .eq("id", userId)
      .single();
    setProfile((data || null) as any);
  }

  /* -------- Onboarding guard -------- */
  const onboardedLocal = (typeof window !== "undefined") && localStorage.getItem(ONBOARD_KEY) === "1";
  const needsOnboarding = !!userId && !profileLoading && !profile?.onboarded_at && !onboardedLocal;

  return (
    <AuthGate>
      {/* PIN lock overlay always available */}
      <PINGate />

      <style>{CSS_APP}</style>

      {needsOnboarding ? (
        <div className="app-shell">
          <div className="container" style={{ display: "grid", gap: 12 }}>
            {/* Onboarding: when done, set local flag and refresh DB profile */}
            <OnboardingScreen
              onDone={async () => {
                localStorage.setItem(ONBOARD_KEY, "1");
                await refreshProfile();
              }}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Desktop header */}
          <div className="only-desktop">
            <div className="container" style={{ padding: 12 }}>
              <div
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <strong>Best You Blueprint</strong>
                  <span className="muted">• build your ideal day</span>
                </div>
                <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => {
                        if (t.key === "today") setExternalDateISO(undefined);
                        setTab(t.key);
                      }}
                      className={tab === t.key ? "btn-primary" : ""}
                      style={{ borderRadius: 10 }}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="app-shell">
            <div className="container" style={{ display: "grid", gap: 12 }}>
              {tab === "today" && <TodayScreen externalDateISO={externalDateISO} />}

              {tab === "calendar" && (
                <CalendarScreen onSelectDate={(iso) => openTodayFor(iso)} />
              )}

              {tab === "goals" && <GoalsScreen />}
              {tab === "vision" && <VisionBoardScreen />}
              {tab === "gratitude" && <GratitudeScreen />}
              {tab === "exercise" && <ExerciseDiaryScreen />}
              {tab === "notes" && <NotesScreen />}
              {tab === "wins" && <WinsScreen />}
              {tab === "alfred" && <AlfredScreen />}
              {tab === "focus" && <FocusAlfredScreen />}
              {tab === "confidence" && <ConfidenceScreen />}
              {tab === "settings" && <SettingsScreen />}
            </div>
          </div>

          {/* Mobile tabs */}
          <MobileTabbar
            active={tab}
            setActive={(t) => {
              if (t === "today") setExternalDateISO(undefined);
              setTab(t);
            }}
            tabs={tabs}
          />
        </>
      )}
    </AuthGate>
  );
}

function MobileTabbar({
  active,
  setActive,
  tabs,
}: {
  active: Tab;
  setActive: (t: Tab) => void;
  tabs: Array<{ key: Tab; label: string; icon: string }>;
}) {
  return (
    <div className="tabbar" role="navigation" aria-label="Bottom tabs">
      <div className="container">
        <div className="tabbar-inner">
          {tabs.map((t) => (
            <button
              key={t.key}
              className="tab-btn"
              data-active={active === t.key}
              onClick={() => setActive(t.key)}
              title={t.label}
            >
              <div className="icon" aria-hidden>{t.icon}</div>
              <div className="label">{t.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- Local CSS for correct mobile layout & bottom nav --- */
const CSS_APP = `
.only-desktop { display: block; }
@media (max-width: 900px){ .only-desktop { display: none; } }
.app-shell { padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
.tabbar{
  position: fixed; left: 0; right: 0; bottom: 0;
  background: rgba(255,255,255,.85);
  backdrop-filter: saturate(1.2) blur(8px);
  border-top: 1px solid var(--border);
  z-index: 40;
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 900px){ .tabbar { display: none; } }
.tabbar-inner{ display: flex; justify-content: space-around; gap: 8px; }
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
`;
