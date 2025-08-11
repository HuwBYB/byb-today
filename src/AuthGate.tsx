import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!session) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <form onSubmit={signIn} style={{ width: 360, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>Sign in</h1>
          <input
            style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid #ccc", borderRadius: 6 }}
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <input
            type="password"
            style={{ width: "100%", p
