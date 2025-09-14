// ProfileTitleAndPinCard.tsx
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

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

export default function ProfileTitleAndPinCard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [titleChoice, setTitleChoice] = useState<typeof TITLE_CHOICES[number]["key"]>("first_name");
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (!uid) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("first_name,title_choice,display_name,pin_enabled")
        .eq("id", uid)
        .single();
      setFirstName(p?.first_name || "");
      setTitleChoice(p?.title_choice || "first_name");
      setPinEnabled(!!p?.pin_enabled);
    })();
  }, []);

  function pinLooksValid(pin: string) { return /^\d{4}$/.test(pin); }

  async function save() {
    if (!userId) return;
    setSaving(true);
    setMsg(null);
    try {
      const selected = TITLE_CHOICES.find(t => t.key === titleChoice);
      const displayName = titleChoice === "first_name" ? (firstName || null) : (selected?.label ?? null);

      const payload: any = {
        title_choice: titleChoice,
        display_name: displayName,
        pin_enabled: pinEnabled,
        pin_updated_at: new Date().toISOString(),
      };

      if (pinEnabled) {
        if (pin1 || pin2) {
          if (!pinLooksValid(pin1) || pin1 !== pin2) throw new Error("Enter and confirm a 4-digit PIN.");
          payload.pin_hash = await sha256Hex(`${userId}:${pin1}`);
        }
      } else {
        payload.pin_hash = null;
      }

      const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
      if (error) throw error;
      setMsg("Saved ✔");
      setPin1(""); setPin2("");
      setTimeout(() => setMsg(null), 1500);
    } catch (e: any) {
      setMsg(e.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>How we address you & PIN</h2>

      <label style={{ display: "grid", gap: 6 }}>
        <div className="section-title">Preferred title</div>
        <select value={titleChoice} onChange={(e) => setTitleChoice(e.target.value as any)}>
          {TITLE_CHOICES.map(opt => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </label>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>4-digit PIN</h3>
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
              placeholder="New PIN (optional)"
              value={pin1}
              onChange={(e) => setPin1(e.target.value.replace(/\D/g, "").slice(0, 4))}
              style={{ width: 160 }}
            />
            <input
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              placeholder="Confirm PIN"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))}
              style={{ width: 180 }}
            />
          </div>
        )}
        <div className="muted">Forgot your PIN? Use “Forgot PIN?” on the lock screen to sign out, then sign back in and set a new one here.</div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn-primary" onClick={save} disabled={saving} style={{ borderRadius: 8 }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && <div className="muted">{msg}</div>}
    </div>
  );
}
