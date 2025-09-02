import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";


/* ---------- Public path helper ---------- */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}

/* ---------- Alfred image ---------- */
const VB_ALFRED_CANDIDATES = [
  "/alfred/Vision_Alfred.png",
  "/alfred/Vision_Alfred.jpg",
  "/alfred/Vision_Alfred.jpeg",
  "/alfred/Vision_Alfred.webp",
].map(publicPath);

/* ---------- Life areas (sections) ---------- */
const SECTIONS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" },
  { key: "health",    label: "Health",    color: "#22c55e" },
  { key: "career",    label: "Business",  color: "#3b82f6" }, // stored as 'career'
  { key: "financial", label: "Finance",   color: "#f59e0b" }, // stored as 'financial'
  { key: "other",     label: "Other",     color: "#6b7280" },
] as const;
type SectionKey = typeof SECTIONS[number]["key"];
const colorOf = (k: SectionKey) => SECTIONS.find(s => s.key === k)?.color || "#6b7280";

/* ---------- Storage ---------- */
const VISION_BUCKET = "vision";

/* ---------- Local caption/order fallbacks ---------- */
const capsKey = (uid: string) => `vb_caps_${uid}`;
const orderKey = (uid: string) => `vb_order_${uid}`;
function readLocalCaps(uid: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(capsKey(uid)) || "{}"); } catch { return {}; }
}
function writeLocalCaps(uid: string, caps: Record<string, string>) {
  try { localStorage.setItem(capsKey(uid), JSON.stringify(caps)); } catch {}
}
function readLocalOrder(uid: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(orderKey(uid)) || "{}"); } catch { return {}; }
}
function writeLocalOrder(uid: string, map: Record<string, number>) {
  try { localStorage.setItem(orderKey(uid), JSON.stringify(map)); } catch {}
}

/* ---------- Modal shell ---------- */
function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
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
        style={{ maxWidth: 760, width: "100%", background: "#fff", borderRadius: 12,
                 boxShadow: "0 10px 30px rgba(0,0,0,0.2)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close" style={{ borderRadius: 8 }}>✕</button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Help content ---------- */
function VisionHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.6 }}>
      <h4 style={{ margin: 0 }}>Make it vivid, make it daily</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Create sections (life areas) and drop images into each.</li>
        <li>Add a short, specific affirmation under each image.</li>
        <li>Reorder with drag &amp; drop until it “feels right”.</li>
        <li>Use <b>Play</b> for a 30s slideshow or export a wallpaper collage.</li>
        <li>Ask yourself: “What’s one tiny step I can do <i>today</i> toward this?”</li>
      </ol>
    </div>
  );
}

/* ---------- Types ---------- */
type VBImage = {
  path: string;        // storage path
  url: string;         // public URL
  caption: string;     // affirmation
  section: SectionKey; // life area
  order_index: number; // for sorting
  created_at?: string;
};

