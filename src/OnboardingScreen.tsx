import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------------------------------------------
   Helpers
----------------------------------------------*/
type FunTitleKey =
  | "first_name" | "king" | "queen" | "prince" | "princess"
  | "bossman" | "bosslady" | "boss" | "sir" | "madam"
  | "dude" | "bro" | "sis" | "champ" | "mlady" | "highness" | "winner";

const TITLE_CHOICES: { key: FunTitleKey; label: string }[] = [
  { key: "first_name", label: "First name" },
  { key: "king", label: "King" },
  { key: "queen", label: "Queen" },
  { key: "prince", label: "Prince" },
  { key: "princess", label: "Princess" },
  { key: "bossman", label: "Bossman" },
  { key: "bosslady", label: "Bosslady" },
  { key: "boss", label: "Boss" },
  { key: "sir", label: "Sir" },
  { key: "madam", label: "Madam" },
  { key: "dude", label: "Dude" },
  { key: "bro", label: "Bro" },
  { key: "sis", label: "Sis" },
  { key: "champ", label: "Champ" },
  { key: "mlady", label: "M'Lady" },
  { key: "highness", label: "Your Highness" },
  { key: "winner", label: "Winner" },
];

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoFromYMD(y?: number, m?: number, d?: number) {
  if (!y || !m || !d) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
}
function isLeap(y: number) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function daysInMonth(y: number, m: number) {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4,6,9,11].includes(m) ? 30 : 31;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------------------------------------
   Component
