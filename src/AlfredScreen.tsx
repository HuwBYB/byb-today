import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type PersonaKey = "business" | "financial" | "health" | "friend";

const PERSONAS: { key: PersonaKey; label: string; system: string }[] = [
  {
    key: "business",
    label: "Business Advisor",
    system:
      "You are Alfred, a concise British-butler business adviser. Always structure replies as: **Plan (bullets)** → **Today (1–3 concrete actions)** → **This week (1–2 actions)** → **Risks & assumptions (1–3)** → **One clarification question**. Prefer UK examples (Companies House, HMRC) when relevant. Keep it brief and practical.",
  },
  {
    key: "financial",
    label: "Financial Advisor",
    system:
      "You are Alfred, a cautious British-butler personal-finance guide. Structure: **Summary** → **Today** → **This month** → **Checklist** → **One question**. Use UK terms (ISA, PAYE, HMRC). Add: “Not regulated financial advice.” Keep it clear and pragmatic.",
  },
  {
    key: "health",
    label: "Health Advisor",
    system:
      "You are Alfred, a supportive British-butler health coach. Structure: **Focus area** → **Today (1–2 habits)** → **This week** → **Pitfalls** → **One question**. Avoid diagnoses or treatment; suggest seeing a professional when appropriate. Be practical.",
  },
  {
    key: "friend",
    label: "Friend",
    system:
      "You are Alfred, a kind, encouraging friend (still a butler). Be warm and brief. Structure: **Reflection** → **Tiny next step (≤10 min)** → **Encouragement** → **One light question**.",
  },
];

// Fallback response if the serverless function isn't set up yet
function localFallbackReply(p: PersonaKey, userText: string) {
  const prefix: Record<PersonaKey, string> = {
    business: "Business Alfred",
    financial: "Financial Alfred",
    health: "Health Alfred",
    friend: "Friend Alfred",
  };
  return `${prefix[p]}: I hear you — “${userText.slice(0, 140)}”. Here’s a simple next step:\n• Write the smallest action you can take in 10 minutes and add it to Today.`;
}

