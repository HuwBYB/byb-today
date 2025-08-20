import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

type Mode = "business" | "finance" | "health" | "friend";
type Msg = { role: "user" | "assistant"; content: string };

const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: "business", label: "Business Advisor", emoji: "💼" },
  { key: "finance",  label: "Financial Advisor", emoji: "💷" },
  { key: "health",   label: "Health Advisor",    emoji: "💪" },
  { key: "friend",   label: "Friend",            emoji: "🧑‍🤝‍🧑" },
];

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

/* Try multiple filenames (underscore vs space, formats) */
const ALFRED_CANDIDATES = [
  "/alfred/Today_Alfred.png",
  "/alfred/Today Alfred.png",
  "/alfred/Today_Alfred.webp",
  "/alfred/Today Alfred.webp",
  "/alfred/Today_Alfred.jpg",
  "/alfred/Today Alfred.jpg",
].map(publicPath);

/* ---------- Modal ---------- */
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => { if (open && closeRef.current) closeRef.current?.focus(); }, [open]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 2000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, width: "100%", background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Alfred help content ---------- */
function AlfredHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Alfred turns vague thoughts into clear next actions — and can drop them straight onto Today.</em></p>

      <h4 style={{ margin: 0 }}>How to use Alfred</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pick a persona</b>: Business, Finance, Health, or Friend. This nudges Alfred’s tone and focus.</li>
        <li><b>Ask clearly</b>: “Help me plan 3 sales actions for today.” “Draft a 20-minute strength plan.”</li>
        <li><b>Quick add</b>: Alfred’s bullet points appear under the chat. Click <i>＋ Add</i> to send them to Today.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Prompts that work well</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>“Prioritise my top 5 tasks for the day based on urgency and impact.”</li>
        <li>“Turn this into steps: launch email campaign for Product A.”</li>
        <li>“Health: give me a 30-min gym plan (dumbbells only).”</li>
        <li>“Friend: I’m overwhelmed; help me pick one easy win.”</li>
      </ul>

      <h4 style={{ margin: 0 }}>Tips from Alfred</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Ask for numbered lists to get clean <b>Quick add</b> bullets.</li>
        <li>Finish with “restrict to today” if you only want immediate actions.</li>
        <li>Use the Friend persona when you need encouragement, not just a plan.</li>
      </ul>

      <h4 style={{ margin: 0 }}>Privacy & limits</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Your messages here are stored locally for each persona so you don’t lose context on refresh.</li>
        <li>アルフレッド won’t see your private data unless you paste it here.</li>
        <li>Always sanity-check advice, especially finance/health.</li>
      </ul>

      <p><strong>Bottom line:</strong> Chat, capture the bullets, and move — Alfred is your friction-free bridge to action.</p>
    </div>
  );
}

