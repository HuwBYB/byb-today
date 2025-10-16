import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Types ---------- */
type BigIdea = {
  id: number;
  user_id: string;
  title: string;       // BIG IDEA (short)
  summary: string;     // SUMMARY / concept
  audience: string;    // WHO IT'S FOR
  research: string;    // THINGS TO FIND OUT
  impact: string;      // WHY IT EXCITES ME
  first_steps: string; // FIRST 3 STEPS (free text)
  status: "seed" | "growing" | "ready" | "parked";
  category: string | null;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

/* ---------- Utilities (mirrors Notes) ---------- */
function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function firstLine(s: string) {
  const t = (s || "").trim();
  return t.split(/\r?\n/)[0] || "Untitled";
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}
function highlight(text: string, terms: string[]) {
  if (!terms.length) return escapeHtml(text);
  let html = escapeHtml(text);
  terms.forEach(t => {
    if (!t) return;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "ig");
    html = html.replace(re, "<mark>$1</mark>");
  });
  return html;
}
function stringToTags(s: string) {
  return (s || "")
    .split(",")
    .map(x => x.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 20);
}

/* ---------- Modal (reuse from Notes) ---------- */
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

/* ---------- Main ---------- */
export default function BigIdeasScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<BigIdea[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // quick capture
  const [qcText, setQcText] = useState("");     // freeform dump; we’ll split into title + summary
  const [qcPinned, setQcPinned] = useState(false);
  const [qcCategory, setQcCategory] = useState<string>("");

  // active idea draft
  const activeIdea = useMemo(() => ideas.find(n => n.id === activeId) || null, [ideas, activeId]);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [audience, setAudience] = useState("");
  const [research, setResearch] = useState("");
  const [impact, setImpact] = useState("");
  const [firstSteps, setFirstSteps] = useState("");
  const [status, setStatus] = useState<BigIdea["status"]>("seed");
  const [category, setCategory] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string>("");
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);

  // filters / search
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived">("active");
  const [statusTagFilter, setStatusTagFilter] = useState<"" | BigIdea["status"]>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const searchRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- load ideas ----- */
  useEffect(() => { if (userId) loadIdeas(); }, [userId, statusFilter]);

  async function loadIdeas() {
    if (!userId) return;
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase
        .from("big_ideas")
        .select("*")
        .eq("user_id", userId)
        .eq("archived", statusFilter === "archived")
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const arr = (data as BigIdea[]) || [];
      setIdeas(arr);
      const nextId = arr.some(n => n.id === activeId) ? activeId : arr[0]?.id ?? null;
      setActiveId(nextId);
    } catch (e: any) {
      setErr(e.message || String(e));
      setIdeas([]); setActiveId(null);
    } finally {
      setLoading(false);
    }
  }

  /* ----- when selection changes, sync drafts ----- */
  useEffect(() => {
    if (!activeIdea) return;
    setTitle(activeIdea.title || "");
    setSummary(activeIdea.summary || "");
    setAudience(activeIdea.audience || "");
    setResearch(activeIdea.research || "");
    setImpact(activeIdea.impact || "");
    setFirstSteps(activeIdea.first_steps || "");
    setStatus(activeIdea.status || "seed");
    setCategory(activeIdea.category || "");
    setTagsInput((activeIdea.tags || []).join(", "));
    setPinned(activeIdea.pinned || false);
    setArchived(activeIdea.archived || false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdea?.id]);

  /* ----- hashtag extraction ----- */
  function extractHashtags(s: string): string[] {
    const tags = new Set<string>();
    (s || "").replace(/(^|\s)#([a-zA-Z0-9_\-./]+)/g, (_m, _pre, tag) => { if (tag) tags.add(tag); return ""; });
    return Array.from(tags);
  }

  /* ----- patch builder ----- */
  function buildPatch() {
    const inline = Array.from(new Set([
      ...extractHashtags(title),
      ...extractHashtags(summary),
      ...extractHashtags(audience),
      ...extractHashtags(research),
      ...extractHashtags(impact),
      ...extractHashtags(firstSteps),
    ]));
    const explicit = stringToTags(tagsInput);
    const merged = Array.from(new Set([...explicit, ...inline])).slice(0, 30);

    return {
      title: title ?? "",
      summary: summary ?? "",
      audience: audience ?? "",
      research: research ?? "",
      impact: impact ?? "",
      first_steps: firstSteps ?? "",
      status: status ?? "seed",
      category: category || null,
      tags: merged,
      pinned,
      archived
    };
  }

  /* ----- debounced autosave ----- */
  useEffect(() => {
    if (!activeIdea) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (!userId || !activeIdea) return;
      const patch = buildPatch();
      supabase.from("big_ideas").update(patch).eq("id", activeIdea.id).then(({ error }) => {
        if (error) { setErr(error.message); return; }
        setIdeas(prev => prev.map(n => n.id === activeIdea.id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n));
      });
    }, 600) as unknown as number;

    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, summary, audience, research, impact, firstSteps, status, category, tagsInput, pinned, archived, activeIdea?.id, userId]);

  async function saveNow(): Promise<boolean> {
    if (!activeIdea || !userId) return false;
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    const patch = buildPatch();
    const { error } = await supabase.from("big_ideas").update(patch).eq("id", activeIdea.id);
    if (error) { setErr(error.message); return false; }
    setIdeas(prev => prev.map(n => n.id === activeIdea.id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n));
    return true;
  }
  async function saveAndClose() { const ok = await saveNow(); if (ok) setActiveId(null); }

  /* ----- CRUD helpers ----- */
  async function createIdea(initial?: Partial<Pick<BigIdea, "title" | "summary" | "category" | "pinned" | "tags">>) {
    if (!userId) return;
    const base = {
      user_id: userId,
      title: initial?.title ?? "",
      summary: initial?.summary ?? "",
      audience: "",
      research: "",
      impact: "",
      first_steps: "",
      status: "seed" as const,
      category: initial?.category ?? null,
      tags: initial?.tags ?? [],
      pinned: initial?.pinned ?? false,
      archived: false
    };
    const { data, error } = await supabase.from("big_ideas").insert(base).select().single();
    if (error) { setErr(error.message); return; }
    const n = data as BigIdea;
    setIdeas(prev => [n, ...prev]);
    setActiveId(n.id);
    return n.id;
  }

  async function togglePin(n: BigIdea) {
    const { error } = await supabase.from("big_ideas").update({ pinned: !n.pinned }).eq("id", n.id);
    if (error) { setErr(error.message); return; }
    setIdeas(prev => prev.map(x => x.id === n.id ? { ...x, pinned: !x.pinned } : x));
  }
  async function archiveIdea(n: BigIdea) {
    const { error } = await supabase.from("big_ideas").update({ archived: true }).eq("id", n.id);
    if (error) { setErr(error.message); return; }
    setIdeas(prev => prev.filter(x => x.id !== n.id));
    if (activeId === n.id) setActiveId(null);
  }
  async function unarchiveIdea(n: BigIdea) {
    const { error } = await supabase.from("big_ideas").update({ archived: false }).eq("id", n.id);
    if (error) { setErr(error.message); return; }
    setIdeas(prev => prev.filter(x => x.id !== n.id));
    if (activeId === n.id) setActiveId(null);
  }
  async function deleteIdea(n: BigIdea) {
    if (!confirm("Delete this idea permanently?")) return;
    const { error } = await supabase.from("big_ideas").delete().eq("id", n.id);
    if (error) { setErr(error.message); return; }
    setIdeas(prev => prev.filter(x => x.id !== n.id));
    if (activeId === n.id) setActiveId(null);
  }

  /* ----- keyboard shortcuts ----- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === "n" && !meta && (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA")) {
        e.preventDefault();
        createIdea();
      } else if ((e.key === "Enter" && meta) || (e.key === "Enter" && e.ctrlKey)) {
        if (activeIdea) { e.preventDefault(); saveAndClose(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIdea]);

  /* ----- derived filters ----- */
  const categories = useMemo(() => {
    const set = new Set<string>();
    ideas.forEach(n => { if (n.category) set.add(n.category); });
    return Array.from(set).sort();
  }, [ideas]);

  const tagCloud = useMemo(() => {
    const map = new Map<string, number>();
    ideas.forEach(n => {
      const all = new Set<string>([
        ...(n.tags || []),
        ...extractHashtags(n.title || ""),
        ...extractHashtags(n.summary || ""),
        ...extractHashtags(n.audience || ""),
        ...extractHashtags(n.research || ""),
        ...extractHashtags(n.impact || ""),
        ...extractHashtags(n.first_steps || ""),
      ]);
      all.forEach(t => map.set(t, (map.get(t) || 0) + 1));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [ideas]);

  function parseQuery(raw: string) {
    const term = raw.trim();
    const parts = term.split(/\s+/);
    const tags: string[] = [];
    let pinnedOnly = false;
    const words: string[] = [];
    parts.forEach(p => {
      if (p.startsWith("#")) tags.push(p.slice(1).toLowerCase());
      else if (p === "is:pinned") pinnedOnly = true;
      else words.push(p);
    });
    return { words, tags, pinnedOnly };
  }

  const { listFiltered, matchTerms } = useMemo(() => {
    const parsed = parseQuery(q);
    const wordsLC = parsed.words.map(w => w.toLowerCase());
    const selectedTagsArray = Array.from(selectedTags.values()).map(t => t.toLowerCase());
    const arr = ideas.filter(n => {
      if (statusTagFilter && n.status !== statusTagFilter) return false;
      if (categoryFilter && (n.category || "") !== categoryFilter) return false;
      if (parsed.pinnedOnly && !n.pinned) return false;

      const noteTags = new Set(
        [
          ...(n.tags || []),
          ...extractHashtags(n.title || ""),
          ...extractHashtags(n.summary || ""),
          ...extractHashtags(n.audience || ""),
          ...extractHashtags(n.research || ""),
          ...extractHashtags(n.impact || ""),
          ...extractHashtags(n.first_steps || ""),
        ].map(t => t.toLowerCase())
      );
      for (const t of [...selectedTagsArray, ...parsed.tags]) {
        if (!noteTags.has(t)) return false;
      }

      if (!q.trim()) return true;
      const hay = (n.title + " " + n.summary + " " + n.audience + " " + n.research + " " + n.impact + " " + n.first_steps).toLowerCase();
      return wordsLC.every(w => hay.includes(w));
    });

    const termsForHighlight = [...parsed.words, ...parsed.tags.map(t => `#${t}`)];
    return { listFiltered: arr, matchTerms: termsForHighlight };
  }, [ideas, q, statusTagFilter, categoryFilter, selectedTags]);

  /* ----- quick capture ----- */
  async function quickCapture() {
    const text = qcText.trim();
    if (!text) return;
    const lines = text.split(/\r?\n/);
    const head = (lines[0] || "").trim();
    const rest = lines.slice(1).join("\n").trim();
    const hashtags = new Set<string>([
      ...extractHashtags(head),
      ...extractHashtags(rest)
    ]);
    const id = await createIdea({
      title: head,
      summary: rest,
      category: qcCategory || null,
      pinned: qcPinned,
      tags: Array.from(hashtags),
    });
    if (id) {
      setQcText("");
      setQcPinned(false);
      setQcCategory("");
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="page-ideas" style={{ display: "grid", gap: 12 }}>
      {/* Title */}
      <div className="card">
        <h1 style={{ margin: 0 }}>My Big Ideas</h1>
        <div className="muted" style={{ marginTop: 4 }}>
          Park big ideas fast, then come back to grow them when you’re ready.
        </div>
      </div>

      <div className="container">
        <div className="ideas-layout" style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
          {/* Sidebar */}
          <aside className="card" style={{ display:"grid", gridTemplateRows:"auto auto auto auto 1fr auto", gap:10, minWidth:0 }}>
            {/* Quick capture */}
            <div style={{ display:"grid", gap:6 }}>
              <div className="section-title">Quick capture</div>
              <textarea
                rows={3}
                placeholder="Write a big idea on the first line, add a short summary on the next lines… (hashtags like #product #adhd)"
                value={qcText}
                onChange={(e)=>setQcText(e.target.value)}
              />
              <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                  <input type="checkbox" checked={qcPinned} onChange={e=>setQcPinned(e.target.checked)} />
                  Pin
                </label>
                <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                  Category
                  <input value={qcCategory} onChange={e=>setQcCategory(e.target.value)} style={{ width:140 }} placeholder="e.g. business" />
                </label>
                <button className="btn-primary" onClick={quickCapture} style={{ borderRadius:8 }}>Add</button>
              </div>
            </div>

            {/* Search + filters */}
            <div style={{ display:"grid", gap:8 }}>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search…  (#tag, is:pinned)"
                value={q}
                onChange={e=>setQ(e.target.value)}
              />
              <div style={{ display:"flex", gap:8 }}>
                <select value={statusTagFilter} onChange={e=>setStatusTagFilter(e.target.value as any)} style={{ flex:1 }}>
                  <option value="">All statuses</option>
                  <option value="seed">🌱 Seed</option>
                  <option value="growing">🌿 Growing</option>
                  <option value="ready">🌻 Ready to Act</option>
                  <option value="parked">💤 Parked</option>
                </select>
                <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)} style={{ flex:1 }}>
                  <option value="">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as "active" | "archived")}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
                <button onClick={loadIdeas} disabled={loading}>{loading ? "…" : "↻"}</button>
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
                      title={`${c} idea(s)`}
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
              {listFiltered.length === 0 && <li className="muted">No ideas match.</li>}
              {listFiltered.map(n => {
                const titleShow = n.title || firstLine(n.summary);
                const preview = (n.summary || "").split(/\r?\n/).slice(0, 2).join(" ").slice(0, 140);
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
                        {formatDate(n.updated_at)} · {(n.category||"").toString()} · {n.status}
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
            {!activeIdea ? (
              <div className="muted">Select an idea or create a new one (press “n”). Use the Status filter to view archived ideas.</div>
            ) : (
              <>
                <div style={{ display:"grid", gap:8 }}>
                  <input
                    type="text"
                    placeholder="BIG IDEA (short title)"
                    value={title}
                    onChange={e=>setTitle(e.target.value)}
                    style={{ width:"100%" }}
                  />
                  <textarea
                    rows={4}
                    placeholder="SUMMARY (what it is and why it matters)"
                    value={summary}
                    onChange={e=>setSummary(e.target.value)}
                    style={{ width:"100%" }}
                  />
                </div>

                <div style={{ display:"grid", gap:8 }}>
                  <textarea
                    rows={3}
                    placeholder="WHO WOULD THIS BE GOOD FOR?"
                    value={audience}
                    onChange={e=>setAudience(e.target.value)}
                    style={{ width:"100%" }}
                  />
                  <textarea
                    rows={4}
                    placeholder="THINGS I NEED TO FIND OUT BEFORE I PROCEED (research questions, unknowns)"
                    value={research}
                    onChange={e=>setResearch(e.target.value)}
                    style={{ width:"100%" }}
                  />
                  <textarea
                    rows={3}
                    placeholder="POTENTIAL IMPACT / WHY IT EXCITES ME"
                    value={impact}
                    onChange={e=>setImpact(e.target.value)}
                    style={{ width:"100%" }}
                  />
                  <textarea
                    rows={3}
                    placeholder="FIRST 3 STEPS (if I chose to start)"
                    value={firstSteps}
                    onChange={e=>setFirstSteps(e.target.value)}
                    style={{ width:"100%" }}
                  />
                </div>

                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                    Status
                    <select value={status} onChange={e=>setStatus(e.target.value as BigIdea["status"])}>
                      <option value="seed">🌱 Seed</option>
                      <option value="growing">🌿 Growing</option>
                      <option value="ready">🌻 Ready to Act</option>
                      <option value="parked">💤 Parked</option>
                    </select>
                  </label>
                  <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                    Category
                    <input value={category} onChange={e=>setCategory(e.target.value)} placeholder="e.g. business, creative" style={{ width:220 }} />
                  </label>
                </div>

                {/* Tags editor */}
                <div style={{ display:"grid", gap:6 }}>
                  <div className="section-title">Tags</div>
                  <input
                    type="text"
                    placeholder="adhd, product, invention (inline #tags also work)"
                    value={tagsInput}
                    onChange={e=>setTagsInput(e.target.value)}
                  />
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {Array.from(new Set([
                      ...stringToTags(tagsInput),
                      ...extractHashtags(title + "\n" + summary + "\n" + audience + "\n" + research + "\n" + impact + "\n" + firstSteps)
                    ])).map(t => (
                      <span key={t} className="badge">#{t}</span>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <button onClick={()=>togglePin(activeIdea)} className="btn-soft">{pinned ? "Unpin" : "Pin"}</button>

                  {statusFilter === "archived" || archived ? (
                    <button onClick={()=>unarchiveIdea(activeIdea)}>Unarchive</button>
                  ) : (
                    <button onClick={()=>archiveIdea(activeIdea)}>Archive</button>
                  )}

                  <button onClick={saveAndClose} className="btn-primary" style={{ borderRadius:8 }}>
                    Save & Close
                  </button>

                  <button onClick={()=>deleteIdea(activeIdea)} style={{ borderColor:"#fca5a5", color:"#b91c1c", background:"#fff5f5" }}>
                    Delete
                  </button>

                  <div className="muted" style={{ marginLeft:"auto" }}>
                    Created {formatDate(activeIdea.created_at)} · Updated {formatDate(activeIdea.updated_at)}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* (Optional) Tiny helper modal space if you later add prompts/templates */}
      <Modal open={false} onClose={()=>{}} title="Templates">
        <div />
      </Modal>
    </div>
  );
}
