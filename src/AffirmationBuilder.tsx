// src/AffirmationBuilderScreen.tsx
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Public path helper ---------- */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}
// If you add an EVA help image later, point this to it.
// For now we’ll hide the image if missing.
const EVA_HELP_IMG = publicPath("/eva/Affirmations_Eva.png");

/* ---------- Types ---------- */
type Category = "business" | "relationships" | "financial" | "personal" | "health";
type AffirmationRow = {
  id?: number;
  user_id?: string | null;
  category: Category;
  text: string;
  created_at?: string;
};

/* ---------- Storage keys ---------- */
const LS_VAULT = "byb:affirmations:v1";
const LS_CONF_TODAY_PREFIX = "byb:confidence:today:";

/* ---------- Utils ---------- */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const confidenceKeyForToday = () => `${LS_CONF_TODAY_PREFIX}${todayISO()}`;

async function saveToVaultLocal(row: AffirmationRow) {
  try {
    const arr: AffirmationRow[] = JSON.parse(localStorage.getItem(LS_VAULT) || "[]");
    arr.unshift({ ...row, created_at: new Date().toISOString() });
    localStorage.setItem(LS_VAULT, JSON.stringify(arr));
  } catch {}
}
async function sendToConfidenceTodayLocal(row: AffirmationRow) {
  try {
    const key = confidenceKeyForToday();
    const arr: AffirmationRow[] = JSON.parse(localStorage.getItem(key) || "[]");
    const exists = arr.some(a => a.category === row.category && a.text.trim() === row.text.trim());
    if (!exists) {
      arr.push(row);
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch {}
}

/* ---------- Modal ---------- */
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 2000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, width: "100%", background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Help content (EVA) ---------- */
function BuilderHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Craft affirmations that feel like you — short, present-tense, and believable — then send them to the Confidence page to practice.</em></p>

      <h4 style={{ margin: 0 }}>How to use</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pick an area</b>: Business, Relationships, Financial, Personal, or Health.</li>
        <li><b>Write your own</b> or click <i>Ask EVA</i> for 2–3 suggestions.</li>
        <li><b>Tweak tone</b> with one-taps: Shorter, Stronger, Gentler.</li>
        <li><b>Save</b> to your vault and <b>Send to Confidence</b> for today’s practice set.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Good affirmation rules</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Keep it <b>present tense</b> (“I lead with clarity”).</li>
        <li>Make it <b>short</b> (ideally under 12 words).</li>
        <li>Focus on what’s <b>in your control</b> (“I show up daily”).</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Tip: Read it aloud once — if it feels clunky or fake, tweak until it’s natural.
      </p>
    </div>
  );
}

/* =========================================================
   PAGE
   ========================================================= */
