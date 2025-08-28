// src/OnboardingScreen.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/** Optional callback so App.tsx can do <OnboardingScreen onDone={...}/> */
type Props = { onDone?: () => void };

/** LocalStorage keys (fallback if DB write fails) */
const LS_DONE = "byb:onboarding_done";
const LS_NAME = "byb:display_name";
const LS_POOL = "byb:display_pool";

/** Default nickname suggestions */
const DEFAULT_NICKNAMES = [
  "King",
  "Champ",
  "Legend",
  "Boss",
  "Chief",
  "Star",
  "Ace",
  "Hero",
  "Captain",
  "Tiger",
];

function pickDefaultName(email?: string | null, fullName?: string | null) {
  const n = (fullName || "").trim();
  if (n) return n;
  const e = (email || "").trim();
  if (!e) return "Friend";
  const handle = e.split("@")[0] || "Friend";
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

function saveLocal(name: string, pool: string[]) {
  try {
    localStorage.setItem(LS_NAME, name);
    localStorage.setItem(LS_POOL, JSON.stringify(pool));
    localStorage.setItem(LS_DONE, "1");
  } catch {
    // ignore storage errors
  }
}

async function saveProfileToDB(userId: string, name: string, pool: string[]) {
  // Expects a "profiles" table with columns:
  // id (uuid), display_name (text), display_pool (json/text[]), onboarding_done (bool)
  const payload = {
    display_name: name,
    display_pool: pool,
    onboarding_done: true,
  } as any;

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...payload })
    .select()
    .limit(1);

  if (error) throw error;
}

export default function OnboardingScreen({ onDone }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState<string>("");
  const [pool, setPool] = useState<string[]>([]);
  const [inputNick, setInputNick] = useState("");

  // Live example greeting
  const exampleGreeting = useMemo(() => {
    if (!name.trim()) return "Welcome back!";
    if (pool.length === 0) return `Welcome back, ${name}!`;
    const choices = [name, ...pool];
    const pick = choices[Math.floor(Math.random() * choices.length)];
    return `Welcome back, ${pick}!`;
  }, [name, pool]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const u = data.user;
        if (!u) return;

        setUserId(u.id);

        // Prefill a sensible name
        const fullName =
          (u.user_metadata as any)?.full_name ||
          (u.user_metadata as any)?.name ||
          null;
        const email = u.email || null;
        setName(pickDefaultName(email, fullName));
      } catch (e) {
        // Prefill "Friend" if we can't read user
        setName("Friend");
      }
    })();
  }, []);

  function toggleNick(n: string) {
    const v = n.trim();
    if (!v) return;
    if (pool.includes(v)) {
      setPool(pool.filter((x) => x !== v));
    } else {
      setPool([...pool, v]);
    }
  }

  function addFromInput() {
    const parts = inputNick
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const merged = Array.from(new Set([...pool, ...parts]));
    setPool(merged);
    setInputNick("");
  }

  async function finishOnboarding() {
    const cleanName = name.trim();
    if (!cleanName) {
      setErr("Please enter your name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (userId) {
        try {
          await saveProfileToDB(userId, cleanName, pool);
        } catch (dbErr) {
          // Fallback to local if DB table/columns aren't present
          saveLocal(cleanName, pool);
        }
      } else {
        saveLocal(cleanName, pool);
      }

      // Also set the local flag so App.tsx can gate properly
      localStorage.setItem(LS_DONE, "1");

      if (onDone) onDone();
      else window.location.replace("/");
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 16 }}>
      <h1>Welcome to BYB</h1>
      <p>Tell us your name and (optional) nicknames for your greeting.</p>

      <div className="card" style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div className="section-title">Your name</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
          />
        </label>

        <div>
          <div className="section-title">Nicknames (optional)</div>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            {DEFAULT_NICKNAMES.map((n) => {
              const on = pool.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleNick(n)}
                  className="btn-soft"
                  style={{
                    borderRadius: 999,
                    background: on ? "#e0f2fe" : "",
                    border: on
                      ? "1px solid #38bdf8"
                      : "1px solid var(--border)",
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={inputNick}
              onChange={(e) => setInputNick(e.target.value)}
              placeholder="Add custom nicknames (comma-separated)…"
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFromInput();
              }}
            />
            <button type="button" onClick={addFromInput}>
              Add
            </button>
          </div>

          {pool.length > 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              Selected: {pool.join(" · ")}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, fontStyle: "italic" }}>
        Example: <span>{exampleGreeting}</span>
      </div>

      {err && <div style={{ color: "red", marginTop: 12 }}>{err}</div>}

      <button
        className="btn-primary"
        onClick={finishOnboarding}
        disabled={busy}
        style={{ marginTop: 20, borderRadius: 8 }}
      >
        {busy ? "Saving…" : "Finish"}
      </button>
    </div>
  );
}
