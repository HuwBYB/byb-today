// src/BigIdeasScreen.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types (subset of previous) ---------- */
type BigIdea = {
  id: number;
  user_id: string;
  title: string;       // Idea name
  summary: string;     // Summary
  audience: string;    // Who it serves
  research: string;    // What I need to find out
  created_at: string;
  updated_at: string;
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ---------- Minimal Modal ---------- */
function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => { if (open && closeRef.current) closeRef.current.focus(); }, [open]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 2000,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720, width: "100%", background: "#fff", borderRadius: 12,
                 boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Screen ---------- */
export default function BigIdeasScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<BigIdea[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // modal state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BigIdea | null>(null);

  // form state (4 fields)
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [audience, setAudience] = useState("");
  const [research, setResearch] = useState("");

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- load ideas ----- */
  useEffect(() => { if (userId) reload(); }, [userId]);
  async function reload() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("big_ideas")
        .select("id,user_id,title,summary,audience,research,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setIdeas((data as BigIdea[]) || []);
    } catch (e: any) {
      setErr(e.message || String(e));
      setIdeas([]);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setTitle(""); setSummary(""); setAudience(""); setResearch("");
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setOpen(true);
  }

  function openEdit(item: BigIdea) {
    setEditing(item);
    setTitle(item.title || "");
    setSummary(item.summary || "");
    setAudience(item.audience || "");
    setResearch(item.research || "");
    setOpen(true);
  }

  async function saveIdea() {
    if (!userId) return;
    const base = {
      user_id: userId,
      title: title.trim(),
      summary: summary.trim(),
      audience: audience.trim(),
      research: research.trim(),
    };
    try {
      if (editing) {
        const { error } = await supabase.from("big_ideas").update(base).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("big_ideas").insert(base);
        if (error) throw error;
      }
      setOpen(false);
      setEditing(null);
      resetForm();
      await reload();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function deleteIdea(id: number) {
    if (!confirm("Delete this idea permanently?")) return;
    try {
      const { error } = await supabase.from("big_ideas").delete().eq("id", id);
      if (error) throw error;
      setIdeas(prev => prev.filter(i => i.id !== id));
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  const empty = useMemo(() => ideas.length === 0, [ideas.length]);

  return (
    <div className="page-ideas" style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>My Big Ideas</h1>
          <div className="muted" style={{ marginTop: 4 }}>Capture ideas quickly, then come back when you're ready.</div>
        </div>
        <button className="btn-primary" onClick={openCreate} style={{ borderRadius: 10 }}>+ Add a new idea</button>
      </div>

      {/* List */}
      <div className="card" style={{ display: "grid", gap: 8 }}>
        {loading && <div className="muted">Loading…</div>}
        {err && <div style={{ color: "red" }}>{err}</div>}
        {empty && !loading ? (
          <div className="muted">No ideas yet. Click “Add a new idea”.</div>
        ) : (
          <ul className="list" style={{ maxHeight: "65vh", overflow: "auto" }}>
            {ideas.map((it) => (
              <li key={it.id} className="item" style={{ alignItems: "flex-start", gap: 10 }}>
                <button
                  onClick={() => openEdit(it)}
                  title="Open"
                  style={{ textAlign: "left", border: "none", background: "transparent", padding: 0, flex: 1 }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{it.title || "(Untitled)"}</div>
                  {it.summary && <div className="muted" style={{ marginBottom: 6 }}>{it.summary}</div>}
                  <div style={{ fontSize: 12 }} className="muted">
                    Who it serves: {it.audience || "—"} · What to find out: {it.research || "—"}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Updated {formatDate(it.updated_at)}
                  </div>
                </button>
                <button
                  onClick={() => deleteIdea(it.id)}
                  style={{ borderColor: "#fca5a5", color: "#b91c1c", background: "#fff5f5" }}
                  aria-label="Delete idea"
                  title="Delete"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Edit idea" : "Add a new idea"}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <input
            type="text"
            placeholder="Idea name"
            value={title}
            onChange={(e)=>setTitle(e.target.value)}
          />
          <textarea
            rows={4}
            placeholder="Summary"
            value={summary}
            onChange={(e)=>setSummary(e.target.value)}
          />
          <textarea
            rows={3}
            placeholder="Who it serves"
            value={audience}
            onChange={(e)=>setAudience(e.target.value)}
          />
          <textarea
            rows={3}
            placeholder="What I need to find out"
            value={research}
            onChange={(e)=>setResearch(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={()=>{ setOpen(false); setEditing(null); }}>Cancel</button>
            <button className="btn-primary" onClick={saveIdea} style={{ borderRadius: 8 }}>
              {editing ? "Save changes" : "Save idea"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
