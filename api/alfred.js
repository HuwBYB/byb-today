// Vercel Serverless Function (Node runtime)
// Expects JSON: { persona: "business"|"financial"|"health"|"friend", history: [{role,content}, ...] }
module.exports = async (req, res) => {
  try {
    const key = process.env.OPENAI_API_KEY;
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const { persona, history } = body || {};

    // If no key, return a friendly stub so the UI still works
    if (!key) {
      const lastUser = [...(history || [])].reverse().find(m => m.role === "user");
      const txt = lastUser?.content || "How can I help?";
      const prefixMap = {
        business: "Business Alfred",
        financial: "Financial Alfred",
        health: "Health Alfred",
        friend: "Friend Alfred",
      };
      return res.status(200).json({
        reply: `${prefixMap[persona] || "Alfred"} (stub): I can't access the AI model yet, but here's a next step: write a 10-minute action and add it to Today. Your note: “${txt.slice(0, 200)}”`,
      });
    }

    // Call OpenAI Chat Completions (simple, safe defaults)
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: history || [],
        temperature: 0.4,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: "OpenAI error", detail: text });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "I'm here and ready to help.";
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
