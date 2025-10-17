// src/TermsScreen.tsx
import React from "react";

function formatToday() {
  // UK format, e.g. 17 Oct 2025
  const d = new Date();
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function TermsScreen() {
  const today = formatToday();

  return (
    <div className="page-terms" style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="card" style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0 }}>Terms &amp; Conditions</h1>
        <div className="muted">
          Effective: {today} · Last updated: {today}
        </div>
      </div>

      {/* Body */}
      <article className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gap: 16,
            maxHeight: "70vh",
            overflow: "auto",
            scrollBehavior: "smooth",
          }}
        >
          <p>
            These Terms of Use (“Terms”) form an agreement between you (“the
            user”) and the operator of the Best You Blueprint app (“we”, “us”,
            or “our”). By downloading or using the app you agree to these Terms.
            If you do not agree, please delete the app and discontinue use.
          </p>

          <h3 id="who-we-are">1. Who we are</h3>
          <p>
            Best You Blueprint is operated by an independent developer based in
            the United Kingdom. Future updates may identify a named company or
            operator, which will be reflected within the app and on our website
            if applicable.
          </p>

          <h3 id="purpose">2. Purpose of the app</h3>
          <p>
            Best You Blueprint (“BYB”) is a wellbeing and productivity
            application designed to help users reflect, plan, and build healthy
            daily habits. It is <strong>not</strong> medical, psychological, or
            therapeutic advice. If you have mental-health or physical-health
            concerns, please seek help from a qualified professional.
          </p>

          <h3 id="eligibility">3. Eligibility</h3>
          <p>
            You must be at least 16 years old to use BYB. If you are under 18,
            you must have parental or guardian consent. By using the app, you
            confirm you meet these requirements.
          </p>

          <h3 id="accounts">4. User accounts</h3>
          <p>
            Some features require you to create an account. You are responsible
            for keeping your login credentials secure and for all activity under
            your account. You agree to provide accurate information and to
            notify us of any unauthorised use.
          </p>

          <h3 id="subscriptions">5. Subscriptions &amp; payments</h3>
          <p>
            BYB may offer free trials and paid subscriptions.
            <br />
            <strong>Price:</strong> £2.99 per month after a one-month free trial
            (or local currency equivalent).
            <br />
            <strong>Billing:</strong> Managed through Apple App Store or Google
            Play Store.
            <br />
            <strong>Cancellation:</strong> You can cancel anytime through your
            store account settings before renewal. Refunds are handled directly
            by Apple or Google in accordance with their respective policies.
          </p>

          <h3 id="content">6. User content &amp; ownership</h3>
          <p>
            You retain ownership of all notes, goals, ideas, journals, and other
            content you create in BYB. We do not claim rights over your content
            and will not sell or share it. By saving data in the app, you grant
            us permission to store and process it solely to operate and improve
            the service.
          </p>

          <h3 id="privacy">7. Data protection &amp; privacy</h3>
          <p>
            We comply with the UK GDPR and other applicable data-protection
            laws. Your data is securely stored using trusted cloud providers
            (for example, Supabase). You may request a copy of your data or
            permanent deletion by contacting us at{" "}
            <a href="mailto:support@bestyoublueprint.net">
              support@bestyoublueprint.net
            </a>
            . Our separate Privacy Policy explains how we collect, use, and
            protect your information.
          </p>

          <h3 id="acceptable-use">8. Acceptable use</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Do not use the app for unlawful, abusive, or exploitative purposes.</li>
            <li>Do not attempt to copy, reverse-engineer, or resell any part of BYB.</li>
            <li>Do not upload content that is harmful, threatening, or violates others’ rights.</li>
          </ul>
          <p>We may suspend or close accounts that breach these Terms.</p>

          <h3 id="eva">9. Eva &amp; information disclaimer</h3>
          <p>
            Some features use Eva – a digital wellbeing assistant – to provide
            supportive prompts or reflections. Eva is designed to inspire and
            encourage, <strong>not</strong> to replace medical, therapeutic,
            financial, or legal advice. You remain fully responsible for any
            actions or decisions taken as a result of using the app.
          </p>

          <h3 id="liability">10. Limitation of liability</h3>
          <p>
            BYB is provided “as is”. While we aim for reliability, we cannot
            guarantee uninterrupted service or error-free content. To the
            fullest extent permitted by law, we are not liable for any loss,
            damage, or injury arising from use of BYB. Your wellbeing decisions
            remain your own responsibility.
          </p>

          <h3 id="termination">11. Termination</h3>
          <p>
            You may stop using BYB at any time. We may suspend or terminate
            accounts that breach these Terms or misuse the service.
          </p>

          <h3 id="changes">12. Changes to the app or Terms</h3>
          <p>
            We may update features, pricing, or these Terms to reflect
            improvements or legal requirements. Changes will take effect when
            posted in the app. Continued use means you accept the updated Terms.
          </p>

          <h3 id="law">13. Governing law</h3>
          <p>
            These Terms are governed by the laws of England and Wales, and
            disputes will be handled exclusively in the English courts.
          </p>

          <h3 id="contact">14. Contact</h3>
          <p>
            For questions about these Terms or to exercise data rights, please
            contact:
            <br />
            <strong>Email:</strong>{" "}
            <a href="mailto:support@bestyoublueprint.net">
              support@bestyoublueprint.net
            </a>
            <br />
            <strong>Address:</strong> United Kingdom (correspondence only)
          </p>
        </div>
      </article>

      {/* Spacer for safe area */}
      <div style={{ height: 24 }} />
    </div>
  );
}
