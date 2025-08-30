// src/OnboardingScreen.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/** Optional callback so App.tsx can do <OnboardingScreen onDone={...}/> */
type Props = { onDone?: () => void };

/** LocalStorage keys (fallbacks if DB write fails) */
const LS_DONE = "byb:onboarding_done";
const LS_NAME = "byb:display_name";
const LS_POOL = "byb:display_pool";
const LS_BIG_GOAL = "byb:big_goal";

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

/** Utilities */
function pickDefaultName(email?: string | null, fullName?: string | null) {
  const n = (fullName || "").trim();
  if (n) return n;
  const e = (email || "").trim();
  if (!e) return "Friend";
  const handle = e.split("@")[0] || "Friend";
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

function saveLocal(name: string, pool: string[], bigGoal?: string) {
  try {
    localStorage.setItem(LS_NAME, name);
    localStorage.setItem(LS_POOL, JSON.stringify(pool));
    if (bigGoal && bigGoal.trim()) {
      localStorage.setItem(LS_BIG_GOAL, bigGoal.trim());
    }
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

async function tryInsertBigGoal(userId: string, bigGoal: string) {
  const clean = bigGoal.trim();
  if (!clean) return;

  // We’ll try a very lightweight insert. If the table/columns differ or
  // don’t exist yet, we silently fall back to local storage.
  try {
    await supabase.from("goals").insert({
      user_id: userId,
      title: clean,
      status: "active",
      // Optional columns may exist in your schema; include only safe ones.
    } as any);
  } catch {
    // swallow; local storage already handled by saveLocal
  }
}

export default function OnboardingScreen({ onDone }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Multi-step state: 0=name, 1=nicknames, 2=big goal
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Form state
  const [name, setName] = useState<string>("");
  const [pool, setPool] = useState<string[]>([]);
  const [inputNick, setInputNick] = useState("");
  const [bigGoal, setBigGoal] = useState("");

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

  async function completeOnboarding(skip: boolean = false) {
    const cleanName = name.trim() || "Friend";
    const chosenPool = pool;
    const goal = skip ? "" : bigGoal.trim();

    setBusy(true);
    setErr(null);

    try {
      if (userId) {
        try {
          await saveProfileToDB(userId, cleanName, chosenPool);
          if (goal) {
            await tryInsertBigGoal(userId, goal);
          }
        } catch {
          // If DB not ready, fall back locally
          saveLocal(cleanName, chosenPool, goal);
        }
      } else {
        // Not signed in (or offline): local only
        saveLocal(cleanName, chosenPool, goal);
      }

      // Also set the local flag so App.tsx can gate properly
      try {
        localStorage.setItem(LS_DONE, "1");
      } catch {
        // ignore
      }

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
    } else if (step === 1) {
      setStep(2);
    }
  }
  function back() {
    setErr(null);
    setStep((s) => (s === 0 ? 0 : ((s - 1) as 0 | 1 | 2)));
  }

  /* ---------- UI ---------- */
  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: 16 }}>
      <div
        className="card"
        style={{
          display: "grid",
          gap: 12,
          padding: 16,
          borderRadius: 16,
        }}
      >
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
          <StepPill
            num={2}
            label="Nicknames"
            active={step === 1}
            done={step > 1}
          />
          <StepPill num={3} label="Big Goal" active={step === 2} done={false} />
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

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
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
              Optional: pick a few nicknames you like. We’ll rotate greetings
              using your name and these.
            </p>

            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
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
                      border: on ? "1px solid #38bdf8" : "1px solid var(--border)",
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            <div className="row">
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
              <div className="muted">
                Selected: {pool.join(" · ")}
              </div>
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
                <button className="btn-primary" onClick={next} disabled={busy}>
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              What’s your <b>big goal</b> right now? (You can change it later.)
            </p>
            <label style={{ display: "grid", gap: 6 }}>
              <div className="section-title">Big Goal (optional)</div>
              <input
                type="text"
                value={bigGoal}
                onChange={(e) => setBigGoal(e.target.value)}
                placeholder="e.g. Run a 5k, Launch my side hustle, Lose 5kg"
              />
            </label>

            <PreviewCard title="You’ll see something like this on your Today screen">
              <div>
                {bigGoal.trim()
                  ? `Your Big Goal: ${bigGoal.trim()}`
                  : "You can set a Big Goal any time."}
              </div>
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
