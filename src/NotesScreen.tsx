import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types ---------- */
type Note = {
  id: number;
  user_id: string;
  title: string;
  content: string;
  folder: string | null;
  tags: string[];          // text[] in DB
  pinned: boolean;
  archived: boolean;
  created_at: string;      // ISO
  updated_at: string;      // ISO
};

/* ---------- Utilities ---------- */
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
    .map(x => x.trim().replace(/^#/, "")) // allow "#tag" or "tag"
    .filter(Boolean)
    .slice(0, 20);
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}
function highlight(text: string, terms: string[]) {
  if (!terms.length) return escapeHtml(text);
  let html = escapeHtml(text);
  terms.forEach(t => {
    if (!t) return;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    html = html.replace(re, "<mark>$1</mark>");
  });
  return html;
}
function normalizeTitle(s: string) {
  return (s || "").trim().toLowerCase();
}

/* ---------- Modal ---------- */
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
          <button ref={closeRef} onClick={onClose} aria-label="Close" title="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Journal prompts ---------- */
const JOURNAL_PROMPTS: string[] = [
  "Reflect on Challenges: Describe a recent challenge you faced. What did you learn from it, and how can you apply that lesson in the future?",
  "Overcoming Limiting Beliefs: What is one limiting belief you hold about yourself? How can you challenge and change that belief?",
  "Growth Through Feedback: Write about a time you received constructive criticism. How did it make you feel, and what actions did you take as a result?",
  "Admiration and Learning: Think of someone you admire for their growth mindset. What qualities do they possess that you can learn from?",
  "Embracing Failure: Describe a failure you experienced. What did it teach you, and how can you use that lesson to grow?",
  "Future Vision: Imagine yourself five years from now with a fully developed growth mindset. What does your life look like?",
  "Positive Self-Talk: List three positive affirmations you can tell yourself to reinforce a growth mindset.",
  "Comfort Zone: What is one thing you can do this week to step outside your comfort zone?",
  "Learning from Others: Write about a person who has influenced your growth mindset. What did you learn from them?",
  "Daily Reflection: At the end of each day, write about one thing you learned and one way you challenged yourself."
];

/* ---------- Main ---------- */
export default function NotesScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // quick capture
  const [qcText, setQcText] = useState("");
  const [qcPinned, setQcPinned] = useState(false);
  const [qcFolder, setQcFolder] = useState<string>("Journal");

  // active note draft
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folder, setFolder] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string>("");
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);

  // filters / search
  const [q, setQ] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived">("active");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Journal prompt modal
  const [showPromptModal, setShowPromptModal] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const activeNote = useMemo(() => notes.find(n => n.id === activeId) || null, [notes, activeId]);

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- load notes ----- */
  useEffect(() => { if (userId) loadNotes(); }, [userId, statusFilter]);

  async function loadNotes() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("user_id", userId)
        .eq("archived", statusFilter === "archived")
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      setNotes((data as Note[]) || []);
      const nextId = (data as Note[] || []).some(n => n.id === activeId)
        ? activeId
        : (data as Note[] || [])[0]?.id ?? null;
      setActiveId(nextId);
    } catch (e: any) {
      setErr(e.message || String(e));
      setNotes([]); setActiveId(null);
    } finally {
      setLoading(false);
    }
  }

  /* ----- when selection changes, sync drafts ----- */
  useEffect(() => {
    if (!activeNote) return;
    setTitle(activeNote.title || "");
    setContent(activeNote.content || "");
    setFolder(activeNote.folder || "");
    setTagsInput(tagsToString(activeNote.tags || []));
    setPinned(activeNote.pinned || false);
    setArchived(activeNote.archived || false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id]);

  function buildPatch() {
    // merge inline hashtags found in content/title with explicit tags input
    const inlineTags = Array.from(new Set([
      ...extractHashtags(title),
      ...extractHashtags(content),
    ]));
    const explicit = stringToTags(tagsInput);
    const merged = Array.from(new Set([...explicit, ...inlineTags])).slice(0, 30);

    return {
      title: title ?? "",
      content: content ?? "",
      folder: folder || null,
      tags: merged,
      pinned,
      archived
    };
  }

  // debounced auto-save
  useEffect(() => {
    if (!activeNote) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (!userId || !activeNote) return;
      const patch = buildPatch();
      supabase.from("notes").update(patch).eq("id", activeNote.id).then(({ error }) => {
        if (error) { setErr(error.message); return; }
        setNotes(prev => prev.map(n => n.id === activeNote.id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n));
      });
    }, 600) as unknown as number;

    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, folder, tagsInput, pinned, archived, activeNote?.id, userId]);

  async function saveNow(): Promise<boolean> {
    if (!activeNote || !userId) return false;
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    const patch = buildPatch();
    const { error } = await supabase.from("notes").update(patch).eq("id", activeNote.id);
    if (error) { setErr(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === activeNote.id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n));
    return true;
  }
  async function saveAndClose() {
    const ok = await saveNow();
    if (ok) setActiveId(null);
  }

  async function createNote(initial?: Partial<Pick<Note, "title" | "content" | "folder" | "pinned" | "tags">>) {
    if (!userId) return;
    const base = {
      user_id: userId,
      title: initial?.title ?? "",
      content: initial?.content ?? "",
      folder: initial?.folder ?? null,
      tags: initial?.tags ?? [],
      pinned: initial?.pinned ?? false,
      archived: false
    };
    const { data, error } = await supabase.from("notes").insert(base).select().single();
    if (error) { setErr(error.message); return; }
    const n = data as Note;
    setNotes(prev => [n, ...prev]);
    setActiveId(n.id);
    return n.id;
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
  async function unarchiveNote(n: Note) {
    const { error } = await supabase.from("notes").update({ archived: false }).eq("id", n.id);
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

  /* ---------- Keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === "/" && !meta) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "n" && !meta && (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA")) {
        e.preventDefault();
        createNote();
      } else if ((e.key === "Enter" && meta) || (e.key === "Enter" && e.ctrlKey)) {
        if (activeNote) { e.preventDefault(); saveAndClose(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeNote]);

  /* ---------- Derived: folders, tag cloud ---------- */
  const folders = useMemo(() => {
    const set = new Set<string>();
    notes.forEach(n => { if (n.folder) set.add(n.folder); });
    return Array.from(set).sort();
  }, [notes]);

  const tagCloud = useMemo(() => {
    const map = new Map<string, number>();
    notes.forEach(n => {
      const allTags = new Set<string>([
        ...(n.tags || []),
        ...extractHashtags(n.title || ""),
        ...extractHashtags(n.content || "")
      ]);
      allTags.forEach(t => map.set(t, (map.get(t) || 0) + 1));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [notes]);

  /* ---------- Backlinks ---------- */
  const backlinks = useMemo(() => {
    if (!activeNote) return [] as { from: Note; snippet: string }[];
    const myTitle = activeNote.title || firstLine(activeNote.content);
    const myKey = normalizeTitle(myTitle);
    if (!myKey) return [];
    const re = /\[\[([^\]]+)\]\]/g;
    const result: { from: Note; snippet: string }[] = [];
    notes.forEach(n => {
      if (n.id === activeNote.id) return;
      const matches = [...(n.content || "").matchAll(re)];
      for (const m of matches) {
        const ref = normalizeTitle(m[1] || "");
        if (ref === myKey) {
          result.push({ from: n, snippet: makeSnippet(n.content || "", m.index ?? 0, m[0].length) });
          break;
        }
      }
    });
    return result;
  }, [notes, activeNote]);

  function makeSnippet(text: string, start: number, len: number) {
    const S = Math.max(0, start - 40);
    const E = Math.min(text.length, start + len + 40);
    return (text.slice(S, E).replace(/\s+/g, " ")).trim();
  }

  /* ---------- Search (fast client-side) ---------- */
  function parseQuery(raw: string) {
    const term = raw.trim();
    const parts = term.split(/\s+/);
    const tags: string[] = [];
    let folderLocal: string | null = null;
    let isPinned: boolean | null = null;
    const words: string[] = [];
    parts.forEach(p => {
      if (p.startsWith("#")) tags.push(p.slice(1).toLowerCase());
      else if (p.startsWith("folder:")) folderLocal = p.slice(7);
      else if (p === "is:pinned") isPinned = true;
      else words.push(p);
    });
    return { words, tags, folder: folderLocal, isPinned };
  }

  const { listFiltered, matchTerms } = useMemo(() => {
    const parsed = parseQuery(q);
    const wordsLC = parsed.words.map(w => w.toLowerCase());
    const selectedTagsArray = Array.from(selectedTags.values()).map(t => t.toLowerCase());

    const arr = notes.filter(n => {
      if (folderFilter && (n.folder || "") !== folderFilter) return false;
      if (parsed.folder && (n.folder || "") !== parsed.folder) return false;
      if (parsed.isPinned === true && !n.pinned) return false;
      // tags filter: must include all selected & typed tags (AND)
      const noteTags = new Set(
        [
          ...(n.tags || []),
          ...extractHashtags(n.title || ""),
          ...extractHashtags(n.content || ""),
        ].map(t => t.toLowerCase())
      );
      for (const t of [...selectedTagsArray, ...parsed.tags]) {
        if (!noteTags.has(t)) return false;
      }
      if (!q.trim()) return true;
      // word match
      const hayTitle = (n.title || "").toLowerCase();
      const hayContent = (n.content || "").toLowerCase();
      return wordsLC.every(w => hayTitle.includes(w) || hayContent.includes(w));
    });
    const termsForHighlight = [...parsed.words, ...parsed.tags.map(t => `#${t}`)];
    return { listFiltered: arr, matchTerms: termsForHighlight };
  }, [notes, q, folderFilter, selectedTags]);

  /* ---------- Quick capture ---------- */
  async function quickCapture() {
    const text = qcText.trim();
    if (!text) return;
    const first = firstLine(text);
    const hashtags = extractHashtags(text);
    const id = await createNote({
      title: first === text ? "" : first,
      content: text,
      folder: qcFolder || null,
      pinned: qcPinned,
      tags: hashtags
    });
    if (id) {
      setQcText("");
      setQcPinned(false);
      setQcFolder("Journal");
    }
  }

  /* ---------- Hashtag extraction ---------- */
  function extractHashtags(s: string): string[] {
    const tags = new Set<string>();
    (s || "").replace(/(^|\s)#([a-zA-Z0-9_\-./]+)/g, (_m, _pre, tag) => { if (tag) tags.add(tag); return ""; });
    return Array.from(tags);
  }

  /* ---------- UI ---------- */
  return (
    <div className="page-notes" style={{ display: "grid", gap: 12 }}>
      {/* Title */}
      <div className="card">
        <h1 style={{ margin: 0 }}>Notes / Journal</h1>
        <div className="muted" style={{ marginTop: 4 }}>Capture ideas, plan work, and reflect daily.</div>
      </div>

      <div className="container">
        <div className="notes-layout" style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
          {/* Sidebar */}
          <aside className="card" style={{ display:"grid", gridTemplateRows:"auto auto auto auto 1fr auto", gap:10, minWidth:0 }}>
            {/* Quick capture */}
            <div style={{ display:"grid", gap:6 }}>
              <div className="section-title">Quick capture</div>
              <textarea
                rows={3}
                placeholder="New journal entry or note… (hashtags like #idea work too)"
                value={qcText}
                onChange={(e)=>setQcText(e.target.value)}
              />
              <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                  <input type="checkbox" checked={qcPinned} onChange={e=>setQcPinned(e.target.checked)} />
                  Pin
                </label>
                <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                  Folder
                  <input value={qcFolder} onChange={e=>setQcFolder(e.target.value)} style={{ width:140 }} placeholder="Journal" />
                </label>
                <button className="btn-primary" onClick={quickCapture} style={{ borderRadius:8 }}>Add</button>
                <button onClick={() => setShowPromptModal(true)} className="btn-soft" style={{ marginLeft: "auto" }}>
                  Journal prompt
                </button>
              </div>
            </div>

            {/* Search + filters */}
            <div style={{ display:"grid", gap:8 }}>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search…  (#tag, folder:Work, is:pinned)"
                value={q}
                onChange={e=>setQ(e.target.value)}
              />
              <div style={{ display:"flex", gap:8 }}>
                <select value={folderFilter} onChange={e=>setFolderFilter(e.target.value)} style={{ flex:1 }}>
                  <option value="">All folders</option>
                  {folders.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as "active" | "archived")}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
                <button onClick={loadNotes} disabled={loading}>{loading ? "…" : "↻"}</button>
              </div>
            </div>

            {/* Tag cloud filter */}
            <div style={{ display:"grid", gap:6 }}>
              <div className="section-title">Tags</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {tagCloud.length === 0 && <span className="muted">No tags yet.</span>}
                {tagCloud.map(([t, c]) => {
                  const on = selectedTags.has(t);
                  return (
                    <button
                      key={t}
                      className="btn-soft"
                      onClick={() => {
                        setSelectedTags(prev => {
                          const nxt = new Set(prev);
                          on ? nxt.delete(t) : nxt.add(t);
                          return nxt;
                        });
                      }}
                      title={`${c} note(s)`}
                      style={{
                        borderRadius: 999,
                        background: on ? "#eef2ff" : "#fff",
                        borderColor: on ? "#c7d2fe" : "var(--border)"
                      }}
                    >
                      #{t} <span className="muted">({c})</span>
                    </button>
                  );
                })}
                {selectedTags.size > 0 && (
                  <button className="btn-soft" onClick={() => setSelectedTags(new Set())}>Clear</button>
                )}
              </div>
            </div>

            {/* List */}
            <ul className="list" style={{ overflow:"auto", maxHeight:"55vh" }}>
              {listFiltered.length === 0 && <li className="muted">No notes match.</li>}
              {listFiltered.map(n => {
                const titleShow = n.title || firstLine(n.content);
                const preview = (n.content || "").split(/\r?\n/).slice(1).join(" ").slice(0, 140);
                return (
                  <li key={n.id} className="item" style={{ alignItems:"center", gap:8 }}>
                    <button
                      onClick={()=>setActiveId(n.id)}
                      style={{
                        textAlign:"left", width:"100%", padding:0, border:"none",
                        background: activeId===n.id ? "#f0f4ff" : "#fff"
                      }}
                      title={titleShow}
                    >
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {n.pinned && <span className="badge">Pinned</span>}
                        {n.archived && <span className="badge">Archived</span>}
                        <div
                          style={{ fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                          dangerouslySetInnerHTML={{ __html: highlight(titleShow, matchTerms) }}
                        />
                      </div>
                      <div
                        className="muted"
                        style={{ marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                        dangerouslySetInnerHTML={{ __html: highlight(preview, matchTerms) }}
                      />
                      <div className="muted" style={{ fontSize:12, marginTop:4 }}>
                        {formatDate(n.updated_at)} · {(n.folder||"").toString()}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {err && <div style={{ color:"red" }}>{err}</div>}
          </aside>

          {/* Editor */}
          <main className="card" style={{ display:"grid", gap:10, minWidth:0 }}>
            {!activeNote ? (
              <div className="muted">Select a note or create a new one. Use the Status filter to view archived notes.</div>
            ) : (
              <>
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <input
                    type="text"
                    placeholder="Title (or leave blank for journal-style)"
                    value={title}
                    onChange={e=>setTitle(e.target.value)}
                    style={{ flex:"1 1 240px", minWidth:0 }}
                  />
                  <input
                    type="text"
                    placeholder="Folder (e.g., Journal, Work, Personal)"
                    value={folder}
                    onChange={e=>setFolder(e.target.value)}
                    style={{ width:220, minWidth:0 }}
                  />
                </div>

                <textarea
                  rows={16}
                  placeholder="Write your note or journal entry… Use [[Wiki Links]] to connect notes. Inline #tags are automatically collected."
                  value={content}
                  onChange={e=>setContent(e.target.value)}
                  style={{ width:"100%", minHeight:260 }}
                />

                {/* Tag chips editor */}
                <div style={{ display:"grid", gap:6 }}>
                  <div className="section-title">Tags</div>
                  <input
                    type="text"
                    placeholder="meeting, idea, phone, follow-up"
                    value={tagsInput}
                    onChange={e=>setTagsInput(e.target.value)}
                  />
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {Array.from(new Set([
                      ...stringToTags(tagsInput),
                      ...extractHashtags(title),
                      ...extractHashtags(content)
                    ])).map(t => (
                      <span key={t} className="badge">#{t}</span>
                    ))}
                    {(!tagsInput && extractHashtags(title+content).length===0) && <span className="muted">No tags yet.</span>}
                  </div>
                </div>

                {/* Backlinks */}
                <div style={{ borderTop:"1px solid var(--border)", paddingTop:10 }}>
                  <div className="section-title">Backlinks</div>
                  {backlinks.length === 0 ? (
                    <div className="muted">No notes link here yet. Use [[{title || firstLine(content)}]] in another note.</div>
                  ) : (
                    <ul className="list">
                      {backlinks.map(({ from, snippet }) => (
                        <li key={from.id} className="item" style={{ alignItems:"center" }}>
                          <button onClick={()=>setActiveId(from.id)} style={{ textAlign:"left", width:"100%", border:"none", padding:0, background:"#fff" }}>
                            <div style={{ fontWeight:600 }}>{from.title || firstLine(from.content)}</div>
                            <div className="muted" style={{ fontSize:12, marginTop:2 }}>{snippet}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <button onClick={()=>togglePin(activeNote)} className="btn-soft">{pinned ? "Unpin" : "Pin"}</button>

                  {statusFilter === "archived" || archived ? (
                    <button onClick={()=>unarchiveNote(activeNote)}>Unarchive</button>
                  ) : (
                    <button onClick={()=>archiveNote(activeNote)}>Archive</button>
                  )}

                  <button onClick={saveAndClose} className="btn-primary" style={{ borderRadius:8 }}>
                    Save & Close
                  </button>

                  <button onClick={()=>deleteNote(activeNote)} style={{ borderColor:"#fca5a5", color:"#b91c1c", background:"#fff5f5" }}>
                    Delete
                  </button>

                  <div className="muted" style={{ marginLeft:"auto" }}>
                    Created {formatDate(activeNote.created_at)} · Updated {formatDate(activeNote.updated_at)}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Journal Prompt Modal */}
      <Modal open={showPromptModal} onClose={() => setShowPromptModal(false)} title="Journal prompts">
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">Pick a prompt to drop into Quick capture, or try a random one.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                const r = JOURNAL_PROMPTS[Math.floor(Math.random() * JOURNAL_PROMPTS.length)];
                setQcText(r + "\n\n");
                setShowPromptModal(false);
              }}
              className="btn-primary"
              style={{ borderRadius: 8 }}
            >
              Surprise me
            </button>
          </div>
          <ul className="list">
            {JOURNAL_PROMPTS.map((p, i) => (
              <li key={i} className="item" style={{ alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1 }}>{p}</div>
                <button
                  onClick={() => {
                    setQcText(p + "\n\n");
                    setShowPromptModal(false);
                  }}
                >
                  Use
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
