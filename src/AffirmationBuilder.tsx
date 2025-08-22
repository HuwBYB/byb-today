import { useEffect, useRef, useState, type ReactNode } from "react";
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
const ALFRED_SRC = publicPath("/alfred/Confidence_Alfred.png");

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
const LS_CONF_TODAY = "byb:confidence:today";

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

/* ---------- Alfred help content ---------- */
function BuilderHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Craft affirmations that feel like you — short, present-tense, and believable — then send them to the Confidence page to practice.</em></p>

      <h4 style={{ margin: 0 }}>How to use</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pick an area</b>: Business, Relationships, Financial, Personal, or Health.</li>
        <li><b>Write your own</b> or click <i>Ask Alfred</i> for 2–3 suggestions.</li>
        <li><b>Tweak tone</b> with one-taps: Shorter, Stronger, Gentler.</li>
        <li><b>Say it aloud</b> — does it land? If not, adjust until it does.</li>
        <li><b>Save</b> to your vault and <b>Send to Confidence</b> for today’s practice.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Good affirmation rules</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Keep it <b>present tense</b> (“I lead with clarity”).</li>
        <li>Make it <b>short</b> (ideally under 12 words).</li>
        <li>Focus on what’s <b>in your control</b> (“I show up daily”).</li>
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Tip: If a line feels fake, nudge the tone gentler or more specific until it’s believable.
      </p>
    </div>
  );
}