export default function AffirmationBuilderScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [active, setActive] = useState<Category>("business");

  const [text, setText] = useState("");           // editor text
  const [theme, setTheme] = useState("");         // optional prompt theme
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const [busySuggest, setBusySuggest] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const CATS: { key: Category; label: string }[] = [
    { key: "business", label: "Business" },
    { key: "relationships", label: "Relationships" },
    { key: "financial", label: "Financial" },
    { key: "personal", label: "Personal" },
    { key: "health", label: "Health" },
  ];

  /* ---------- EVA helpers (calls your /api/eva endpoint) ---------- */
  async function askEva() {
    setErr(null);
    setBusySuggest(true);
    setSelectedIdx(null);
    try {
      const prompt =
`Help me write 3 short, present-tense affirmations for the "${active}" area.
Theme (optional): ${theme || "(none)"}
Rules: under 12 words, positive, believable, in my control. Output as bullet points.`;
      const res = await fetch("/api/eva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "friend",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`EVA error: ${res.status}`);
      const data = await res.json();
      const reply: string = data.reply || data.text || "";
      const lines = reply.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const bulls = lines
        .filter(l => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l))
        .map(l => l.replace(/^([-*•]\s+|\d+\.\s+)/, "").trim());
      const opts = (bulls.length ? bulls : lines).slice(0, 3).map(s => s.replace(/^"|"$/g, ""));
      setSuggestions(opts);
      if (opts[0]) { setText(opts[0]); setSelectedIdx(0); }
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusySuggest(false);
    }
  }

  // Simple local heuristics as a fallback if the network call fails
  function localRefine(kind: "shorter" | "stronger" | "gentler", s: string) {
    let t = s.trim();

    if (kind === "shorter") {
      // Remove commas/clauses and trim to ~10 words
      t = t.replace(/,.*$/g, "").replace(/\s{2,}/g, " ");
      const words = t.split(/\s+/).slice(0, 10);
      t = words.join(" ");
    } else if (kind === "stronger") {
      // Remove hedges; strengthen verbs
      t = t
        .replace(/\b(maybe|try|trying|hope|hoping|aim|aiming|could|should|might|want to)\b/gi, "")
        .replace(/\bI (can|will)\b/gi, "I")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!/^I\b/i.test(t)) t = `I ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    } else if (kind === "gentler") {
      // Add warmth
      if (!/with (kindness|calm|patience)/i.test(t)) {
        t = `${t} with kindness`;
      }
      t = t.replace(/\s{2,}/g, " ");
    }

    // Keep under ~12 words
    const words = t.split(/\s+/).slice(0, 12);
    return words.join(" ").trim();
  }

  async function refineTone(kind: "shorter" | "stronger" | "gentler") {
    if (!text.trim()) return;
    setErr(null);
    setBusySuggest(true);
    try {
      const prompt =
`Rewrite this affirmation with a ${kind} tone.
Keep it present-tense, positive, under 12 words, believable:
"${text}"`;
      const res = await fetch("/api/eva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "friend",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      // If API fails, fall back locally
      if (!res.ok) {
        const offline = localRefine(kind, text);
        setText(offline);
        setSelectedIdx(null);
        setErr("EVA is offline — used a local tweak.");
        return;
      }

      const data = await res.json();
      // Pick the first non-empty line
      const out =
        (data.reply || data.text || "")
          .trim()
          .split(/\r?\n/)
          .map((l: string) => l.replace(/^[-*•]\s+/, "").replace(/^"|"$/g, "").trim())
          .find((l: string) => !!l) || "";

      if (out) {
        setText(out);
        setSelectedIdx(null);
      } else {
        // Fallback if EVA returned something unexpected
        const offline = localRefine(kind, text);
        setText(offline);
        setSelectedIdx(null);
      }
    } catch (e: any) {
      const offline = localRefine(kind, text);
      setText(offline);
      setSelectedIdx(null);
      setErr(e.message || String(e));
    } finally {
      setBusySuggest(false);
    }
  }

  function pickSuggestion(s: string, i: number) {
    setText(s);
    setSelectedIdx(i);
    if ((navigator as any).vibrate) (navigator as any).vibrate(3);
  }

  async function saveToVaultAndConfidence() {
    const clean = text.trim();
    if (!clean) { setErr("Write or pick an affirmation first."); return; }
    setErr(null);
    setBusySave(true);
    const row: AffirmationRow = { user_id: userId, category: active, text: clean };

    // 1) Supabase (best-effort)
    try {
      if (userId) {
        await supabase.from("affirmations").insert({ user_id: userId, category: active, text: clean });
      }
    } catch {
      // best-effort only
    }

    // 2) Local vault (always)
    await saveToVaultLocal(row);

    // 3) Send to Confidence for today’s rotation (local)
    await sendToConfidenceTodayLocal(row);

    setBusySave(false);
    if ((navigator as any).vibrate) (navigator as any).vibrate(6);
  }

  return (
    <div className="page-affirmation-builder" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header (EVA) */}
        <div className="card" style={{ position: "relative" }}>
          <h1 style={{ margin: 0 }}>Affirmation Builder</h1>
          <div className="muted">Create personal, powerful lines — then send them to Confidence.</div>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open builder help"
            title="Need a hand? Ask EVA"
            style={{
              position: "absolute", top: 8, right: 8, border: "none",
              background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10,
            }}
          >
            {imgOk ? (
              <img
                src={EVA_HELP_IMG}
                alt="EVA — open help"
                style={{ width: 44, height: 44, objectFit: "contain" }}
                onError={() => setImgOk(false)}
              />
            ) : (
              <span
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 34, height: 34, borderRadius: 999, border: "1px solid #d1d5db",
                  background: "#f9fafb", fontWeight: 700,
                }}
              >
                ?
              </span>
            )}
          </button>
        </div>

        {/* Category tabs */}
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CATS.map(c => {
            const isActive = c.key === active;
            return (
              <button
                key={c.key}
                onClick={() => { setActive(c.key); }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid",
                  borderColor: isActive ? "hsl(var(--pastel-hsl))" : "#e5e7eb",
                  background: isActive ? "hsl(var(--pastel-hsl) / .45)" : "#fff",
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
            onChange={e => { setText(e.target.value); setSelectedIdx(null); }}
            placeholder="e.g., I lead with calm, decisive action."
            aria-label="Affirmation text"
          />

          <div className="section-title">Or ask EVA</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={theme}
              onChange={e => setTheme(e.target.value)}
              placeholder="Theme (optional) — e.g., money, calm, leadership"
              aria-label="Theme for EVA"
              style={{ flex: 1, minWidth: 220 }}
            />
            <button onClick={askEva} disabled={busySuggest} className="btn-primary" style={{ borderRadius: 8 }}>
              {busySuggest ? "Thinking…" : "Ask EVA"}
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
                        borderColor: activeChip ? "hsl(var(--pastel-hsl))" : "#e5e7eb",
                        background: activeChip ? "hsl(var(--pastel-hsl) / .45)" : "#fff",
                        fontWeight: activeChip ? 700 : 500,
                        maxWidth: "100%",
                        // MOBILE: allow two+ lines instead of single-line truncation
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
            <button onClick={() => refineTone("shorter")} disabled={!text || busySuggest}>Shorter</button>
            <button onClick={() => refineTone("stronger")} disabled={!text || busySuggest}>Stronger</button>
            <button onClick={() => refineTone("gentler")} disabled={!text || busySuggest}>Gentler</button>
          </div>

          {/* Preview card */}
          <div
            aria-label="Affirmation preview"
            style={{
              padding: 18,
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              fontSize: 22,
              fontWeight: 800,
              lineHeight: 1.3,
              textAlign: "center",
            }}
          >
            {text || "Your affirmation will appear here…"}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Tip: Read it aloud once — if it feels clunky, tweak the words until it feels natural.
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {err && <div style={{ color: "red", marginRight: "auto" }}>{err}</div>}
            <button onClick={() => { setText(""); setSelectedIdx(null); }} disabled={!text}>Clear</button>
            <button onClick={saveToVaultAndConfidence} className="btn-primary" disabled={!text || busySave} style={{ borderRadius: 10 }}>
              {busySave ? "Saving…" : "Save & send to Confidence"}
            </button>
          </div>
        </div>

   

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Affirmation Builder — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {imgOk && (
            <img
              src={EVA_HELP_IMG}
              alt=""
              aria-hidden="true"
              style={{ width: 72, height: 72, flex: "0 0 auto", objectFit: "contain" }}
              onError={() => setImgOk(false)}
            />
          )}
          <div style={{ flex: 1 }}>
            <BuilderHelpContent />
          </div>
        </div>
      </Modal>
    </div>
  );
}
