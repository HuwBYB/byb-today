import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* -------------------------------------------------------
   Local flag so the app can proceed immediately after save
------------------------------------------------------- */
const ONBOARD_KEY = "byb:onboarded:v1";

/* -------------------------------------------------------
   Titles (multi-pick supported for fun titles)
------------------------------------------------------- */
const FUN_TITLES = [
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
] as const;

type FunKey = typeof FUN_TITLES[number]["key"];

type DateRow = {
  title: string;
  kind: "birthday" | "anniversary" | "custom";
  date: string;         // YYYY-MM-DD
  recur: "annually";
  person?: string | null;
};

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

/* Month/day/year segmented picker helpers */
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export default function OnboardingScreen({ onDone }: { onDone?: () => void }) {
  const [authLoaded, setAuthLoaded] = useState(false);

  // Basic
  const [firstName, setFirstName] = useState("");
  const [addressMode, setAddressMode] = useState<"first" | "fun">("first");
  const [pickedFun, setPickedFun] = useState<FunKey[]>([]);

  // DOB (segmented)
  const now = new Date();
  const [dobMonth, setDobMonth] = useState<number | "">("");
  const [dobDay, setDobDay] = useState<number | "">("");
  const [dobYear, setDobYear] = useState<number | "">(now.getFullYear());

  // Optional
  const [openMore, setOpenMore] = useState(false);
  const [tz, setTz] = useState("");
  const [startOfWeek, setStartOfWeek] = useState<"monday" | "sunday">("monday");
  const [pronouns, setPronouns] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [reduceMotion, setReduceMotion] = useState(false);

  // Important dates
  const [dates, setDates] = useState<DateRow[]>([
    { title: "", kind: "birthday", date: "", recur: "annually", person: "" },
  ]);

  // PIN (optional)
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(() => {
      setAuthLoaded(true);
    });
    try {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (guess) setTz(guess);
    } catch {
      // ignore
    }
  }, []);

  const dobISO = useMemo(() => {
    if (dobYear && dobMonth !== "" && dobDay !== "") {
      const mm = String((dobMonth as number) + 1).padStart(2, "0");
      const dd = String(dobDay as number).padStart(2, "0");
      return `${dobYear}-${mm}-${dd}`;
    }
    return "";
  }, [dobYear, dobMonth, dobDay]);

  const displayNamePreview = addressMode === "first"
    ? (firstName || "…")
    : (pickedFun.length
        ? FUN_TITLES.find(t => t.key === pickedFun[0])?.label || "…"
        : "…");

  function toggleFun(key: FunKey) {
    setPickedFun(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function addDateRow() {
    setDates((d) => [...d, { title: "", kind: "custom", date: "", recur: "annually", person: "" }]);
  }
  function updateDateRow(i: number, patch: Partial<DateRow>) {
    setDates((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeDateRow(i: number) {
    setDates((rows) => rows.filter((_, idx) => idx !== i));
  }

  function pinLooksValid(pin: string) {
    return /^\d{4}$/.test(pin);
  }

  async function saveAll(skip: boolean = false) {
    setSaving(true);
    setErr(null);
    try {
      // Ensure we have a fresh user in case auth state changed
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      if (!uid) throw new Error("You’re not signed in yet. Please wait a moment and try again.");

      // Compute display preference
      const display_name = addressMode === "first" ? (firstName.trim() || null) : null;

      // Profile payload — includes onboarded_at timestamp used by App.tsx
      const profilePayload: any = {
        id: uid,
        first_name: firstName.trim() || null,
        display_name,                   // shown name if using first name
        title_choice: addressMode,      // "first" or "fun"
        greeting_titles: addressMode === "fun" ? pickedFun : [], // JSONB array
        dob: dobISO || null,
        pronouns: pronouns.trim() || null,
        tz,
        start_of_week: startOfWeek,
        reminder_time: reminderTime,
        theme,
        reduce_motion: reduceMotion,
        onboarded_at: new Date().toISOString(), // <-- what the gate reads
      };

      // Add PIN fields
      if (pinEnabled) {
        if (!pinLooksValid(pin1) || pin1 !== pin2) {
          throw new Error("Please enter and confirm a 4-digit PIN.");
        }
        const hash = await sha256Hex(`${uid}:${pin1}`);
        profilePayload.pin_enabled = true;
        profilePayload.pin_hash = hash;
        profilePayload.pin_updated_at = new Date().toISOString();
      } else {
        profilePayload.pin_enabled = false;
        profilePayload.pin_hash = null;
        profilePayload.pin_updated_at = new Date().toISOString();
      }

      // Upsert profile
      const { error: pe } = await supabase.from("profiles").upsert(profilePayload);
      if (pe) throw pe;

      if (!skip) {
        // insert important dates (ignore blank rows)
        const rows = dates
          .filter((r) => r.title.trim() && r.date)
          .map((r) => ({
            user_id: uid,
            title: r.title.trim(),
            kind: r.kind,
            date: r.date,
            recur: r.recur,
            person: (r.person || "") || null,
          }));
        if (rows.length) {
          const { error: de } = await supabase.from("important_dates").insert(rows as any);
          if (de) throw de;
        }
      }

      // mark onboarding complete locally (so App can proceed immediately)
      localStorage.setItem(ONBOARD_KEY, "1");

      if (onDone) onDone();
      else setTimeout(() => window.location.replace("/"), 0);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  // Years list: 120 back from current year
  const years = useMemo(() => {
    const y = now.getFullYear();
    return Array.from({ length: 120 }, (_, i) => y - i);
  }, [now]);

  const dim = (dobMonth === "" || dobYear === "") ? 31 : daysInMonth(Number(dobYear), Number(dobMonth));

  return (
    <div className="container" style={{ maxWidth: 740, margin: "0 auto" }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>Welcome 👋</h1>
          <a href="/api/auth/signout" style={{ marginLeft: "auto" }}>Sign out</a>
        </div>
        <div className="muted">A few details and you’re in. You can change these anytime in Settings.</div>

        {/* Basic card */}
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
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <input
                  type="radio"
                  checked={addressMode === "first"}
                  onChange={() => setAddressMode("first")}
                />
                First name
              </label>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <input
                  type="radio"
                  checked={addressMode === "fun"}
                  onChange={() => setAddressMode("fun")}
                />
                Pick from fun titles
              </label>
            </div>

            {addressMode === "fun" && (
              <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {FUN_TITLES.map(t => {
                  const active = pickedFun.includes(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => toggleFun(t.key)}
                      aria-pressed={active}
                      className="btn-soft"
                      style={{
                        borderRadius: 999,
                        border: "1px solid",
                        borderColor: active ? "hsl(var(--pastel-hsl))" : "#e5e7eb",
                        background: active ? "hsl(var(--pastel-hsl) / .45)" : "#fff",
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="muted">
              We’ll greet you as: <b>{displayNamePreview}</b>
              {addressMode === "fun" && pickedFun.length > 1 ? " (we’ll pick one at random)" : ""}
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div className="section-title">Date of birth</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                value={dobMonth === "" ? "" : String(dobMonth)}
                onChange={(e) => setDobMonth(e.target.value === "" ? "" : Number(e.target.value))}
                style={{ minWidth: 140 }}
              >
                <option value="">Month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <select
                value={dobDay === "" ? "" : String(dobDay)}
                onChange={(e) => setDobDay(e.target.value === "" ? "" : Number(e.target.value))}
                style={{ minWidth: 100 }}
              >
                <option value="">Day</option>
                {Array.from({ length: dim }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select
                value={String(dobYear)}
                onChange={(e) => setDobYear(Number(e.target.value))}
                style={{ minWidth: 120 }}
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {dobISO && <div className="muted">Saved as: {dobISO}</div>}
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
            {/* PIN */}
            <div className="card" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>4-digit PIN (optional)</h3>
                <label style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={pinEnabled} onChange={(e) => setPinEnabled(e.target.checked)} />
                  Enable PIN on app open
                </label>
              </div>
              {pinEnabled && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    pattern="\\d{4}"
                    placeholder="Enter PIN"
                    value={pin1}
                    onChange={(e) => setPin1(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    style={{ width: 140 }}
                  />
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    pattern="\\d{4}"
                    placeholder="Confirm PIN"
                    value={pin2}
                    onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    style={{ width: 160 }}
                  />
                </div>
              )}
              <div className="muted">
                If you forget your PIN, tap “Forgot PIN?” on the lock screen to sign out and sign back in—then set a new PIN.
              </div>
            </div>

            {/* Important dates */}
            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title">Important dates (auto-add to Calendar)</div>
              <div className="muted">Birthdays, anniversaries, or anything to remember annually.</div>

              <div style={{ display: "grid", gap: 10 }}>
                {dates.map((r, i) => (
                  <div key={i} className="card" style={{ display: "grid", gap: 8, padding: 12, border: "1px dashed var(--border)" }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <div className="section-title">Title</div>
                      <input
                        value={r.title}
                        onChange={(e) => updateDateRow(i, { title: e.target.value })}
                        placeholder="e.g., Mum’s birthday"
                      />
                    </label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        Type
                        <select
                          value={r.kind}
                          onChange={(e) => updateDateRow(i, { kind: e.target.value as DateRow["kind"] })}
                        >
                          <option value="birthday">Birthday</option>
                          <option value="anniversary">Anniversary</option>
                          <option value="custom">Custom</option>
                        </select>
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        Date
                        <input
                          type="date"
                          value={r.date}
                          onChange={(e) => updateDateRow(i, { date: e.target.value })}
                        />
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        Person (optional)
                        <input
                          value={r.person || ""}
                          onChange={(e) => updateDateRow(i, { person: e.target.value })}
                          placeholder="e.g., Mum"
                          style={{ width: 160 }}
                        />
                      </label>
                      <span className="badge" title="Recur">Annually</span>
                      <button className="btn-ghost" onClick={() => removeDateRow(i)} title="Remove">Remove</button>
                    </div>
                  </div>
                ))}
                <button onClick={addDateRow}>+ Add another date</button>
              </div>
            </div>

            {/* Preferences */}
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Time zone
                  <input value={tz} onChange={(e) => setTz(e.target.value)} style={{ width: 220 }} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Start of week
                  <select
                    value={startOfWeek}
                    onChange={(e) => setStartOfWeek(e.target.value as "monday" | "sunday")}
                  >
                    <option value="monday">Monday</option>
                    <option value="sunday">Sunday</option>
                  </select>
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Daily reminder
                  <input
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                  />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Theme
                  <select value={theme} onChange={(e) => setTheme(e.target.value as any)}>
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Pronouns (optional)
                  <input
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value)}
                    placeholder="she/her · he/him · they/them"
                    style={{ width: 220 }}
                  />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={reduceMotion}
                    onChange={(e) => setReduceMotion(e.target.checked)}
                  />
                  Reduce motion
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={() => saveAll(true)} disabled={saving || !authLoaded}>Skip for now</button>
          <button
            className="btn-primary"
            onClick={() => saveAll(false)}
            disabled={saving || !authLoaded}
            style={{ borderRadius: 10 }}
            title="Save profile and optional dates"
          >
            {saving ? "Saving…" : "Finish"}
          </button>
        </div>

        {!authLoaded && (
          <div className="muted">Connecting… please wait a moment before finishing.</div>
        )}
        {err && <div style={{ color: "red" }}>{err}</div>}

        <div className="muted" style={{ textAlign: "center" }}>
          You can change your greeting titles or PIN anytime in Settings → Profile.
        </div>
      </div>
    </div>
  );
}
