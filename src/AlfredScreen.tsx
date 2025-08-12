import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type PersonaKey = "business" | "financial" | "health" | "friend";

const PERSONAS: { key: PersonaKey; label: string; system: string }[] = [
  {
    key: "business",
    label: "Business Advisor",
    system:
      "You are Alfred, a concise, practical business adviser with a British butler's manners. Give clear step-by-step plans, prioritise impact, and keep replies brief. Ask one clarifying question only when essential.",
  },
  {
    key: "financial",
    label: "Financial Advisor",
    system:
      "You are Alfred, a cautious personal finance guide with a British butler's tone. Explain simply, note assumptions, and include a brief risk/next-step checklist. You are not a regulated adviser; add a one-line disclaimer.",
  },
  {
    key: "health",
    label: "Health Advisor",
    system:
      "You are Alfred, a supportive health coach with a British butler's tact. Focus on habits, sleep, movement, nutrition, stress. Avoid diagnoses; advise seeing a professional when appropriate. Keep it practical.",
  },
  {
    key: "friend",
    label: "Friend",
    system:
      "You are Alfred, a kind, encouraging friend (still a butler!). Be warm, reflective, and solution-focused. Keep it light but useful.",
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

export default function AlfredScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [persona, setPersona] = useState<PersonaKey>("business");

  const [threads, setThreads] = useState<any[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    setThreads(data || []);
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
    setMessages(data || []);
  }
  useEffect(() => { if (selectedThreadId) loadMessages(selectedThreadId); }, [selectedThreadId]);

  const personaLabel = useMemo(() => PERSONAS.find(p => p.key === persona)?.label || "", [persona]);

  // Start a new thread
  async function startThread(firstUserText?: string) {
    if (!userId) return;
    const title = (firstUserText || "New conversation").slice(0, 60);
    const { data, error } = await supabase
      .from("alfred_threads")
      .insert({ user_id: userId, persona, title })
      .select()
      .single();
    if (error) { setErr(error.message); return null; }
    await loadThreads(persona);
    setSelectedThreadId(data.id);
    return data.id as number;
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
      const recent = messages.slice(-14); // keep last 14 + this new one = 15
      const history = [
        { role: "system", content: PERSONAS.find(p => p.key === persona)?.system || "" },
        ...recent.map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: text },
      ];

      // 3) call serverless function (or fallback if not configured)
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, height: "calc(100vh - 140px)" }}>
      {/* Left: persona & threads */}
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10, overflow: "auto" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#666" }}>Choose Alfred mode</div>
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

          <button onClick={newChat} style={{ padding: "8px 10px", border: "1px solid #333", borderRadius: 6 }}>
            + New Conversation
          </button>

          <div style={{ fontSize: 12, color: "#666" }}>Conversations</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {threads.length === 0 ? (
              <li style={{ color: "#666" }}>No conversations yet.</li>
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
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Alfred — {personaLabel}</h2>
          <div style={{ fontSize: 12, color: "#666" }}>
            Conversations are kept separate by mode.
          </div>
        </div>

        <div style={{ overflow: "auto", paddingRight: 4 }}>
          {selectedThreadId == null && (
            <div style={{ color: "#666", marginBottom: 8 }}>
              Start a conversation or pick one on the left.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#666" }}>{m.role === "assistant" ? "Alfred" : "You"}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
            </div>
          ))}
          {sending && <div style={{ fontStyle: "italic", color: "#666" }}>Alfred is typing…</div>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Ask Alfred…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            style={{ flex: 1, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />
          <button onClick={send} disabled={sending || !input.trim()} style={{ padding: "10px 14px", border: "1px solid #333", borderRadius: 8 }}>
            Send
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>
    </div>
  );
}
