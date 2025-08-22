// PINGate.tsx
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ATTEMPT_KEY = "byb:pin_attempts";
const LOCK_KEY = "byb:pin_lock_until";
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000; // 5 minutes

export default function PINGate() {
  const [needPin, setNeedPin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [pinHash, setPinHash] = useState<string | null>(null);

  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number>(0);

  useEffect(() => {
    const lock = Number(localStorage.getItem(LOCK_KEY) || "0");
    setLockedUntil(lock);

    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (!uid) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("pin_enabled,pin_hash")
        .eq("id", uid)
        .single();

      if (prof?.pin_enabled && prof?.pin_hash) {
        setPinHash(prof.pin_hash);
        setNeedPin(true);
      } else {
        setNeedPin(false);
      }
    });
  }, []);

  if (!needPin) return null;

  const now = Date.now();
  // ✅ Force a strict boolean
  const isLocked: boolean = Boolean(lockedUntil && now < lockedUntil);

  async function submit() {
    if (!userId || !pinHash) return;
    setErr(null);

    if (!/^\d{4}$/.test(pin)) {
      setErr("Enter 4 digits.");
      return;
    }

    const lock = Number(localStorage.getItem(LOCK_KEY) || "0");
    if (lock && Date.now() < lock) {
      setErr("Too many attempts. Try again later.");
      return;
    }

    const attempts = Number(localStorage.getItem(ATTEMPT_KEY) || "0");
    const hash = await sha256Hex(`${userId}:${pin}`);
    if (hash === pinHash) {
      // success: reset counters and drop gate
      localStorage.removeItem(ATTEMPT_KEY);
      localStorage.removeItem(LOCK_KEY);
      setNeedPin(false);
      setPin("");
      return;
    }

    // fail
    const nextAttempts = attempts + 1;
    localStorage.setItem(ATTEMPT_KEY, String(nextAttempts));
    if (nextAttempts >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCK_MS;
      localStorage.setItem(LOCK_KEY, String(until));
      setLockedUntil(until);
      setErr("Too many attempts. Locked for 5 minutes.");
    } else {
      setErr(`Incorrect PIN. ${MAX_ATTEMPTS - nextAttempts} tries left.`);
    }
    setPin("");
  }

  async function forgot() {
    // simplest safe recovery: sign out and go to login
    await supabase.auth.signOut();
    window.location.href = "/"; // or your login route
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enter PIN"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "grid",
        placeItems: "center",
        zIndex: 3000,
        padding: 16,
      }}
    >
      <div className="card" style={{ width: 360, display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, textAlign: "center" }}>Enter PIN</h2>
        <input
          inputMode="numeric"
          maxLength={4}
          pattern="\\d{4}"
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          onKeyDown={(e) => e.key === "Enter" && !isLocked && submit()}
          placeholder="••••"
          style={{ textAlign: "center", fontSize: 22, letterSpacing: 8 }}
        />
        {err && (
          <div style={{ color: "crimson", textAlign: "center" }}>{err}</div>
        )}
        <button
          className="btn-primary"
          onClick={submit}
          disabled={isLocked}
          style={{ borderRadius: 8 }}
          title={isLocked ? "Locked due to failed attempts" : undefined}
        >
          Unlock
        </button>
        <button className="btn-ghost" onClick={forgot} title="Sign out to reset PIN">
          Forgot PIN?
        </button>
      </div>
    </div>
  );
}