type Thread = {
  id: number;
  user_id: string;
  persona: PersonaKey;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: number;
  thread_id: number;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

// ---- helpers ----
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Extract bullet-like action lines from assistant content */
function extractActionBullets(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const bullets: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Match bullets like: "-", "•", "*", or "1. ", "2) ", etc.
    const m =
      line.match(/^[-*•]\s+(.*)$/) ||
      line.match(/^\d+[\.\)]\s+(.*)$/);

    if (m && m[1]) {
      const t = m[1].trim();
      if (t.length > 2) bullets.push(t);
      continue;
    }

    // Heuristic: lines in "Today"/"This week"/"Checklist" sections may be plain
    if (/^(today|this week|checklist)\b/i.test(line)) {
      // skip section headers themselves
      continue;
    }
  }
  // Deduplicate small overlaps
  const seen = new Set<string>();
  return bullets.filter(b => {
    const key = b.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

export default function AlfredScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [persona, setPersona] = useState<PersonaKey>("business");

  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Quick-add options
  const [addAsTop, setAddAsTop] = useState<boolean>(false);
  const [addingKeys, setAddingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // Load threads for persona
  async function loadThreads(p: PersonaKey) {
    if (!userId) return;
    const { data, error } = await supabase
      .from("alfred_threads")
      .select("*")
      .eq("user_id", userId)
      .eq("persona", p)
      .order("updated_at", { ascending: false });
    if (error) { setErr(error.message); setThreads([]); return; }
    setThreads((data as Thread[]) || []);
  }
  useEffect(() => { if (userId) loadThreads(persona); }, [userId, persona]);

  // Load messages for selected thread
  async function loadMessages(threadId: number) {
    if (!userId) return;
    const { data, error } = await supabase
      .from("alfred_messages")
      .select("*")
      .eq("user_id", userId)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (error) { setErr(error.message); setMessages([]); return; }
    setMessages((data as Message[]) || []);
  }
  useEffect(() => { if (selectedThreadId) loadMessages(selectedThreadId); }, [selectedThreadId]);

  const personaLabel = useMemo(() => PERSONAS.find(p => p.key === persona)?.label || "", [persona]);

  // Start a new thread
  async function startThread(firstUserText?: string): Promise<number | null> {
    if (!userId) return null;
    const title = (firstUserText || "New conversation").slice(0, 60);
    const { data, error } = await supabase
      .from("alfred_threads")
      .insert({ user_id: userId, persona, title })
      .select()
      .single<Thread>();
    if (error) { setErr(error.message); return null; }
    await loadThreads(persona);
    setSelectedThreadId(data?.id ?? null);
    return data?.id ?? null;
  }

  // Send a message (create thread if needed), call API, save reply
  async function send() {
    const text = input.trim();
    if (!userId || !text || sending) return;
    setSending(true); setErr(null);
    try {
      let threadId = selectedThreadId;
      if (!threadId) {
        threadId = await startThread(text);
        if (!threadId) throw new Error("Could not create thread.");
      }

      // 1) store user message
      const { error: uerr } = await supabase
        .from("alfred_messages")
        .insert({ user_id: userId, thread_id: threadId, role: "user", content: text });
      if (uerr) throw uerr;
      setInput("");
      await loadMessages(threadId);

      // 2) prepare last N messages as history
      const recent = messages.slice(-14); // last 14 + new user = 15
      const history = [
        { role: "system", content: PERSONAS.find(p => p.key === persona)?.system || "" },
        ...recent.map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: text },
      ];

      // 3) call serverless function (or fallback)
      let replyText = "";
      try {
        const resp = await fetch("/api/alfred", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona, history }),
        });
        const data = await resp.json();
        replyText = data?.reply || localFallbackReply(persona, text);
      } catch {
        replyText = localFallbackReply(persona, text);
      }

      // 4) store assistant reply
      const { error: aerr } = await supabase
        .from("alfred_messages")
        .insert({ user_id: userId, thread_id: threadId, role: "assistant", content: replyText });
      if (aerr) throw aerr;

      await loadMessages(threadId);
      await loadThreads(persona);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSending(false);
    }
  }

  // New chat button
  async function newChat() {
    setSelectedThreadId(null);
    setMessages([]);
    await startThread();
  }

  // Add one suggested bullet to Today
  async function addBulletToToday(text: string, key: string) {
    if (!userId) return;
    try {
      setAddingKeys(prev => new Set(prev).add(key));
      const { error } = await supabase.from("tasks").insert({
        user_id: userId,
        title: text.slice(0, 200),
        due_date: todayISO(),
        source: "alfred",
        priority: addAsTop ? 2 : 0,
      });
      if (error) throw error;
      // stay on Alfred screen; Today will show it when user switches
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setAddingKeys(prev => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, height: "calc(100vh - 140px)" }}>
      {/* Left: persona & threads */}
      <div className="card" style={{ overflow: "auto" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="section-title">Choose Alfred mode</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {PERSONAS.map(p => (
              <button
                key={p.key}
                onClick={() => { setPersona(p.key); setSelectedThreadId(null); setMessages([]); }}
                style={{
                  padding: "6px 8px",
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  background: persona === p.key ? "#eef3ff" : "#fff",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button onClick={newChat} className="btn-primary" style={{ padding: "8px 10px", borderRadius: 6 }}>
            + New Conversation
          </button>

          <div className="section-title">Conversations</div>
          <ul className="list">
            {threads.length === 0 ? (
              <li className="muted">No conversations yet.</li>
            ) : (
              threads.map((t) => (
                <li key={t.id} style={{ marginBottom: 6 }}>
                  <button
                    onClick={() => setSelectedThreadId(t.id)}
                    style={{
                      width: "100%", textAlign: "left",
                      border: "1px solid #eee", borderRadius: 6, padding: 8,
                      background: selectedThreadId === t.id ? "#f5f5f5" : "#fff",
                    }}
                  >
                    {t.title || "(untitled)"}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* Right: messages */}
      <div className="card" style={{ display: "grid", gridTemplateRows: "auto auto 1fr auto", gap: 10 }}>
        {/* Header (trimmed) */}
        <h2 style={{ margin: 0, fontSize: 18 }}>Alfred — {personaLabel}</h2>

        {/* Quick-add prefs */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={addAsTop} onChange={(e) => setAddAsTop(e.target.checked)} />
            Add as Top Priority
          </label>
          <span className="muted">Add actions straight to Today from Alfred’s bullets.</span>
        </div>

        {/* Messages */}
        <div style={{ overflow: "auto", paddingRight: 4 }}>
          {selectedThreadId == null && (
            <div className="muted" style={{ marginBottom: 8 }}>
              Start a conversation or pick one on the left.
            </div>
          )}

          {messages.map((m) => {
            const isAssistant = m.role === "assistant";
            const bullets = isAssistant ? extractActionBullets(m.content) : [];
            return (
              <div key={m.id} style={{ marginBottom: 14 }}>
                <div className="muted" style={{ marginBottom: 4 }}>{isAssistant ? "Alfred" : "You"}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>

                {isAssistant && bullets.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="section-title">Quick add to Today</div>
                    <ul className="list">
                      {bullets.map((b, idx) => {
                        const key = `${m.id}-${idx}`;
                        const adding = addingKeys.has(key);
                        return (
                          <li key={key} className="item">
                            <div style={{ flex: 1 }}>{b}</div>
                            <button
                              onClick={() => addBulletToToday(b, key)}
                              disabled={adding}
                              className="btn-primary"
                              style={{ padding: "6px 10px", borderRadius: 8 }}
                              title={addAsTop ? "Add as Top Priority today" : "Add to today"}
                            >
                              {adding ? "Adding…" : "＋ Add to Today"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
          {sending && <div style={{ fontStyle: "italic", color: "#666" }}>Alfred is typing…</div>}
        </div>

        {/* Composer */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Ask Alfred…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            style={{ flex: 1, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />
          <button onClick={send} disabled={sending || !input.trim()} className="btn-primary" style={{ padding: "10px 14px", borderRadius: 8 }}>
            Send
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>
    </div>
  );
}
