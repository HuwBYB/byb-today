// /api/alfred.js
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hasKey: !!process.env.OPENAI_API_KEY });
    }

    const key = process.env.OPENAI_API_KEY;
    // Be permissive about incoming payload shape
    const body = typeof req.body === "object" ? (req.body || {}) : JSON.parse(req.body || "{}");

    // Accept multiple field names from different callers
    const persona = (body.persona || body.mode || "business").toString().toLowerCase();
    const historyIn = body.history || body.messages || null;
    const promptIn = body.prompt || body.q || body.text || null;

    // Build a messages array no matter what the caller sent
    let messages = [];
    if (Array.isArray(historyIn)) {
      messages = historyIn;
    } else if (typeof promptIn === "string" && promptIn.trim()) {
      messages = [{ role: "user", content: promptIn.trim() }];
    } else {
      // last-resort default
      messages = [{ role: "user", content: "Help me turn this into short, strong, positive actions." }];
    }

    // If no API key, return a friendly stub (status 200 so UI doesn't ‘error’)
    if (!key) {
      const lastUser = [...messages].reverse().find(m => m.role === "user");
      const txt = lastUser?.content || "How can I help?";
      return res.status(200).json({
        reply: `Alfred (stub): I can't access the AI model yet. Add OPENAI_API_KEY in Vercel. Your note: “${String(txt).slice(0, 200)}”.`,
        text:  `Alfred (stub): I can't access the AI model yet. Add OPENAI_API_KEY in Vercel. Your note: “${String(txt).slice(0, 200)}”.`,
        stub: true
      });
    }

    // Persona -> system prompt
    const personaSystem = {
      business:
        "You are Alfred, a concise, supportive Business coach. Return short bullet-worthy lines. Prefer active voice, present tense. Avoid fluff.",
      financial:
      "You are Alfred, a concise, supportive Financial coach. Focus on practical, ethical, near-term actions; avoid personalized financial advice disclaimers.",
      finance:
        "You are Alfred, a concise, supportive Financial coach. Focus on practical, ethical, near-term actions; avoid personalized financial advice disclaimers.",
      health:
        "You are Alfred, a concise, supportive Health coach. Keep it safe, general, and habit-focused. No medical claims.",
      friend:
        "You are Alfred, a kind, motivating friend. Encourage, keep it simple, and celebrate small wins.",
    };

    const systemMsg = personaSystem[persona] || personaSystem.business;

    // Ensure system message appears first
    const messagesWithSystem = [{ role: "system", content: systemMsg }, ...messages];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: messagesWithSystem,
        temperature: 0.4,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const detailText = await safeReadText(response);
      // Return 200 with stub=false? Better to surface 500 so you notice in logs.
      return res.status(500).json({ error: "OpenAI error", status: response.status, detail: detailText });
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim?.() ||
      "I'm here and ready to help.";
    // Return both keys so any caller shape works
    return res.status(200).json({ reply, text: reply, stub: false });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

async function safeReadText(resp) {
  try { return await resp.text(); } catch { return "<no body>"; }
}
