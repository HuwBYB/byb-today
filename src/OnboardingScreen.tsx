import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type DateRow = {
  title: string;
  kind: "birthday" | "anniversary" | "custom";
  date: string;         // YYYY-MM-DD
  recur: "annually";
  person?: string;
};

const TITLE_CHOICES = [
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
] as const;

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function OnboardingScreen({ onDone }: { onDone?: () => void }) {
  const [userId, setUserId] = useState<string | null>(null);

  // MVP fields
  const [firstName, setFirstName] = useState("");
  const [titleChoice, setTitleChoice] = useState<typeof TITLE_CHOICES[number]["key"]>("first_name");
  const [displayNamePreview, setDisplayNamePreview] = useState("");

  const [dob, setDob] = useState("");

  // Optional fields
  const [openMore, setOpenMore] = useState(false);
  const [tz, setTz] = useState("");
  const [startOfWeek, setStartOfWeek] = useState<"monday" | "sunday">("monday");
  const [pronouns, setPronouns] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [reduceMotion, setReduceMotion] = useState(false);

  // Important dates repeater
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
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    try {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (guess) setTz(guess);
    } catch {}
  }, []);

  // Compute display name preview
  useEffect(() => {
    const selected = TITLE_CHOICES.find(t => t.key === titleChoice)?.label || "First name";
    setDisplayNamePreview(titleChoice === "first_name" ? (firstName || "…") : selected);
  }, [firstName, titleChoice]);

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
    if (!userId) return;
    setSaving(true);
    setErr(null);
    try {
      // derive display_name
      const selectedTitle = TITLE_CHOICES.find(t => t.key === titleChoice);
      const displayName =
        titleChoice === "first_name"
          ? (firstName.trim() || null)
          : (selectedTitle?.label ?? null);

      // profiles upsert (without PIN first)
      const profilePayload: any = {
        id: userId,
        first_name: firstName.trim() || null,
        title_choice: titleChoice,
        display_name: displayName,
        dob: dob || null,
        pronouns: pronouns.trim() || null,
        tz,
        start_of_week: startOfWeek,
        reminder_time: reminderTime,
        theme,
        reduce_motion: reduceMotion,
      };

      // Add PIN data if enabled & valid
      if (pinEnabled) {
        if (!pinLooksValid(pin1) || pin1 !== pin2) {
          throw new Error("Please enter and confirm a 4-digit PIN.");
        }
        const hash = await sha256Hex(`${userId}:${pin1}`);
        profilePayload.pin_enabled = true;
        profilePayload.pin_hash = hash;
        profilePayload.pin_updated_at = new Date().toISOString();
      } else {
        profilePayload.pin_enabled = false;
        profilePayload.pin_hash = null;
        profilePayload.pin_updated_at = new Date().toISOString();
      }

      const { error: pe } = await supabase
        .from("profiles")
        .upsert(profilePayload, { onConflict: "id" });
      if (pe) throw pe;

      if (!skip) {
        // insert important dates (ignore blank rows)
        const rows = dates
          .filter((r) => r.title.trim() && r.date)
          .map((r) => ({
            user_id: userId,
            title: r.title.trim(),
            kind: r.kind,
            date: r.date,
            recur: r.recur,
            person: (r.person || "").trim() || null,
          }));
        if (rows.length) {
          const { error: de } = await supabase.from("important_dates").insert(rows as any);
          if (de) throw de;
        }
      }

      if (onDone) onDone();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 740, margin: "0 auto" }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Welcome 👋</h1>
        <div className="muted">A few details and you’re in. You can change these anytime in Settings.</div>

        {/* MVP fields */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div className="section-title">First name</div>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g., Harriet"
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div className="section-title">How should we address you?</div>
            <select value={titleChoice} onChange={(e) => setTitleChoice(e.target.value as any)}>
              {TITLE_CHOICES.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            <div className="muted">We’ll greet you as: <b>{displayNamePreview || "…"}</b></div>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div className="section-title">Date of birth</div>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </label>
        </div>

        {/* More options toggle */}
        <button
          className="btn-soft"
          onClick={() => setOpenMore((o) => !o)}
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
                  Enable PIN on app open
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
                If you forget your PIN, tap “Forgot PIN?” on the lock screen to sign out and sign back in—then set a new PIN.
              </div>
            </div>

            {/* Important dates */}
            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title">Important dates (auto-add to Calendar)</div>
              <div className="muted">Birthdays, anniversaries, or anything to remember annually.</div>

              <div style={{ display: "grid", gap: 10 }}>
                {dates.map((r, i) => (
                  <div
                    key={i}
                    className="card"
                    style={{ display: "grid", gap: 8, padding: 12, border: "1px dashed var(--border)" }}
                  >
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

            {/* Preferences row */}
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
          <button onClick={() => saveAll(true)} disabled={saving}>Skip for now</button>
          <button
            className="btn-primary"
            onClick={() => saveAll(false)}
            disabled={saving}
            style={{ borderRadius: 10 }}
            title="Save profile and optional dates"
          >
            {saving ? "Saving…" : "Finish"}
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div className="muted" style={{ textAlign: "center" }}>
          You can change your title or PIN anytime in Settings → Profile.
        </div>
      </div>
    </div>
  );
}
