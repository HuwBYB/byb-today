// src/OnboardingScreen.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/** Optional callback so App.tsx can do <OnboardingScreen onDone={...}/> */
type Props = { onDone?: () => void };

/** LocalStorage keys (fallbacks if DB write fails) */
const LS_DONE = "byb:onboarding_done";
const LS_NAME = "byb:display_name";
const LS_POOL = "byb:display_pool";

/** Default nickname suggestions (includes feminine-forward options) */
const DEFAULT_NICKNAMES = [
  // Existing set
  "King", "Champ", "Legend", "Boss", "Chief", "Star", "Ace", "Hero", "Captain", "Tiger",
  // Feminine-forward
  "Queen", "Princess", "Gurl", "Boss Lady", "Diva", "Hot Stuff", "Girlfriend",
  // Extra ones you listed
  "Chica", "Darling", "Babe", "Bestie",
];

/** Utilities */
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

// ⚠️ Schema-flexible upsert that works with jsonb, text, or missing display_pool column
async function saveProfileToDB(userId: string, name: string, pool: string[]) {
  // Some projects have display_pool jsonb, some text, some none.
  // Try jsonb → stringified → omit field.
  const base: any = { display_name: name, onboarding_done: true };

  // Attempt 1: json/array payload (jsonb column)
  try {
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, ...base, display_pool: pool })
      .select()
      .limit(1);
    if (error) throw error;
    return;
  } catch {
    // Attempt 2: stringified payload (text/varchar column)
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: userId, ...base, display_pool: JSON.stringify(pool) })
        .select()
        .limit(1);
      if (error) throw error;
      return;
    } catch {
      // Attempt 3: no display_pool column — save name only
      await supabase
        .from("profiles")
        .upsert({ id: userId, ...base })
        .select()
        .limit(1);
    }
  }
}

export default function OnboardingScreen({ onDone }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Multi-step state: 0 = name, 1 = nicknames
  const [step, setStep] = useState<0 | 1>(0);

  // Form state
  const [name, setName] = useState<string>("");
  const [pool, setPool] = useState<string[]>([]);
  const [inputNick, setInputNick] = useState("");

  // Prefill sensible defaults
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data.user;
        if (!u) {
          setName("Friend");
          return;
        }
        setUserId(u.id);

        const fullName =
          (u.user_metadata as any)?.full_name ||
          (u.user_metadata as any)?.name ||
          null;
        const email = u.email || null;
        setName(pickDefaultName(email, fullName));
      } catch {
        setName("Friend");
      }
    })();
  }, []);

  // Live example greeting (randomly rotates name/nicknames)
  const exampleGreeting = useMemo(() => {
    if (!name.trim()) return "Welcome back!";
    const choices = pool.length > 0 ? [name, ...pool] : [name];
    const pick = choices[Math.floor(Math.random() * choices.length)];
    const dayPart = (() => {
      const h = new Date().getHours();
      if (h < 12) return "Good morning";
      if (h < 18) return "Good afternoon";
      return "Good evening";
    })();
    return `${dayPart}, ${pick}!`;
  }, [name, pool]);

  function toggleNick(n: string) {
    const v = n.trim();
    if (!v) return;
    setPool(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }

  function addFromInput() {
    const parts = inputNick.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const merged = Array.from(new Set([...(pool || []), ...parts]));
    setPool(merged);
    setInputNick("");
  }

  async function completeOnboarding(skip: boolean = false) {
    const cleanName = name.trim() || "Friend";
    const chosenPool = pool;

    setBusy(true);
    setErr(null);

    try {
      if (userId) {
        try {
          await saveProfileToDB(userId, cleanName, chosenPool);
        } catch {
          // ignore DB failures; we still mirror locally below
        }
      }

      // Always mirror locally for instant UX (even if DB succeeded)
      saveLocal(cleanName, chosenPool);

      // Also set the local flag so App.tsx can gate properly
      try { localStorage.setItem(LS_DONE, "1"); } catch {}

      if (onDone) onDone();
      else window.location.replace("/");
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (step === 0) {
      if (!name.trim()) {
        setErr("Please enter your name.");
        return;
      }
      setErr(null);
      setStep(1);
    }
  }
  function back() {
    setErr(null);
    setStep(0);
  }

  /* ---------- UI ---------- */
  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: 16 }}>
      <div className="card" style={{ display: "grid", gap: 12, padding: 16, borderRadius: 16 }}>
        {/* Header row with step + skip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>Welcome to BYB</div>
          <button
            className="btn-ghost"
            onClick={() => completeOnboarding(true)}
            disabled={busy}
            title="Skip setup"
          >
            Skip
          </button>
        </div>

        {/* Step pills */}
        <div style={{ display: "flex", gap: 6 }}>
          <StepPill num={1} label="Name" active={step === 0} done={step > 0} />
          <StepPill num={2} label="Nicknames" active={step === 1} done={false} />
        </div>

        {/* Step content */}
        {step === 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              What do you want us to call you?
            </p>
            <label style={{ display: "grid", gap: 6 }}>
              <div className="section-title">Your name</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
              />
            </label>

            <PreviewCard title="It will look like this">
              <div>{exampleGreeting}</div>
            </PreviewCard>

            {err && <div style={{ color: "red" }}>{err}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button onClick={() => completeOnboarding(true)} disabled={busy}>
                Skip
              </button>
              <button className="btn-primary" onClick={next} disabled={busy}>
                Next
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              Optional: pick a few nicknames you like. We’ll rotate greetings using your name and these.
            </p>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                      border: on ? "1px solid #38bdf8" : "1px solid var(--border)",
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={inputNick}
                onChange={(e) => setInputNick(e.target.value)}
                placeholder="Add custom nicknames (comma-separated)…"
                style={{ flex: 1, minWidth: 0 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFromInput();
                }}
              />
              <button type="button" onClick={addFromInput}>
                Add
              </button>
            </div>

            {pool.length > 0 && (
              <div className="muted">Selected: {pool.join(" · ")}</div>
            )}

            <PreviewCard title="Example greeting">
              <div>{exampleGreeting}</div>
            </PreviewCard>

            {err && <div style={{ color: "red" }}>{err}</div>}

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <button onClick={back} disabled={busy}>
                Back
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => completeOnboarding(true)} disabled={busy}>
                  Skip
                </button>
                <button
                  className="btn-primary"
                  onClick={() => completeOnboarding(false)}
                  disabled={busy}
                  style={{ borderRadius: 8 }}
                >
                  {busy ? "Saving…" : "Finish"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Small spacer below for safe thumb reach on small phones */}
      <div style={{ height: 12 }} />
    </div>
  );
}

/* ---------- Small subcomponents ---------- */
function StepPill({
  num,
  label,
  active,
  done,
}: {
  num: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  const bg = done ? "#dcfce7" : active ? "#eef2ff" : "#f8fafc";
  const bd = done ? "#86efac" : active ? "#c7d2fe" : "var(--border)";
  return (
    <div
      style={{
        display: "grid",
        gridAutoFlow: "column",
        gap: 8,
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${bd}`,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          border: "1px solid #d1d5db",
          background: "#fff",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {num}
      </span>
      <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

function PreviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="card"
      style={{
        padding: 10,
        borderRadius: 12,
        background: "#f8fafc",
        border: "1px dashed var(--border)",
      }}
    >
      <div className="section-title" style={{ marginBottom: 6 }}>
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}
