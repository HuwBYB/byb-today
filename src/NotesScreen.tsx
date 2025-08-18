import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

type Note = {
  id: number;
  user_id: string;
  title: string;
  content: string;
  folder: string | null;
  tags: string[];          // stored as text[] in DB
  pinned: boolean;
  archived: boolean;
  created_at: string;      // ISO
  updated_at: string;      // ISO
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function firstLine(s: string) {
  const t = (s || "").trim();
  return t.split(/\r?\n/)[0] || "Untitled";
}
function tagsToString(tags: string[]) { return (tags || []).join(", "); }
function stringToTags(s: string) {
  return (s || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Public path helper (works with Vite/CRA/Vercel/GH Pages) */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}
const NOTES_ALFRED_SRC = publicPath("/alfred/Notes_Alfred.png");

/* ---------- Lightweight modal ---------- */
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
        style={{ maxWidth: 780, width: "100%", background: "#fff", borderRadius: 12,
                 boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close help" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Inlined help content ---------- */
function NotesHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p><em>Notes keeps everything in one place — ideas, meeting minutes, brain dumps, and plans — so you can find and act on them later.</em></p>

      <h4 style={{ margin: 0 }}>Quick start</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Click <b>New</b> to create a note.</li>
        <li>Add a <b>Title</b> (or leave it blank — we’ll use the first line).</li>
        <li>Write in the editor. Changes are <b>auto-saved</b> within a second.</li>
        <li>Optional: set a <b>Folder</b> (e.g., Work, Personal) and add <b>Tags</b> like <code>meeting, idea</code>.</li>
        <li>Use <b>Search</b> and the <b>folder filter</b> on the left to find notes fast.</li>
      </ol>

      <h4 style={{ margin: 0 }}>Folders vs Tags</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Folder</b> = one home (good for simple grouping like Work/Personal).</li>
        <li><b>Tags</b> = many labels (great for themes: <i>meeting, client-x, follow-up</i>).</li>
      </ul>

      <h4 style={{ margin: 0 }}>Pin, Archive, Delete</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Pin</b> bubbles important notes to the top.</li>
        <li><b>Archive</b> hides a note from your active list without deleting it.</li>
        <li><b>Delete</b> removes it permanently (use with care).</li>
      </ul>

      <h4 style={{ margin: 0 }}>Tips from Alfred</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Start messy. Capture first, tidy later with folders/tags.</li>
        <li>One note per meeting/topic keeps history clean and easier to search.</li>
        <li>Use consistent tag names (e.g., <code>follow-up</code> not <code>follow up</code>).</li>
        <li>Pin your “Today” note in the morning; unpin at day’s end.</li>
      </ul>

      <p><strong>Closing note:</strong> Notes turn thoughts into assets. Capture daily — future you will thank you.</p>
    </div>
  );
}

export default function NotesScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // local draft for the active note
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folder, setFolder] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string>("");
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);

  // search & folder filter
  const [q, setQ] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("");

  // Alfred
  const [showHelp, setShowHelp] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  const saveTimer = useRef<number | null>(null);
  const activeNote = useMemo(() => notes.find(n => n.id === activeId) || null, [notes, activeId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => { if (userId) loadNotes(); }, [userId]);

  async function loadNotes() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("user_id", userId)
        .eq("archived", false)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setNotes((data as Note[]) || []);
      // keep current selection if it still exists
      const stillThere = (data as Note[] || []).some(n => n.id === activeId);
      if (!stillThere) setActiveId((data as Note[] || [])[0]?.id ?? null);
    } catch (e: any) {
      setErr(e.message || String(e));
      setNotes([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }

  // when selection changes, sync drafts
  useEffect(() => {
    if (!activeNote) return;
    setTitle(activeNote.title || "");
    setContent(activeNote.content || "");
    setFolder(activeNote.folder || "");
    setTagsInput(tagsToString(activeNote.tags || []));
    setPinned(activeNote.pinned || false);
    setArchived(activeNote.archived || false);
  }, [activeNote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // debounced auto-save on any draft changes
  useEffect(() => {
    if (!activeNote) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (!userId) return;
      const patch = {
        title: title ?? "",
        content: content ?? "",
        folder: folder || null,
        tags: stringToTags(tagsInput),
        pinned,
        archived
      };
      supabase.from("notes").update(patch).eq("id", activeNote.id).then(({ error }) => {
        if (error) { setErr(error.message); return; }
        // reflect updated fields + updated_at locally
        setNotes(prev => prev.map(n => n.id === activeNote.id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n));
      });
    }, 600) as unknown as number;

    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, folder, tagsInput, pinned, archived, activeNote?.id, userId]);

  async function createNote() {
    if (!userId) return;
    const base = { user_id: userId, title: "", content: "", folder: null, tags: [], pinned: false, archived: false };
    const { data, error } = await supabase.from("notes").insert(base).select().single();
    if (error) { setErr(error.message); return; }
    const n = data as Note;
    setNotes(prev => [n, ...prev]);
    setActiveId(n.id);
  }

  async function togglePin(n: Note) {
    const { error } = await supabase.from("notes").update({ pinned: !n.pinned }).eq("id", n.id);
    if (error) { setErr(error.message); return; }
    setNotes(prev => prev.map(x => x.id === n.id ? { ...x, pinned: !x.pinned } : x));
  }

  async function archiveNote(n: Note) {
    const { error } = await supabase.from("notes").update({ archived: true }).eq("id", n.id);
    if (error) { setErr(error.message); return; }
    setNotes(prev => prev.filter(x => x.id !== n.id));
    if (activeId === n.id) setActiveId(null);
  }

  async function deleteNote(n: Note) {
    if (!confirm("Delete this note permanently?")) return;
    const { error } = await supabase.from("notes").delete().eq("id", n.id);
    if (error) { setErr(error.message); return; }
    setNotes(prev => prev.filter(x => x.id !== n.id));
    if (activeId === n.id) setActiveId(null);
  }

  // derived lists
  const folders = useMemo(() => {
    const set = new Set<string>();
    notes.forEach(n => { if (n.folder) set.add(n.folder); });
    return Array.from(set).sort();
  }, [notes]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return notes.filter(n => {
      if (folderFilter && (n.folder || "") !== folderFilter) return false;
      if (!term) return true;
      return (n.title.toLowerCase().includes(term) || (n.content || "").toLowerCase().includes(term));
    });
  }, [notes, q, folderFilter]);

  return (
    <div className="page-notes" style={{ display: "grid", gap: 12 }}>
      {/* Title + Alfred */}
      <div className="card" style={{ position: "relative", paddingRight: 64 }}>
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Notes help"
          title="Need a hand? Ask Alfred"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            lineHeight: 0,
            zIndex: 10,
          }}
        >
          {imgOk ? (
            <img
              src={NOTES_ALFRED_SRC}
              alt="Notes Alfred — open help"
              style={{ width: 48, height: 48 }}
              onError={() => setImgOk(false)}
            />
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36, height: 36, borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#f9fafb",
                fontWeight: 700,
              }}
            >
              ?
            </span>
          )}
        </button>
        <h1 style={{ margin: 0 }}>Notes</h1>
      </div>

      <div className="container">
        <div className="notes-layout">
          {/* Sidebar */}
          <aside className="card" style={{ display:"grid", gridTemplateRows:"auto auto auto 1fr auto", gap:10, minWidth:0 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
              <h2 style={{ margin:0 }}>All notes</h2>
              <button className="btn-primary" onClick={createNote} style={{ borderRadius:8 }}>New</button>
            </div>

            <input
              type="text"
              placeholder="Search notes…"
              value={q}
              onChange={e=>setQ(e.target.value)}
            />

            <div style={{ display:"flex", gap:8 }}>
              <select value={folderFilter} onChange={e=>setFolderFilter(e.target.value)} style={{ flex:1 }}>
                <option value="">All folders</option>
                {folders.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <button onClick={loadNotes} disabled={loading}>{loading?"…": "↻"}</button>
            </div>

            <ul className="list" style={{ overflow:"auto", maxHeight:"60vh" }}>
              {filtered.length === 0 && <li className="muted">No notes yet.</li>}
              {filtered.map(n => (
                <li key={n.id} className="item" style={{ alignItems:"center", gap:8 }}>
                  <button
                    onClick={()=>setActiveId(n.id)}
                    style={{
                      textAlign:"left", width:"100%",
                      background: activeId===n.id ? "hsl(var(--pastel-hsl)/.35)" : "#fff",
                      border:"none", padding:0
                    }}
                  >
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {n.pinned && <span className="badge">Pinned</span>}
                      <div style={{ fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {n.title || firstLine(n.content)}
                      </div>
                    </div>
                    <div className="muted" style={{ marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {formatDate(n.updated_at)} · {(n.folder||"").toString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {err && <div style={{ color:"red" }}>{err}</div>}
          </aside>

          {/* Editor */}
          <main className="card" style={{ display:"grid", gap:10, minWidth:0 }}>
            {!activeNote ? (
              <div className="muted">Select a note or create a new one.</div>
            ) : (
              <>
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <input
                    type="text"
                    placeholder="Title"
                    value={title}
                    onChange={e=>setTitle(e.target.value)}
                    style={{ flex:"1 1 240px", minWidth:0 }}
                  />
                  <input
                    type="text"
                    placeholder="Folder (e.g., Work, Personal)"
                    value={folder}
                    onChange={e=>setFolder(e.target.value)}
                    style={{ width:220, minWidth:0 }}
                  />
                </div>

                <textarea
                  rows={14}
                  placeholder="Write your note…"
                  value={content}
                  onChange={e=>setContent(e.target.value)}
                  style={{ width:"100%", minHeight:240 }}
                />

                <div style={{ display:"grid", gap:6 }}>
                  <div className="section-title">Tags (comma separated)</div>
                  <input
                    type="text"
                    placeholder="meeting, idea, phone, follow-up"
                    value={tagsInput}
                    onChange={e=>setTagsInput(e.target.value)}
                  />
                </div>

                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <button onClick={()=>togglePin(activeNote)} className="btn-soft">{pinned ? "Unpin" : "Pin"}</button>
                  <button onClick={()=>archiveNote(activeNote)}>Archive</button>
                  <button onClick={()=>deleteNote(activeNote)} style={{ borderColor:"#fca5a5", color:"#b91c1c", background:"#fff5f5" }}>Delete</button>
                  <div className="muted" style={{ marginLeft:"auto" }}>
                    Created {formatDate(activeNote.created_at)} · Updated {formatDate(activeNote.updated_at)}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Notes — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {imgOk && <img src={NOTES_ALFRED_SRC} alt="" aria-hidden="true" style={{ width: 72, height: 72, flex: "0 0 auto" }} />}
          <div style={{ flex: 1 }}>
            <NotesHelpContent />
          </div>
        </div>
      </Modal>
    </div>
  );
}