export default function AlfredScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("business");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Help modal
  const [showHelp, setShowHelp] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const src = ALFRED_CANDIDATES[imgIdx] ?? "";
  const [imgOk, setImgOk] = useState(true);

  // auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) setErr(error.message);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // persist conversations per mode
  useEffect(() => {
    const saved = localStorage.getItem(lsKey(mode));
    setMessages(saved ? JSON.parse(saved) : []);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(lsKey(mode), JSON.stringify(messages));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mode]);

  function lsKey(m: Mode) { return `alfred:conv:${m}`; }

  async function send() {
    const q = input.trim();
    if (!q) return;
    setErr(null);
    setBusy(true);
    const newMsgs = [...messages, { role: "user", content: q } as Msg];
    setMessages(newMsgs);
    setInput("");

    try {
      const res = await fetch("/api/alfred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: newMsgs }),
      });
      if (!res.ok) throw new Error(`Alfred error: ${res.status}`);
      const data = await res.json();
      const text: string = data.text || "…";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Quick add bullets
  const quickAdds = useMemo(() => {
    const last = [...messages].reverse().find(m => m.role === "assistant");
    if (!last) return [];
    const lines = last.content.split(/\r?\n/).map(l => l.trim());
    const bullets = lines.filter(l => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l))
      .map(l => l.replace(/^([-*•]\s+|\d+\.\s+)/, "").trim());
    return bullets.slice(0, 6);
  }, [messages]);

  async function addToToday(title: string) {
    if (!userId) { setErr("Not signed in."); return; }
    const iso = toISO(new Date());
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title,
      due_date: iso,
      priority: 3,
      source: "alfred",
    });
    if (error) setErr(error.message);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy) send();
    }
  }

  // a11y: open on Enter/Space for the custom button
  function onHelpKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setShowHelp(true);
    }
  }

  return (
    <div className="two-col" style={{ alignItems: "start" }}>
      {/* Sidebar (stacks on mobile) — help control pinned */}
      <aside className="card sidebar-sticky" style={{ position: "relative", display: "grid", gap: 8, paddingRight: 64 }}>
        <div
          role="button"
          tabIndex={0}
          aria-label="Open Alfred help"
          title="Need a hand? Ask Alfred"
          onClick={() => setShowHelp(true)}
          onKeyDown={onHelpKey}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            cursor: "pointer",
            background: "transparent",
            outline: "none",
            border: "none",
            lineHeight: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {imgOk && src ? (
            <img
              src={src}
              alt="Alfred — open help"
              draggable={false}
              style={{
                display: "block",
                width: "auto",
                height: "auto",
                maxWidth: 44,
                maxHeight: 44,
                objectFit: "contain",
                background: "transparent",
                border: "none",
              }}
              onError={() => {
                if (imgIdx < ALFRED_CANDIDATES.length - 1) setImgIdx(i => i + 1);
                else setImgOk(false);
              }}
            />
          ) : (
            <span
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: 8,
                border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700,
              }}
            >
              ?
            </span>
          )}
        </div>

        <h2 style={{ margin: 0 }}>Alfred</h2>
        <div className="muted" style={{ fontSize: 12 }}>Choose a persona</div>
        <div style={{ display: "grid", gap: 6 }}>
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={mode === m.key ? "btn-primary" : ""}
              style={{ borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}
            >
              <span aria-hidden>{m.emoji}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat pane */}
      <main className="card" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, minHeight: 360 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{MODES.find(m => m.key === mode)?.label}</h3>
          <span className="muted">/ chat</span>
        </div>

        <div ref={scrollRef} style={{ overflowY: "auto", maxHeight: "50vh", paddingRight: 4 }}>
          {messages.length === 0 && (
            <div className="muted">
              Ask me anything. Tip: “Help me plan my next 3 sales actions today.”
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                background: m.role === "assistant" ? "#f8fafc" : "#eef2ff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10
              }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  {m.role === "assistant" ? "Alfred" : "You"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
          </div>
        </div>

        {quickAdds.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="section-title" style={{ marginBottom: 6 }}>Quick add to Today</div>
            <div style={{ display: "grid", gap: 6 }}>
              {quickAdds.map((t, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</div>
                  <button onClick={() => addToToday(t)}>＋ Add</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          {err && <div style={{ color: "red" }}>{err}</div>}
          <textarea
            rows={3}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type your question… (Shift+Enter for newline)"
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setMessages([])} disabled={busy}>Clear</button>
            <button className="btn-primary" onClick={send} disabled={busy || !input.trim()} style={{ borderRadius: 10 }}>
              {busy ? "Thinking…" : "Send"}
            </button>
          </div>
        </div>
      </main>

      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Alfred — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {src && (
            <img
              src={src}
              alt=""
              aria-hidden="true"
              style={{
                display: "block",
                width: "auto",
                height: "auto",
                maxWidth: 72,
                maxHeight: 72,
                objectFit: "contain",
                flex: "0 0 auto",
              }}
              onError={() => {
                if (imgIdx < ALFRED_CANDIDATES.length - 1) setImgIdx(i => i + 1);
                else setImgOk(false);
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <AlfredHelpContent />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* utils */
function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
