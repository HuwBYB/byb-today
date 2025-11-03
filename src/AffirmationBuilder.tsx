// src/AffirmationBuilder.tsx — NON-AI version with local suggestion bank + per-area saved slots
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Shared category palette ---------- */
import {
  CATS,
  colorOf,
  type AllowedCategory as Category,
} from "./theme/categories";

/* ---------- Types ---------- */
type AffirmationRow = {
  id?: number;
  user_id?: string | null;
  category: Category;
  text: string;
  created_at?: string;
};

/* ---------- Helpers ---------- */
function hexToRgba(hex: string, alpha = 0.45) {
  const m = hex.replace("#", "");
  const [r, g, b] =
    m.length === 3
      ? [m[0] + m[0], m[1] + m[1], m[2] + m[2]]
      : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)];
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
}

/* ---------- Storage keys ---------- */
const LS_VAULT = "byb:affirmations:v1";
const LS_CONF_TODAY_PREFIX = "byb:confidence:today:"; // kept for backwards-compat storage (used as "Today")
const LS_DEFAULT_PREFIX = "byb:affirmation:default:";

/* ---------- Utils ---------- */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};
const todayKey = () => `${LS_CONF_TODAY_PREFIX}${todayISO()}`; // effectively our "Today" bucket
const defaultKey = (cat: string) => `${LS_DEFAULT_PREFIX}${cat}`;

/* ---------- Local persistence ---------- */
async function saveToVaultLocal(row: AffirmationRow) {
  try {
    const arr: AffirmationRow[] = JSON.parse(localStorage.getItem(LS_VAULT) || "[]");
    arr.unshift({ ...row, created_at: new Date().toISOString() });
    localStorage.setItem(LS_VAULT, JSON.stringify(arr));
  } catch {}
}
async function sendToTodayLocal(row: AffirmationRow) {
  // NOTE: keeps old key for compatibility; semantically treated as "Today"
  try {
    const key = todayKey();
    const arr: AffirmationRow[] = JSON.parse(localStorage.getItem(key) || "[]");
    const exists = arr.some(
      (a) => a.category === row.category && a.text.trim() === row.text.trim()
    );
    if (!exists) {
      arr.push(row);
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch {}
}
function setDefaultLocal(category: Category, text: string) {
  try {
    localStorage.setItem(defaultKey(category), text);
  } catch {}
}
function getDefaultLocal(category: Category): string {
  try {
    return localStorage.getItem(defaultKey(category)) || "";
  } catch {
    return "";
  }
}
function getAllDefaults(): Record<Category, string> {
  const map = {} as Record<Category, string>;
  CATS.forEach((c) => {
    map[c.key as Category] = getDefaultLocal(c.key as Category);
  });
  return map;
}

/* ---------- Static suggestion bank (3 per focus area) ---------- */
const SUGGESTION_BANK: Record<Category, string[]> = {
  business: [
    "I lead with clarity and calm.",
    "I ship progress every day.",
    "I make smart, simple decisions.",
  ],
  financial: [
    "I steward money wisely and well.",
    "I create value and earn fairly.",
    "I respect my budget and build wealth.",
  ],
  health: [
    "I fuel my body and move daily.",
    "I train with patience and consistency.",
    "I choose rest to grow stronger.",
  ],
  personal: [
    "I show up as my best self today.",
    "I keep promises to myself.",
    "I act with integrity and curiosity.",
  ],
  relationships: [
    "I listen fully and speak kindly.",
    "I set clear, loving boundaries.",
    "I invest time in the people I love.",
  ],
};

/* ---------- Modal ---------- */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 960,
          width: "100%",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.2)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>
            ✕
          </button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Help content (neutral) ---------- */
function BuilderHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p>
        <em>
          Save one affirmation for each area of life, then use them daily. Keep them short, present-tense, believable.
        </em>
      </p>

      <h4 style={{ margin: 0 }}>How to use</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Tap a card</b> to edit that area’s saved line.</li>
        <li><b>Write your own</b> or click <i>Get suggestions</i> for three ideas.</li>
        <li><b>Tweak tone</b> with one-taps: Shorter, Stronger, Gentler.</li>
        <li><b>Save</b> to set the default for that area, and/or <b>Add to Today</b>.</li>
        <li>Use <b>Add all to Today</b> to queue your full set with one tap.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Good affirmation rules</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Keep it <b>present tense</b> ("I lead with clarity").</li>
        <li>Make it <b>short</b> (ideally under 12 words).</li>
        <li>Focus on what’s <b>in your control</b> ("I show up daily").</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Tip: Read it aloud — if it feels clunky or fake, tweak until it’s natural.
      </p>
    </div>
  );
}

/* =========================================================
   PAGE
   ========================================================= */