export default function VisionBoardScreen() {
  const [userId, setUserId] = useState<string | null>(null);

  const [images, setImages] = useState<VBImage[]>([]);
  const [activeSection, setActiveSection] = useState<SectionKey | "all">("all");
  const [defaultSection, setDefaultSection] = useState<SectionKey>("personal");

  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [playing, setPlaying] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showHelp, setShowHelp] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const VB_ALFRED_SRC = VB_ALFRED_CANDIDATES[imgIdx] ?? "";

  const fileRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);

  // ⬆️ Increased from 6 → 10
  const MAX_IMAGES = 10;

  /* ----- inline CSS (mobile-first) ----- */
  const styleTag = (
    <style>{`
      .vb-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap }
      .vb-dot { width:10px; height:10px; border-radius:999px; border:1px solid #d1d5db; flex:0 0 auto }
      .vb-circle-btn {
        display:inline-flex; align-items:center; justify-content:center;
        width:36px; height:36px; border-radius:999px; border:1px solid #d1d5db;
        background:#fff; padding:0; line-height:1; cursor:pointer
      }
      /* MAIN VIEWER */
      .vb-viewer {
        position:relative;
        width:100%;
        height: min(70vw, 520px);  /* tall on phones, capped on large screens */
        min-height: 280px;
        border:1px solid var(--border);
        border-radius:12px;
        overflow:hidden;
        background:#0b1220;
        display:flex; align-items:center; justify-content:center;
      }
      .vb-viewer img { width:100%; height:100%; object-fit:contain; display:block }
      .vb-arrow {
        position:absolute; top:50%; transform:translateY(-50%);
        background:#fff; border:1px solid #d1d5db; border-radius:999px; width:40px; height:40px;
        display:inline-flex; align-items:center; justify-content:center;
      }
      .vb-arrow--left { left:8px }
      .vb-arrow--right { right:8px }
      /* THUMBS GRID */
      .vb-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px }
      @media (min-width: 520px) { .vb-grid { grid-template-columns:repeat(4, 1fr) } }
      .vb-card { border:1px solid var(--border); border-radius:10px; overflow:hidden; background:#fff }
      .vb-thumb { width:100%; height:100px; object-fit:cover; display:block }
      .vb-caption { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
      .vb-active { outline:2px solid #6366f1; outline-offset:2px }
    `}</style>
  );

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- load images ----- */
  // Manual reload utility (used by the debug strip)
  async function reloadFromStorage() {
    if (!userId) return;
    setErr(null);
    try {
      // sanity check bucket exists
      const ping = await supabase.storage.from(VISION_BUCKET).list(undefined, { limit: 1 });
      if (ping.error) throw ping.error;

      // choose folder: prefer userId/ if exists else root
      let underUser = true;
      const testUser = await supabase.storage.from(VISION_BUCKET).list(userId, { limit: 1 });
      if (testUser.error || (testUser.data || []).length === 0) {
        const testRoot = await supabase.storage.from(VISION_BUCKET).list(undefined, { limit: 1 });
        if (!testRoot.error && (testRoot.data || []).length > 0) underUser = false;
      }

      const listPath = underUser ? userId : undefined;
      const listRes = await supabase.storage.from(VISION_BUCKET).list(listPath, {
        sortBy: { column: "created_at", order: "asc" },
        limit: 100,
      } as any);
      if (listRes.error) throw listRes.error;

      const files = (listRes.data || []).filter((f: any) => !("id" in f && (f as any).id === null));
      const baseRows: VBImage[] = files.map((f: any, i: number) => {
        const path = underUser ? `${userId}/${f.name}` : f.name;
        const { data: pub } = supabase.storage.from(VISION_BUCKET).getPublicUrl(path);
        return { path, url: pub.publicUrl, caption: "", section: "other", order_index: i, created_at: (f as any)?.created_at };
      });

      try {
        const { data: rows, error } = await supabase
          .from("vision_images")
          .select("path, caption, section, order_index")
          .eq("user_id", userId);
        if (!error && rows && Array.isArray(rows)) {
          const map = new Map<string, { caption?: string; section?: SectionKey; order_index?: number }>(
            rows.map((r: any) => [r.path, { caption: r.caption || "", section: (r.section as SectionKey) || "other", order_index: Number(r.order_index ?? 0) }])
          );
          baseRows.forEach(r => {
            const m = map.get(r.path);
            if (m) {
              r.caption = m.caption ?? "";
              r.section = (m.section as SectionKey) ?? "other";
              r.order_index = Number.isFinite(m.order_index) ? (m.order_index as number) : r.order_index;
            }
          });
        }
      } catch {}

      const lc = readLocalCaps(userId);
      const lo = readLocalOrder(userId);
      baseRows.forEach(r => {
        if (!r.caption && lc[r.path]) r.caption = lc[r.path];
        if (lo[r.path] != null) r.order_index = lo[r.path];
      });

      baseRows.sort((a, b) => a.order_index - b.order_index);
      setImages(baseRows.slice(0, MAX_IMAGES));
      setSelectedIdx(0);
    } catch (e: any) {
      setErr(e.message || String(e));
      setImages([]);
    }
  }

  // Keep original automatic load behaviour

  useEffect(() => {
    if (!userId) return;
    reloadFromStorage();
  }, [userId]);

  /* ----- slideshow ----- */
  useEffect(() => {
    if (!playing || images.length === 0) return;
    const id = setInterval(() => setSelectedIdx(i => (i + 1) % images.length), 30000);
    return () => clearInterval(id);
  }, [playing, images.length]);

  const canAdd = useMemo(() => images.length < MAX_IMAGES, [images.length]);
  const monthLabel = useMemo(() => new Date().toLocaleString(undefined, { month: "long", year: "numeric" }), []);
  const filtered = useMemo(
    () => activeSection === "all" ? images : images.filter(i => i.section === activeSection),
    [images, activeSection]
  );

  /* ---------- DB helpers ---------- */
  async function upsertMetaMany(rows: Array<Pick<VBImage, "path" | "caption" | "section" | "order_index">>) {
    if (!userId) return;
    try {
      const payload = rows.map(r => ({ user_id: userId, path: r.path, caption: r.caption, section: r.section, order_index: r.order_index }));
      const { error } = await supabase.from("vision_images").upsert(payload, { onConflict: "user_id,path" } as any);
      if (error) throw error;
    } catch {
      // fallback: local-only
      const c = readLocalCaps(userId);
      const o = readLocalOrder(userId);
      rows.forEach(r => { c[r.path] = r.caption; o[r.path] = r.order_index; });
      writeLocalCaps(userId, c);
      writeLocalOrder(userId, o);
    }
  }

  async function saveCaption(idxInAll: number, caption: string) {
    setImages(prev => {
      const next = prev.slice();
      next[idxInAll] = { ...next[idxInAll], caption };
      return next;
    });
    const row = images[idxInAll];
    if (row) await upsertMetaMany([{ path: row.path, caption, section: row.section, order_index: row.order_index }]);
  }

  async function changeSection(idxInAll: number, section: SectionKey) {
    setImages(prev => {
      const next = prev.slice();
      next[idxInAll] = { ...next[idxInAll], section };
      return next;
    });
    const row = images[idxInAll];
    if (row) await upsertMetaMany([{ path: row.path, caption: row.caption, section, order_index: row.order_index }]);
  }

  /* ---------- Upload ---------- */
  async function handleUpload(files: FileList | null) {
    if (!userId || !files || files.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const remaining = Math.max(0, MAX_IMAGES - images.length);
      const toUpload = Array.from(files).slice(0, remaining);
      const added: VBImage[] = [];

      for (const file of toUpload) {
        const safeName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
        const path = `${userId}/${safeName}`; // always under user/
        const up = await supabase.storage.from(VISION_BUCKET).upload(path, file, { upsert: false });
        if (up.error) throw up.error;

        const { data: pub } = supabase.storage.from(VISION_BUCKET).getPublicUrl(path);
        const order_index = images.length + added.length; // append
        const row: VBImage = { path, url: pub.publicUrl, caption: "", section: defaultSection, order_index };
        added.push(row);
      }

      const next = [...images, ...added].slice(0, MAX_IMAGES);
      setImages(next);

      // persist metadata for new rows
      await upsertMetaMany(added.map(r => ({ path: r.path, caption: "", section: r.section, order_index: r.order_index })));

      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Delete ---------- */
  async function removeAt(idxInAll: number) {
    if (!userId) return;
    const img = images[idxInAll]; if (!img) return;
    setBusy(true); setErr(null);
    try {
      await supabase.storage.from(VISION_BUCKET).remove([img.path]);
      try { await supabase.from("vision_images").delete().eq("user_id", userId).eq("path", img.path); } catch {}

      const next = images.filter((_, i) => i !== idxInAll);
      // reindex order
      const reindexed = next.map((r, i) => ({ ...r, order_index: i }));
      setImages(reindexed);
      if (selectedIdx >= reindexed.length) setSelectedIdx(Math.max(0, reindexed.length - 1));

      await upsertMetaMany(reindexed.map(r => ({ path: r.path, caption: r.caption, section: r.section, order_index: r.order_index })));
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Drag & Drop (reorder) ---------- */
  function onDragStart(e: React.DragEvent, filteredIndex: number) {
    dragFrom.current = filteredIndex;
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  async function onDrop(e: React.DragEvent, filteredIndex: number) {
    e.preventDefault();
    const fromFiltered = dragFrom.current;
    dragFrom.current = null;
    if (fromFiltered == null) return;

    const visible = filtered;
    const fromItem = visible[fromFiltered];
    const toItem   = visible[filteredIndex];
    if (!fromItem || !toItem) return;

    const fromIdxAll = images.findIndex(i => i.path === fromItem.path);
    const toIdxAll   = images.findIndex(i => i.path === toItem.path);
    if (fromIdxAll === -1 || toIdxAll === -1) return;

    const next = images.slice();
    const [moved] = next.splice(fromIdxAll, 1);
    next.splice(toIdxAll, 0, moved);

    const reindexed = next.map((r, i) => ({ ...r, order_index: i }));
    setImages(reindexed);
    await upsertMetaMany(reindexed.map(r => ({ path: r.path, caption: r.caption, section: r.section, order_index: r.order_index })));
  }

  /* ---------- Export (collage wallpaper 1080x1920) ---------- */
  async function exportCollage() {
    const src = images;
    if (src.length === 0) return;
    const W = 1080, H = 1920, P = 36;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    // background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    // title
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 40px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText("My Vision", P, 72);

    // grid: up to 10 images (2 cols x 5 rows)
    const cols = 2, rows = 5;
    const cellW = Math.floor((W - P * 3) / cols);
    const cellH = Math.floor((H - 200 - P * 6) / rows); // leave top area for title

    // load
    const imgs = await Promise.all(src.map((it) => new Promise<HTMLImageElement>((resolve) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.src = it.url;
    })));

    imgs.slice(0, cols * rows).forEach((im, idx) => {
      const c = idx % cols, r = Math.floor(idx / cols);
      const x = P + c * (cellW + P);
      const y = 110 + r * (cellH + P);

      // draw image (contain)
      const ratio = Math.min(cellW / im.width, cellH / im.height);
      const w = Math.floor(im.width * ratio);
      const h = Math.floor(im.height * ratio);
      const ix = x + Math.floor((cellW - w) / 2);
      const iy = y + Math.floor((cellH - h) / 2);

      // card bg
      ctx.fillStyle = "#0b1220";
      roundRect(ctx, x - 2, y - 2, cellW + 4, cellH + 4, 16);
      ctx.fill();

      ctx.drawImage(im, ix, iy, w, h);

      // caption
      const cap = (src[idx].caption || "").trim();
      if (cap) {
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "600 24px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        wrapText(ctx, cap, x + 12, y + cellH - 10, cellW - 24, 28);
      }
    });

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "vision_wallpaper.png", { type: "image/png" });
      const navAny = navigator as any;
      if (navAny?.canShare && navAny.canShare({ files: [file] })) {
        try { await navAny.share({ files: [file], title: "Vision board" }); return; } catch {}
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "vision_wallpaper.png"; a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
    const words = text.split(/\s+/);
    let line = "";
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + " ";
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line.trim(), x, y);
        line = words[n] + " ";
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    if (line) ctx.fillText(line.trim(), x, y);
  }

  /* ---------- UI ---------- */
  const current = images[selectedIdx] || null;
  const monthStr = monthLabel;

  function prev() { if (images.length) setSelectedIdx(i => (i - 1 + images.length) % images.length); }
  function next() { if (images.length) setSelectedIdx(i => (i + 1) % images.length); }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {styleTag}

      {/* Title + Help */}
      <div className="card" style={{ position: "relative", paddingRight: 64 }}>
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Vision Board help"
          title="Need a hand? Ask Alfred"
          style={{ position: "absolute", top: 8, right: 8, border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10 }}
        >
          {VB_ALFRED_SRC ? (
            <img src={VB_ALFRED_SRC} alt="Vision Board Alfred — open help" style={{ width: 48, height: 48 }} onError={() => setImgIdx(i => i + 1)} />
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700 }}>?</span>
          )}
        </button>
        <h1 style={{ margin: 0 }}>Vision Board</h1>
        <div className="muted">{monthStr}</div>
      </div>

      {/* Toolbar */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="vb-actions">
          <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span className="muted">View</span>
            <select value={activeSection} onChange={e => setActiveSection(e.target.value as any)}>
              <option value="all">All sections</option>
              {SECTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span className="muted">New uploads →</span>
            <select value={defaultSection} onChange={e => setDefaultSection(e.target.value as SectionKey)}>
              {SECTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <span className="vb-dot" title="Color" style={{ background: colorOf(defaultSection) }} />
          </div>

          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                 onChange={e => handleUpload(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={!userId || !canAdd || busy}
                  className="btn-primary" style={{ borderRadius: 8 }}>
            {busy ? "Uploading…" : `Upload image${canAdd ? "" : " (full)"}`}
          </button>

          <button onClick={() => setPlaying(p => !p)} disabled={images.length <= 1}>
            {playing ? "Pause" : "Play 30s"}
          </button>
          <button onClick={exportCollage} disabled={images.length === 0} className="btn-soft">
            Export collage
          </button>
        </div>

        {err && <div style={{ color: "red" }}>{err}</div>}
      </div>

      {/* Big viewer (manual arrows + slideshow) */}
      <div className="card" style={{ padding: 8 }}>
        {current ? (
          <div className="vb-viewer" aria-label="Vision image viewer">
            <button className="vb-arrow vb-arrow--left" aria-label="Previous" onClick={prev}>
              <svg viewBox="0 0 20 20" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4 L7 10 L12 16" />
              </svg>
            </button>

            <img key={current.path} src={current.url} alt="" />

            <button className="vb-arrow vb-arrow--right" aria-label="Next" onClick={next}>
              <svg viewBox="0 0 20 20" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 4 L13 10 L8 16" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="muted">No images yet. Upload your first one above.</div>
        )}

        {/* Inline editor under the viewer */}
        {current && (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Affirmation / caption</span>
              <input
                value={current.caption}
                onChange={e => setImages(prev => { const n = prev.slice(); n[selectedIdx] = { ...n[selectedIdx], caption: e.target.value }; return n; })}
                onBlur={e => saveCaption(selectedIdx, e.target.value)}
                placeholder="e.g., I run a healthy 5k every Saturday"
              />
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <span className="muted">Section</span>
                <select
                  value={current.section}
                  onChange={e => changeSection(selectedIdx, e.target.value as SectionKey)}
                >
                  {SECTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <button onClick={() => removeAt(selectedIdx)} className="btn-soft" style={{ marginLeft: "auto" }}>
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Thumbnails (filtered), drag + drop reorder */}
      <div className="card">
        {filtered.length === 0 ? (
          <div className="muted">No images{activeSection !== "all" ? ` in ${SECTIONS.find(s=>s.key===activeSection)?.label}` : ""} yet.</div>
        ) : (
          <div className="vb-grid">
            {filtered.map((img, i) => {
              const idxAll = images.findIndex(x => x.path === img.path);
              const isActive = idxAll === selectedIdx;
              return (
                <div
                  key={img.path}
                  className={`vb-card${isActive ? " vb-active" : ""}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, i)}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, i)}
                  onClick={() => setSelectedIdx(idxAll)}
                  title={img.caption || "Open"}
                >
                  <img src={img.url} alt="" className="vb-thumb" />
                  <div style={{ padding: 8, display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="vb-dot" style={{ background: colorOf(img.section) }} />
                      <div className="vb-caption">{img.caption || "—"}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Vision Board — Help">
        <div style={{ display: "flex", gap: 16 }}>
          {VB_ALFRED_SRC && (
            <img
              src={VB_ALFRED_SRC}
              alt=""
              aria-hidden="true"
              style={{ width: 72, height: 72, flex: "0 0 auto" }}
              onError={() => setImgIdx(i => i + 1)}
            />
          )}
          <div style={{ flex: 1 }}>
            <VisionHelpContent />
          </div>
        </div>
      </Modal>
    </div>
  );
}
