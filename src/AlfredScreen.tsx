import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Mode = "business" | "finance" | "health" | "friend";
type Msg = { role: "user" | "assistant"; content: string };

const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: "business", label: "Business Advisor", emoji: "💼" },
  { key: "finance",  label: "Financial Advisor", emoji: "💷" },
  { key: "health",   label: "Health Advisor",    emoji: "💪" },
  { key: "friend",   label: "Friend",            emoji: "🧑‍🤝‍🧑" },
];

export default function AlfredScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("business");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) setErr(error.message);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // persist conversations per mode in localStorage so mobile refresh doesn't lose context
  useEffect(() => {
    const saved = localStorage.getItem(lsKey(mode));
    setMessages(saved ? JSON.parse(saved) : []);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(lsKey(mode), JSON.stringify(messages));
    // auto scroll to bottom
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
      const data = await res.json(); // expect { text: string }
      const text: string = data.text || "…";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Very simple bullet extraction for "Quick add to Today"
  const quickAdds = useMemo(() => {
    const last = [...messages].reverse().find(m => m.role === "assistant");
    if (!last) return [];
    const lines = last.content.split(/\r?\n/).map(l => l.trim());
    // pick bullet-ish lines
    const bullets = lines.filter(l =>
      /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l)
    ).map(l => l.replace(/^([-*•]\s+|\d+\.\s+)/, "").trim());
    // limit to 6 to keep UI compact
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

  return (
    <div className="two-col" style={{ alignItems: "start" }}>
      {/* Sidebar (stacks on mobile) */}
      <aside className="card sidebar-sticky" style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Alfred</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          Choose a persona
        </div>
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
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{MODES.find(m => m.key === mode)?.label}</h3>
          <span className="muted">/ chat</span>
        </div>

        {/* Messages */}
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

        {/* Quick add actions parsed from the last reply */}
        {quickAdds.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="section-title" style={{ marginBottom: 6 }}>Quick add to Today</div>
            <div style={{ display: "grid", gap: 6 }}>
              {quickAdds.map((t, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                  }}>{t}</div>
                  <button onClick={() => addToToday(t)}>＋ Add</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Composer */}
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
    </div>
  );
}

/* utils */
function toISO(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
