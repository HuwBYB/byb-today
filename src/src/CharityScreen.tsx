// src/CharityScreen.tsx
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/** Types for suggestion form */
type Suggestion = {
  name: string;
  website: string;
  reason: string;
};

export default function CharityScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState<Suggestion>({
    name: "",
    website: "",
    reason: "",
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function submitSuggestion(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);

    const name = form.name.trim();
    const website = form.website.trim();
    const reason = form.reason.trim();

    if (!name || !reason) {
      setErr("Please provide at least the charity name and why you recommend it.");
      return;
    }

    try {
      setSending(true);
      // Use existing events_audit table to capture suggestions (no new schema needed)
      const payload = { name, website, reason, app_version: "v1", source: "charity_page" };
      const { error } = await supabase.from("events_audit").insert({
        user_id: userId,                // can be null if not logged in; your RLS likely requires a user, but keep it here
        event_type: "charity_suggestion",
        payload,
      });
      if (error) throw error;

      setMsg("Thanks! We’ve received your suggestion and will consider it.");
      setForm({ name: "", website: "", reason: "" });
    } catch (e: any) {
      setErr(e.message || "Something went wrong. Please try again later.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page-charity" style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="card" style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0 }}>Our Charity Pledge</h1>
        <div className="muted">Making progress together — in life and in the world.</div>
      </div>

      {/* Pledge */}
      <section className="card" style={{ display: "grid", gap: 12, padding: 16 }}>
        <h3 style={{ margin: 0 }}>What we pledge</h3>
        <p style={{ margin: 0 }}>
          We donate <strong>10% of profits</strong> — defined as revenue after all costs — to
          registered charities. As Best You Blueprint grows, our ability to give grows too.
        </p>
        <p style={{ margin: 0 }}>
          Donations are <strong>split evenly</strong> among the charities listed below. From time to
          time we may review and update this list.
        </p>
      </section>

      {/* Charities list */}
      <section className="card" style={{ display: "grid", gap: 12, padding: 16 }}>
        <h3 style={{ margin: 0 }}>Current charities we support</h3>

        <ul className="list" style={{ display: "grid", gap: 8 }}>
          <li className="item" style={{ alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Alzheimer’s Society</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Registered charity in England &amp; Wales: 296645
            </div>
          </li>

          <li className="item" style={{ alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>NSPCC (National Society for the Prevention of Cruelty to Children)</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Registered charity in England &amp; Wales: 216401 · Scotland: SC037717
            </div>
          </li>

          <li className="item" style={{ alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Dogs Trust</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Registered charity in England &amp; Wales: 1167663 · Scotland: SC053144
            </div>
          </li>

          <li className="item" style={{ alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>The Trussell Trust</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Registered charity in England &amp; Wales: 1110522 · Scotland: SC044246
            </div>
          </li>
        </ul>

        <div className="muted" style={{ fontSize: 12 }}>
          Logos are not displayed here. We’ll add them if/when permission is granted by each charity.
        </div>
      </section>

      {/* Suggest a charity */}
      <section className="card" style={{ display: "grid", gap: 12, padding: 16 }}>
        <h3 style={{ margin: 0 }}>Suggest a charity</h3>
        <p style={{ margin: 0 }}>
          We welcome suggestions from our community. We <strong>can’t promise</strong> to include every
          charity, but all suggestions are reviewed and considered as we evolve our giving.
        </p>

        <form onSubmit={submitSuggestion} style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Charity name *</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              placeholder="e.g., Mind, British Red Cross"
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span>Website (optional)</span>
            <input
              type="url"
              inputMode="url"
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="https://example.org"
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span>Why are you recommending them? *</span>
            <textarea
              rows={4}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              required
              placeholder="A short note about their impact or why they matter to you…"
            />
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={sending}
              style={{ borderRadius: 8 }}
            >
              {sending ? "Sending…" : "Submit suggestion"}
            </button>
            <a
              className="btn-soft"
              href={`mailto:support@bestyoublueprint.net?subject=Charity%20suggestion&body=${encodeURIComponent(
                `Charity name: ${form.name}\nWebsite: ${form.website}\nReason: ${form.reason}\n\n(If the in-app submit doesn't work for you, email us here.)`
              )}`}
              title="Email your suggestion"
            >
              Or email us
            </a>

            {msg && <div style={{ color: "green", marginLeft: "auto" }}>{msg}</div>}
            {err && <div style={{ color: "red", marginLeft: "auto" }}>{err}</div>}
          </div>
        </form>

        <div className="muted" style={{ fontSize: 12 }}>
          By submitting, you agree we may store and review your suggestion. We may contact you if we
          need any further information.
        </div>
      </section>

      {/* Footer note */}
      <div className="muted" style={{ textAlign: "center", fontSize: 12 }}>
        Questions? Contact{" "}
        <a href="mailto:support@bestyoublueprint.net">support@bestyoublueprint.net</a>.
      </div>

      <div style={{ height: 24 }} />
    </div>
  );
}
