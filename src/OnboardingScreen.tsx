import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

/** ---- Local helpers (kept here so you don't need extra files) ---- */
const PRESET_NICKS = [
  "King",
  "Champ",
  "Boss",
  "Legend",
  "Hero",
  "Superstar",
  "Chief",
  "Captain",
  "Ace",
  "Champion",
];

const LS_ONBOARDED = "byb:onboarded:v1";
const LS_NICKS = "byb:nicknames:v1";

function saveLocalNicknames(nicks: string[]) {
  const clean = Array.from(new Set(nicks.map((s) => s.trim()).filter(Boolean)));
  localStorage.setItem(LS_NICKS, JSON.stringify(clean));
}

/** ---- Nickname picker component ---- */
function NicknamesPicker({
  nicknames,
  setNicknames,
}: {
  nicknames: string[];
  setNicknames: (arr: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function toggleNick(n: string) {
    const v = n.trim();
    if (!v) return;
    const exists = nicknames.includes(v);
    setNicknames(exists ? nicknames.filter((x) => x !== v) : [...nicknames, v]);
  }

  function addFromInput() {
    const parts = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const merged = Array.from(new Set([...nicknames, ...parts]));
    setNicknames(merged);
    setInput("");
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="muted">Pick any you like, then add your own:</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {PRESET_NICKS.map((n) => {
          const on = nicknames.includes(n);
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
              aria-pressed={on}
            >
              {n}
            </button>
          );
        })}
      </div>

      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add more (comma-separated or one at a time)…"
          style={{ flex: "1 1 220px", minWidth: 0 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") addFromInput();
          }}
        />
        <button type="button" className="btn-soft" onClick={addFromInput}>
          Add
        </button>
      </div>

      {nicknames.length > 0 && (
        <div className="muted">Selected: {nicknames.join(" · ")}</div>
      )}
    </div>
  );
}

/** ---- MAIN PAGE ---- */
export default function OnboardingScreen() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  // Basic identity (optional)
  const [displayName, setDisplayName] = useState("");

  // Nicknames + greeting mode
  const [nicknames, setNicknames] = useState<string[]>([]);
  const [greetMode, setGreetMode] = useState<"mixed" | "name_only" | "nickname_only">(
    "mixed"
  );

  // Load session + any existing profile prefs (optional)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id ?? null;
        if (!mounted) return;
        setUserId(uid);

        if (uid) {
          // Try to read existing profile (to prefill)
          const { data: prof } = await supabase
            .from("profiles")
            .select("display_name, full_name, prefs")
            .eq("id", uid)
            .single();

          const name =
            (prof as any)?.display_name ||
            (prof as any)?.full_name ||
            auth.user?.user_metadata?.full_name ||
            auth.user?.user_metadata?.name ||
            (auth.user?.email ? auth.user.email.split("@")[0] : "") ||
            "";
          setDisplayName(name);

          const existingNicks =
            ((prof as any)?.prefs?.nicknames as string[] | undefined) || [];
          const existingMode =
            ((prof as any)?.prefs?.greet_mode as
              | "mixed"
              | "name_only"
              | "nickname_only"
              | undefined) || "mixed";
          setNicknames(existingNicks);
          setGreetMode(existingMode);
        }
      } catch (e: any) {
        setErr(e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function finishOnboarding() {
    if (!userId) return;
    setSaving(true);
    setErr(null);
    try {
      // Save locally as a fallback (so greeting works even if DB update is blocked)
      saveLocalNicknames(nicknames);

      // Merge into profiles.prefs JSON if present, keep other prefs keys intact
      const { data: profRead } = await supabase
        .from("profiles")
        .select("prefs")
        .eq("id", userId)
        .single();

      const nextPrefs: any = {
        ...(profRead?.prefs || {}),
        nicknames,
        greet_mode: greetMode,
      };

      // Upsert profile with onboarded flag + optional display_name
      const payload: any = {
        id: userId,
        onboarded_at: new Date().toISOString(),
        prefs: nextPrefs,
      };
      if (displayName.trim()) payload.display_name = displayName.trim();

      const { error: upErr } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" });
      if (upErr) throw upErr;

      // Local flag so the app gate lets you straight in even if cache is stale
      localStorage.setItem(LS_ONBOARDED, "1");

      // Go to Today
      nav("/today", { replace: true });
    } catch (e: any) {
      console.error(e);
      setErr(e.message || "Failed to save onboarding");
    } finally {
      setSaving(false);
    }
  }

  const canSave = useMemo(() => {
    // You can decide to require at least a name or at least 1 nickname; for now, allow save anytime
    return true;
  }, [displayName, nicknames, greetMode]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="page-onboarding" style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Welcome to BYB</h1>

        {/* Identity */}
        <div className="card card--wash" style={{ display: "grid", gap: 10 }}>
          <div className="section-title">Your name (optional)</div>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What should we call you?"
          />
          <div className="muted">
            We’ll mix this with your chosen nicknames (you can change it later).
          </div>
        </div>

        {/* Nicknames */}
        <div className="card card--wash" style={{ display: "grid", gap: 10 }}>
          <div className="section-title">Nicknames</div>
          <NicknamesPicker nicknames={nicknames} setNicknames={setNicknames} />
          <div
            style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
          >
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                checked={greetMode === "mixed"}
                onChange={() => setGreetMode("mixed")}
              />
              Mixed (your name or a nickname)
            </label>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                checked={greetMode === "name_only"}
                onChange={() => setGreetMode("name_only")}
              />
              Your name only
            </label>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                checked={greetMode === "nickname_only"}
                onChange={() => setGreetMode("nickname_only")}
              />
              Nicknames only
            </label>
          </div>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            className="btn-primary"
            onClick={finishOnboarding}
            disabled={!canSave || saving || !userId}
            style={{ borderRadius: 8 }}
          >
            {saving ? "Saving…" : "Finish onboarding"}
          </button>
        </div>
      </div>
    </div>
  );
}