/* ---------- Utils ---------- */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function speakText(t: string) {
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.rate = 0.98; u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {}
}
async function saveToVaultLocal(row: AffirmationRow) {
  try {
    const arr: AffirmationRow[] = JSON.parse(localStorage.getItem(LS_VAULT) || "[]");
    arr.unshift({ ...row, created_at: new Date().toISOString() });
    localStorage.setItem(LS_VAULT, JSON.stringify(arr));
  } catch {}
}
async function sendToConfidenceTodayLocal(row: AffirmationRow) {
  try {
    const key = `${LS_CONF_TODAY}:${todayISO()}`;
    const arr: AffirmationRow[] = JSON.parse(localStorage.getItem(key) || "[]");
    const exists = arr.some(a => a.category === row.category && a.text.trim() === row.text.trim());
    if (!exists) {
      arr.push(row);
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch {}
}

/* =========================================================
   PAGE
   ========================================================= */
export default function AffirmationBuilderScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [active, setActive] = useState<Category>("business");

  const [text, setText] = useState("");
  const [theme, setTheme] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selIdx, setSelIdx] = useState<number | null>(null); // highlight selected suggestion
  const [busySuggest, setBusySuggest] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  // Speak toggle
  const [speak, setSpeak] = useState(false);
  const lastSpokenRef = useRef(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Speak on change if enabled (debounced-ish)
  useEffect(() => {
    if (!speak || !text.trim()) return;
    const now = Date.now();
    if (now - lastSpokenRef.current < 900) return;
    lastSpokenRef.current = now;
    speakText(text);
  }, [text, speak]);

  const CATS: { key: Category; label: string }[] = [
    { key: "business", label: "Business" },
    { key: "relationships", label: "Relationships" },
    { key: "financial", label: "Financial" },
    { key: "personal", label: "Personal" },
    { key: "health", label: "Health" },
  ];

  async function askAlfred() {
    setErr(null);
    setSelIdx(null);
    setBusySuggest(true);
    try {
      const prompt =
`Give me 3 short, present-tense affirmations for "${active}".
Theme (optional): ${theme || "(none)"}.
Rules: under 12 words, positive, believable, in my control.
Output as bullet points only.`;
      const res = await fetch("/api/alfred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "friend", messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Alfred error: ${res.status}`);
      const data = await res.json();
      const textResp: string = data.text || data.reply || "";
      const lines = textResp.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const bulls = lines
        .filter(l => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l))
        .map(l => l.replace(/^([-*•]\s+|\d+\.\s+)/, "").trim());
      const opts = (bulls.length ? bulls : lines).slice(0, 3);
      setSuggestions(opts);
      if (opts[0]) { setText(opts[0]); setSelIdx(0); }
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusySuggest(false);
    }
  }

  async function refineTone(kind: "shorter" | "stronger" | "gentler") {
    if (!text.trim()) return;
    setErr(null);
    setBusySuggest(true);
    setSelIdx(null);
    try {
      const prompt =
`Rewrite this affirmation with a ${kind} tone.
Keep present tense, positive, believable, under 12 words:
"${text}"`;
      const res = await fetch("/api/alfred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "friend", messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Alfred error: ${res.status}`);
      const data = await res.json();
      const out = (data.text || data.reply || "").trim().split(/\r?\n/).find(Boolean) || "";
      if (out) setText(out.replace(/^"|"$/g, ""));
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusySuggest(false);
    }
  }

  async function saveToVaultAndConfidence() {
    const clean = text.trim();
    if (!clean) { setErr("Write or pick an affirmation first."); return; }
    setErr(null);
    setBusySave(true);
    const row: AffirmationRow = { user_id: userId, category: active, text: clean };

    try {
      if (userId) {
        await supabase.from("affirmations").insert({ user_id: userId, category: active, text: clean });
      }
    } catch {
      // non-fatal: local fallback covers it
    } finally {
      await saveToVaultLocal(row);
      await sendToConfidenceTodayLocal(row);
      setBusySave(false);
      setSavedToast("Saved to vault and sent to Confidence for today ✅");
      setTimeout(() => setSavedToast(null), 2200);
      if ((navigator as any).vibrate) (navigator as any).vibrate(6);
    }
  }

  function pickSuggestion(s: string, idx: number) {
    setText(s);
    setSelIdx(idx);
    if ((navigator as any).vibrate) (navigator as any).vibrate(3);
  }

  return (
    <div className="page-affirmation-builder" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <style>{CSS_LOCAL}</style>

      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header with Alfred help */}
        <div className="card" style={{ position: "relative", paddingRight: 64 }}>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open builder help"
            title="Need a hand? Ask Alfred"
            style={{ position: "absolute", top: 8, right: 8, border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10 }}
          >
            {imgOk ? (
              <img src={ALFRED_SRC} alt="Alfred — open help" style={{ width: 48, height: 48 }} onError={() => setImgOk(false)} />
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700 }}>?</span>
            )}
          </button>
          <h1 style={{ margin: 0 }}>Affirmation Builder</h1>
          <div className="muted">Create personal, powerful lines — then send them to Confidence.</div>
        </div>

        {/* Category tabs */}
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CATS.map(c => {
            const activeCat = c.key === active;
            return (
              <button
                key={c.key}
                onClick={() => { setActive(c.key); setSelIdx(null); }}
                className={activeCat ? "pill active" : "pill"}
                aria-pressed={activeCat}
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
            onChange={e => { setText(e.target.value); setSelIdx(null); }}
            placeholder="e.g., I lead with calm, decisive action."
            aria-label="Affirmation text"
          />

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={speak} onChange={e => setSpeak(e.target.checked)} />
              Speak aloud while editing
            </label>
            {err && <span style={{ color: "red", marginLeft: "auto" }}>{err}</span>}
          </div>

          <div className="section-title">Or ask Alfred</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={theme}
              onChange={e => setTheme(e.target.value)}
              placeholder={`Theme (optional) — e.g., money, calm, leadership`}
              aria-label="Theme for Alfred"
              style={{ flex: 1, minWidth: 220 }}
            />
            <button onClick={askAlfred} disabled={busySuggest} className="btn-primary" style={{ borderRadius: 8 }}>
              {busySuggest ? "Thinking…" : "Ask Alfred"}
            </button>
          </div>

          {!!suggestions.length && (
            <div style={{ display: "grid", gap: 8 }}>
              <div className="muted">Suggestions (tap to select)</div>
              <div className="suggest-grid">
                {suggestions.map((s, i) => {
                  const activeS = selIdx === i;
                  return (
                    <button
                      key={i}
                      onClick={() => pickSuggestion(s, i)}
                      className={activeS ? "suggest active" : "suggest"}
                      title="Use this"
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
            className="preview"
          >
            {text || "Your affirmation will appear here…"}
          </div>

          {/* Big CTA */}
          <div>
            <button
              onClick={saveToVaultAndConfidence}
              className="btn-primary cta"
              disabled={!text || busySave}
              title="Save to vault and send to Confidence"
            >
              {busySave ? "Saving…" : "Save & send to Confidence"}
            </button>
            {savedToast && <div className="toast">{savedToast}</div>}
          </div>
        </div>
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Affirmation Builder — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {imgOk && <img src={ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
          <div style={{ flex: 1 }}>
            <BuilderHelpContent />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Local visual tweaks ---------- */
const CSS_LOCAL = `
.pill{
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: #fff;
}
.pill.active{
  background: hsl(var(--pastel-hsl, 210 95% 78%) / .45);
  border-color: hsl(var(--pastel-hsl, 210 95% 78%));
}

.suggest-grid{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
}
.suggest{
  text-align: left;
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 12px;
  padding: 10px 12px;
  line-height: 1.2;
}
.suggest.active{
  background: #111;
  color: #fff;
  border-color: #111;
}

.preview{
  padding: 18px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.3;
  text-align: center;
}

.cta{
  display: block;
  width: 100%;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 16px;
  font-weight: 700;
}

.toast{
  margin-top: 8px;
  font-size: 12px;
  color: #065f46;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  padding: 6px 8px;
  border-radius: 8px;
}
`;
