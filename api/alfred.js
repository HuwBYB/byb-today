// /api/alfred.js
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      // Visit /api/alfred in your browser: should show hasKey: true
      return res.status(200).json({ ok: true, hasKey: !!process.env.OPENAI_API_KEY });
    }

    const key = process.env.OPENAI_API_KEY;
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const { persona, history } = body || {};

    const prefixMap = {
      business: "Business Alfred",
      financial: "Financial Alfred",
      health: "Health Alfred",
      friend: "Friend Alfred",
    };

    if (!key) {
      const lastUser = [...(history || [])].reverse().find(m => m.role === "user");
      const txt = lastUser?.content || "How can I help?";
      return res.status(200).json({
        reply: `${prefixMap[persona] || "Alfred"} (stub): I can't access the AI model yet. Add OPENAI_API_KEY in Vercel. Your note: “${txt.slice(0, 200)}”.`,
        stub: true
      });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: history || [], temperature: 0.4, max_tokens: 500 }),
    });

    if (!response.ok) {
      const detail = await response.text();
      // Surface the real error so we can see what's wrong
      return res.status(500).json({ error: "OpenAI error", detail });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "I'm here and ready to help.";
    res.status(200).json({ reply, stub: false });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
