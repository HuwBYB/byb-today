import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types ---------- */
type DateRow = {
  title: string;
  kind: "birthday" | "anniversary" | "custom";
  date: string;         // YYYY-MM-DD
  recur: "annually";
  person?: string;
};

/* ---------- Titles (no free-text to avoid negative labels) ---------- */
const FUN_TITLES = [
  "King","Queen","Prince","Princess",
  "Bossman","Bosslady","Boss",
  "Sir","Madam",
  "Dude","Bro","Sis",
  "Champ","M'Lady","Your Highness","Winner",
] as const;
type FunTitle = typeof FUN_TITLES[number];

/* ---------- Small helpers ---------- */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

/* Build YYYY-MM-DD safely */
function ymd(year?: number, month1?: number, day?: number): string {
  if (!year || !month1 || !day) return "";
  const y = String(year);
  const m = String(month1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* Parse YYYY-MM-DD to parts */
function parseYMD(s: string): { y?: number; m?: number; d?: number } {
  if (!s) return {};
  const [yy, mm, dd] = s.split("-").map(Number);
  if (!yy || !mm || !dd) return {};
  return { y: yy, m: mm, d: dd };
}

/* Month list */
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

/* Years (now -> now-100) */
function yearsList() {
  const now = new Date().getFullYear();
  return Array.from({ length: 101 }, (_, i) => now - i);
}

/* =========================================================
   Component
   ========================================================= */
export default function OnboardingScreen({ onDone }: { onDone?: () => void }) {
  const [userId, setUserId] = useState<string | null>(null);

  // MVP fields
  const [firstName, setFirstName] = useState("");
  const [addressMode, setAddressMode] = useState<"first" | "titles">("first");
  const [selectedTitles, setSelectedTitles] = useState<FunTitle[]>([]);

  // DOB via dropdowns
  const [dob, setDob] = useState(""); // canonical YYYY-MM-DD
  const dobParts = useMemo(() => parseYMD(dob), [dob]);
  const [dobYear, setDobYear] = useState<number | undefined>(dobParts.y);
  const [dobMonth, setDobMonth] = useState<number | undefined>(dobParts.m);
  const [dobDay, setDobDay] = useState<number | undefined>(dobParts.d);

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
  }, []);

  // Keep dob string in sync when parts change
  useEffect(() => {
    setDob(ymd(dobYear, dobMonth, dobDay));
  }, [dobYear, dobMonth, dobDay]);

  // Preview name we’ll greet with
  const previewName = useMemo(() => {
    if (addressMode === "first") {
      return firstName.trim() || "…";
    }
    if (selectedTitles.length === 0) return "…";
    // simple deterministic pick for preview (index 0)
    return selectedTitles[0];
  }, [addressMode, firstName, selectedTitles]);

  function toggleTitle(t: FunTitle) {
    setSelectedTitles(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
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

  async function saveAll(skipDates: boolean = false) {
    if (!userId) return;
    setSaving(true);
    setErr(null);
    try {
      // Final display name we’ll save now (for immediate greetings)
      const displayName =
        addressMode === "first"
          ? (firstName.trim() || null)
          : (selectedTitles[0] ?? null); // store first as canonical; app can randomize from titles[]

      // Build profile payload (only columns we’re sure exist)
      const profilePayload: any = {
        id: userId,
        first_name: firstName.trim() || null,
        display_name: displayName,
        dob: dob || null,
        titles: selectedTitles.length ? selectedTitles : null,
      };

      // PIN data
      if (pinEnabled) {
        if (!pinLooksValid(pin1) || pin1 !== pin2) {
          throw new Error("Please enter and confirm a 4-digit PIN.");
        }
        const hash = await sha256Hex(`${userId}:${pin1}`);
        profilePayload.pin_enabled = true;
        profilePayload.pin_hash = hash;
      } else {
        profilePayload.pin_enabled = false;
        profilePayload.pin_hash = null;
      }

      const { error: pe } = await supabase
        .from("profiles")
        .upsert(profilePayload, { onConflict: "id" });
      if (pe) throw pe;

      if (!skipDates) {
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

      onDone && onDone();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  /* Days in selected month/year (handles leap years) */
  const daysInMonth = useMemo(() => {
    if (!dobYear || !dobMonth) return 31;
    return new Date(dobYear, dobMonth, 0).getDate();
  }, [dobYear, dobMonth]);

  useEffect(() => {
    if (dobDay && dobDay > daysInMonth) setDobDay(daysInMonth);
  }, [daysInMonth, dobDay]);

  /* =========================================================
     UI
     ========================================================= */
  return (
    <div className="container" style={{ maxWidth: 740, margin: "0 auto" }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Welcome 👋</h1>
        <div className="muted">A few details and you’re in. You can change these anytime in Settings.</div>

        {/* Core details */}
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div className="section-title">First name</div>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g., Harriet"
            />
          </label>

          {/* Addressing mode */}
          <div style={{ display: "grid", gap: 8 }}>
            <div className="section-title">How should we address you?</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="addr"
                  checked={addressMode === "first"}
                  onChange={() => setAddressMode("first")}
                />
                First name
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="addr"
                  checked={addressMode === "titles"}
                  onChange={() => setAddressMode("titles")}
                />
                Pick from fun titles
              </label>
              <div className="muted" style={{ marginLeft: "auto" }}>
                We’ll greet you as: <b>{previewName}</b>
              </div>
            </div>

            {addressMode === "titles" && (
              <div className="card" style={{ padding: 10 }}>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Choose as many as you like — the app will pick one at random when you open it.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {FUN_TITLES.map((t) => {
                    const active = selectedTitles.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTitle(t)}
                        aria-pressed={active}
                        title={active ? "Selected" : "Select"}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid",
                          borderColor: active ? "hsl(var(--pastel-hsl))" : "#e5e7eb",
                          background: active ? "hsl(var(--pastel-hsl) / .45)" : "#fff",
                          cursor: "pointer",
                          textAlign: "left",
                          fontWeight: 600,
                        }}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* DOB with month/year dropdowns */}
          <div style={{ display: "grid", gap: 6 }}>
            <div className="section-title">Date of birth</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                value={dobMonth ?? ""}
                onChange={(e) => setDobMonth(e.target.value ? Number(e.target.value) : undefined)}
                aria-label="Month"
                style={{ minWidth: 140 }}
              >
                <option value="">Month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>

              <select
                value={dobDay ?? ""}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : undefined;
                  setDobDay(v ? clamp(v, 1, daysInMonth) : undefined);
                }}
                aria-label="Day"
                style={{ minWidth: 100 }}
              >
                <option value="">Day</option>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <select
                value={dobYear ?? ""}
                onChange={(e) => setDobYear(e.target.value ? Number(e.target.value) : undefined)}
                aria-label="Year"
                style={{ minWidth: 120 }}
              >
                <option value="">Year</option>
                {yearsList().map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* More options */}
        <details className="card">
          <summary style={{ cursor: "pointer", padding: "6px 0", fontWeight: 600 }}>More options</summary>

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
        </details>

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
          You can change your greeting titles or PIN anytime in Settings → Profile.
        </div>
      </div>
    </div>
  );
}