----------------------------------------------*/
export default function OnboardingScreen({ onDone }: { onDone?: () => void }) {
  const [userId, setUserId] = useState<string | null>(null);

  // Basic fields
  const [firstName, setFirstName] = useState("");
  const [titleChoice, setTitleChoice] = useState<FunTitleKey>("first_name");
  const displayNamePreview = titleChoice === "first_name"
    ? (firstName || "…")
    : (TITLE_CHOICES.find(t => t.key === titleChoice)?.label ?? "…");

  // DOB (dropdowns)
  const now = new Date();
  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear(); y >= 1900; y--) arr.push(y);
    return arr;
  }, [now]);
  const months = [
    { n: 1, label: "January" }, { n: 2, label: "February" }, { n: 3, label: "March" },
    { n: 4, label: "April" }, { n: 5, label: "May" }, { n: 6, label: "June" },
    { n: 7, label: "July" }, { n: 8, label: "August" }, { n: 9, label: "September" },
    { n: 10, label: "October" }, { n: 11, label: "November" }, { n: 12, label: "December" },
  ];
  const [dobYear, setDobYear] = useState<number | undefined>(undefined);
  const [dobMonth, setDobMonth] = useState<number | undefined>(undefined);
  const [dobDay, setDobDay] = useState<number | undefined>(undefined);
  const days = useMemo(() => {
    if (!dobYear || !dobMonth) return [];
    const n = daysInMonth(dobYear, dobMonth);
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [dobYear, dobMonth]);
  useEffect(() => {
    // clamp day if month/year changed to fewer days
    if (dobDay && dobYear && dobMonth) {
      const max = daysInMonth(dobYear, dobMonth);
      if (dobDay > max) setDobDay(max);
    }
  }, [dobYear, dobMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Options (kept lightweight to avoid schema mismatches)
  const [openMore, setOpenMore] = useState(false);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [reduceMotion, setReduceMotion] = useState(false);

  // PIN
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  function pinLooksValid(p: string) { return /^\d{4}$/.test(p); }

  async function upsertProfile(payload: Record<string, any>) {
    // Robust upsert: try once; if we hit a "column ... does not exist" error,
    // strip that key and retry exactly once. This avoids crashes when the DB
    // schema hasn’t caught up yet (e.g., 'pronouns' column missing).
    const tryOnce = async (pl: Record<string, any>) => {
      const { error } = await supabase.from("profiles").upsert(pl, { onConflict: "id" });
      return error;
    };

    let error = await tryOnce(payload);
    if (error && /column .* does not exist/i.test(error.message)) {
      // extract offending column name if present
      const m = error.message.match(/column\s+"?([a-z0-9_]+)"?\s+does not exist/i);
      if (m?.[1]) {
        const bad = m[1];
        const copy = { ...payload };
        delete copy[bad as keyof typeof copy];
        error = await tryOnce(copy);
      }
    }
    if (error) throw error;
  }

  async function saveAll(skip: boolean = false) {
    if (!userId) return;
    setSaving(true);
    setErr(null);
    try {
      const displayName =
        titleChoice === "first_name"
          ? (firstName.trim() || null)
          : (TITLE_CHOICES.find(t => t.key === titleChoice)?.label ?? null);

      const profile: Record<string, any> = {
        id: userId,
        first_name: firstName.trim() || null,
        title_choice: titleChoice,
        display_name: displayName,
        dob: isoFromYMD(dobYear, dobMonth, dobDay) || null,
        reminder_time: reminderTime,
        theme,
        reduce_motion: reduceMotion,
      };

      if (pinEnabled) {
        if (!pinLooksValid(pin1) || pin1 !== pin2) {
          throw new Error("Please enter and confirm a 4-digit PIN.");
        }
        const hash = await sha256Hex(`${userId}:${pin1}`);
        profile.pin_enabled = true;
        profile.pin_hash = hash;
        profile.pin_updated_at = new Date().toISOString();
      } else {
        profile.pin_enabled = false;
        profile.pin_hash = null;
        profile.pin_updated_at = new Date().toISOString();
      }

      await upsertProfile(profile);

      if (onDone) onDone();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const dobIsoPreview = isoFromYMD(dobYear, dobMonth, dobDay);

  return (
    <div className="container" style={{ maxWidth: 740, margin: "0 auto" }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>Welcome 👋</h1>
          <a href="/auth/signout" style={{ marginLeft: "auto" }}>Sign out</a>
        </div>
        <div className="muted">A few details and you’re in. You can change these anytime in Settings.</div>

        {/* Basics */}
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div className="section-title">First name</div>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g., Harriet"
            />
          </label>

          <div style={{ display: "grid", gap: 8 }}>
            <div className="section-title">How should we address you?</div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  name="addr"
                  checked={titleChoice === "first_name"}
                  onChange={() => setTitleChoice("first_name")}
                />
                First name
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  name="addr"
                  checked={titleChoice !== "first_name"}
                  onChange={() => setTitleChoice("champ")}
                />
                Pick from fun titles
              </label>
            </div>

            {titleChoice !== "first_name" && (
              <select
                value={titleChoice}
                onChange={(e) => setTitleChoice(e.target.value as FunTitleKey)}
              >
                {TITLE_CHOICES.filter(t => t.key !== "first_name").map(opt => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            )}

            <div className="muted">
              We’ll greet you as: <b>{displayNamePreview || "…"}</b>
            </div>
          </div>

          {/* DOB with dropdowns */}
          <div style={{ display: "grid", gap: 6 }}>
            <div className="section-title">Date of birth</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={dobMonth ?? ""} onChange={(e) => setDobMonth(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Month</option>
                {months.map(m => <option key={m.n} value={m.n}>{m.label}</option>)}
              </select>
              <select value={dobDay ?? ""} onChange={(e) => setDobDay(e.target.value ? Number(e.target.value) : undefined)} disabled={!dobMonth || !dobYear}>
                <option value="">Day</option>
                {days.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={dobYear ?? ""} onChange={(e) => setDobYear(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Year</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {dobIsoPreview && <div className="muted">Saved as: {dobIsoPreview}</div>}
          </div>
        </div>

        {/* More options */}
        <button
          className="btn-soft"
          onClick={() => setOpenMore(o => !o)}
          aria-expanded={openMore}
          style={{ borderRadius: 8, alignSelf: "start" }}
        >
          {openMore ? "Hide options" : "More options"}
        </button>

        {openMore && (
          <div className="card" style={{ display: "grid", gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Optional preferences</h2>

            {/* PIN */}
            <div className="card" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>4-digit PIN (optional)</h3>
                <label style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={pinEnabled} onChange={(e) => setPinEnabled(e.target.checked)} />
                  Require PIN on app open
                </label>
              </div>
              {pinEnabled && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    pattern="\d{4}"
                    placeholder="Enter PIN"
                    value={pin1}
                    onChange={(e) => setPin1(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    style={{ width: 140 }}
                  />
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    pattern="\d{4}"
                    placeholder="Confirm PIN"
                    value={pin2}
                    onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    style={{ width: 160 }}
                  />
                </div>
              )}
              <div className="muted">
                If you forget your PIN, tap “Forgot PIN?” on the lock screen to sign out and sign back in.
              </div>
            </div>

            {/* A couple of safe prefs */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Daily reminder
                <input type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Theme
                <select value={theme} onChange={(e) => setTheme(e.target.value as any)}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} />
                Reduce motion
              </label>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={() => saveAll(true)} disabled={saving}>Skip for now</button>
          <button
            className="btn-primary"
            onClick={() => saveAll(false)}
            disabled={saving}
            style={{ borderRadius: 10 }}
          >
            {saving ? "Saving…" : "Finish"}
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div className="muted" style={{ textAlign: "center" }}>
          You can change your greeting titles or PIN anytime in Settings → Profile.
        </div>
      </div>
    </div>
  );
}