export default function AffirmationBuilderScreen() {
  const [userId, setUserId] = useState<string | null>(null);

  // Editor state
  const [active, setActive] = useState<Category>("business");
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Saved set state (one per area)
  const [defaultsMap, setDefaultsMap] = useState<Record<Category, string>>(() => getAllDefaults());

  // Save options
  const [optUseToday, setOptUseToday] = useState(true);
  const [optSetDefault, setOptSetDefault] = useState(true);

  const [busySave, setBusySave] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showHelp, setShowHelp] = useState(false);

  // Suggestion source category (defaults to current tab)
  const [suggestCat, setSuggestCat] = useState<Category>("business");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // When category changes, load its default into the editor if empty
  useEffect(() => {
    const def = getDefaultLocal(active);
    if (!text.trim()) setText(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Derived color
  const activeColor = useMemo(() => colorOf(active), [active]);

  function pickSuggestion(s: string, i: number) {
    setText(s);
    setSelectedIdx(i);
    if ((navigator as any).vibrate) (navigator as any).vibrate(3);
  }

  function suggestFromBank() {
    setErr(null);
    const opts = SUGGESTION_BANK[suggestCat] || [];
    setSuggestions(opts);
    setSelectedIdx(null);
    if (opts[0]) {
      setText(opts[0]);
      setSelectedIdx(0);
    }
  }

  // Local tone tweaks only (no network)
  function localRefine(kind: "shorter" | "stronger" | "gentler", s: string) {
    let t = s.trim();

    if (kind === "shorter") {
      t = t.replace(/,.*$/g, "").replace(/\s{2,}/g, " ");
      const words = t.split(/\s+/).slice(0, 10);
      t = words.join(" ");
    } else if (kind === "stronger") {
      t = t
        .replace(/\b(maybe|try|trying|hope|hoping|aim|aiming|could|should|might|want to)\b/gi, "")
        .replace(/\bI (can|will)\b/gi, "I")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!/^I\b/i.test(t)) t = `I ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    } else if (kind === "gentler") {
      if (!/with (kindness|calm|patience)/i.test(t)) {
        t = `${t} with kindness`;
      }
      t = t.replace(/\s{2,}/g, " ");
    }

    const words = t.split(/\s+/).slice(0, 12);
    return words.join(" ").trim();
  }

  function refineTone(kind: "shorter" | "stronger" | "gentler") {
    if (!text.trim()) return;
    setErr(null);
    const offline = localRefine(kind, text);
    setText(offline);
    setSelectedIdx(null);
  }

  /* ---------- Save actions ---------- */
  async function save({ saveDefault, useToday }: { saveDefault: boolean; useToday: boolean }) {
    const clean = text.trim();
    if (!clean) {
      setErr("Write or pick an affirmation first.");
      return;
    }
    setErr(null);
    setBusySave(true);
    const row: AffirmationRow = { user_id: userId, category: active, text: clean };

    // Best-effort: store raw in a vault list for history
    await saveToVaultLocal(row);

    // Persistent per-category default
    if (saveDefault) {
      setDefaultLocal(active, clean);
      setDefaultsMap((m) => ({ ...m, [active]: clean }));
      // Optional Supabase upsert (best-effort). If your schema differs, adjust here.
      try {
        if (userId) {
          await supabase.from("affirmation_defaults").upsert(
            { user_id: userId, category: active, text: clean },
            { onConflict: "user_id,category" } as any
          );
        }
      } catch {
        // ignore if table not present
      }
    }

    // Add to Today (backed by previous key for compatibility)
    if (useToday) {
      await sendToTodayLocal(row);
    }

    // Optional: keep a full list of authored affirmations in Supabase
    try {
      if (userId) {
        await supabase.from("affirmations").insert({
          user_id: userId,
          category: active,
          text: clean,
        });
      }
    } catch {
      // best-effort only
    }

    setBusySave(false);
    if ((navigator as any).vibrate) (navigator as any).vibrate(6);
  }

  async function saveClick() {
    await save({ saveDefault: optSetDefault, useToday: optUseToday });
  }

  function loadDefaultIntoEditor(cat: Category = active) {
    const def = getDefaultLocal(cat);
    setText(def);
    setSelectedIdx(null);
  }

  function editCard(cat: Category) {
    setActive(cat);
    loadDefaultIntoEditor(cat);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addAllToToday() {
    const map = getAllDefaults();
    for (const cat of Object.keys(map) as Category[]) {
      const t = map[cat];
      if (t && t.trim()) {
        await sendToTodayLocal({ category: cat, text: t, user_id: userId });
      }
    }
    if ((navigator as any).vibrate) (navigator as any).vibrate(10);
  }

  return (
    <div className="page-affirmation-builder" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card" style={{ position: "relative" }}>
          <h1 style={{ margin: 0 }}>Affirmations — Your Daily Set</h1>
          <div className="muted">Save one affirmation for each area of life. Edit any card below, or craft a new one in the editor, then save as that area’s default.</div>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open builder help"
            title="Need a hand?"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              lineHeight: 0,
              zIndex: 10,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#f9fafb",
                fontWeight: 700,
              }}
            >
              ?
            </span>
          </button>
        </div>

        {/* My Daily Set (one slot per category) */}
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div className="section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>My Daily Set</span>
            <button onClick={addAllToToday} className="btn-primary" style={{ borderRadius: 10 }}>Add all to Today</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {CATS.map((c) => {
              const val = defaultsMap[c.key as Category] || "";
              const col = colorOf(c.key as Category);
              const hasVal = !!val.trim();
              return (
                <div key={c.key} style={{ border: `1px solid ${hasVal ? col : "#e5e7eb"}`, borderRadius: 12, padding: 12, background: hasVal ? hexToRgba(col, 0.18) : "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                    <strong>{c.label}</strong>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => editCard(c.key as Category)} title="Edit this affirmation">Edit</button>
                      {hasVal && (
                        <button
                          onClick={() => sendToTodayLocal({ category: c.key as Category, text: val, user_id: userId })}
                          title="Add this to Today"
                        >
                          Use Today
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontWeight: 700, lineHeight: 1.3 }}>
                    {hasVal ? val : <span className="muted">No saved affirmation yet</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Category tabs */}
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CATS.map((c) => {
            const isActive = c.key === active;
            const col = c.color;
            return (
              <button
                key={c.key}
                onClick={() => {
                  setActive(c.key);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid",
                  borderColor: isActive ? col : "#e5e7eb",
                  background: isActive ? hexToRgba(col, 0.45) : "#fff",
                  fontWeight: isActive ? 700 : 500,
                }}
                aria-pressed={isActive}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Builder panel */}
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div className="section-title">Write your own</div>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSelectedIdx(null);
            }}
            placeholder="e.g., I lead with calm, decisive action."
            aria-label="Affirmation text"
          />

          <div className="section-title">Or get suggestions</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={suggestCat}
              onChange={(e) => setSuggestCat(e.target.value as Category)}
              aria-label="Suggestion focus area"
              style={{ minWidth: 220 }}
            >
              {CATS.map((c) => (
                <option key={c.key} value={c.key as Category}>
                  {c.label}
                </option>
              ))}
            </select>
            <button onClick={suggestFromBank} className="btn-primary" style={{ borderRadius: 8 }}>
              Get suggestions
            </button>
          </div>

          {!!suggestions.length && (
            <div style={{ display: "grid", gap: 6 }}>
              <div className="muted">Suggestions (tap to use)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {suggestions.map((s, i) => {
                  const activeChip = selectedIdx === i;
                  return (
                    <button
                      key={i}
                      onClick={() => pickSuggestion(s, i)}
                      aria-pressed={activeChip}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid",
                        borderColor: activeChip ? activeColor : "#e5e7eb",
                        background: activeChip ? hexToRgba(activeColor, 0.45) : "#fff",
                        fontWeight: activeChip ? 700 : 500,
                        maxWidth: "100%",
                        whiteSpace: "normal",
                        wordBreak: "break-word",
                        textAlign: "left",
                      }}
                      title={s}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tone nudges */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => refineTone("shorter")} disabled={!text}>
              Shorter
            </button>
            <button onClick={() => refineTone("stronger")} disabled={!text}>
              Stronger
            </button>
            <button onClick={() => refineTone("gentler")} disabled={!text}>
              Gentler
            </button>
          </div>

          {/* Preview card */}
          <div
            aria-label="Affirmation preview"
            style={{
              padding: 18,
              border: `2px solid ${activeColor}`,
              borderRadius: 12,
              fontSize: 22,
              fontWeight: 800,
              lineHeight: 1.3,
              textAlign: "center",
              background: hexToRgba(activeColor, 0.25),
            }}
          >
            {text || "Your affirmation will appear here…"}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Tip: Read it aloud once — if it feels clunky, tweak the words until it feels natural.
          </div>

          {/* Save options */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={optSetDefault} onChange={(e) => setOptSetDefault(e.target.checked)} />
              <span>
                Set as default for <b>{CATS.find((c) => c.key === active)?.label}</b>
              </span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={optUseToday} onChange={(e) => setOptUseToday(e.target.checked)} />
              <span>Add to <b>Today</b></span>
            </label>
            <span className="muted" style={{ marginLeft: "auto" }}>
              Current default: {defaultsMap[active] ? <em>“{defaultsMap[active]}”</em> : <em>None</em>}
            </span>
            {defaultsMap[active] && (
              <button onClick={() => loadDefaultIntoEditor(active)} title="Load current default into editor">
                Load default
              </button>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {err && <div style={{ color: "red", marginRight: "auto" }}>{err}</div>}
            <button
              onClick={() => {
                setText("");
                setSelectedIdx(null);
              }}
              disabled={!text}
            >
              Clear
            </button>
            <button onClick={saveClick} className="btn-primary" disabled={!text || busySave} style={{ borderRadius: 10 }}>
              {busySave ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Affirmations — Help">
        <BuilderHelpContent />
      </Modal>
    </div>
  );
}
