import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabaseClient";

/** Public path helper (Vite/CRA/Vercel/GH Pages) */
function publicPath(p: string) {
  // @ts-ignore
  const base =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) ||
    (typeof process !== "undefined" && (process as any).env?.PUBLIC_URL) ||
    "";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/$/, "")}${withSlash}`;
}

/** Alfred image (your exact path, with fallbacks) */
const VB_ALFRED_CANDIDATES = [
  "/alfred/Vision_Alfred.png",
  "/alfred/Vision_Alfred.jpg",
  "/alfred/Vision_Alfred.jpeg",
  "/alfred/Vision_Alfred.webp",
].map(publicPath);

/** Storage bucket name */
const VISION_BUCKET = "vision";

/* ---------- Life areas (match Goals) ---------- */
const AREAS = [
  { key: "personal",  label: "Personal",  color: "#a855f7" },
  { key: "health",    label: "Health",    color: "#22c55e" },
  { key: "career",    label: "Business",  color: "#3b82f6" }, // stored as 'career'
  { key: "financial", label: "Finance",   color: "#f59e0b" }, // stored as 'financial'
  { key: "other",     label: "Other",     color: "#6b7280" },
] as const;
type AreaKey = typeof AREAS[number]["key"];
const colorOf = (k: AreaKey) => AREAS.find(a => a.key === k)?.color || "#6b7280";

/** Local captions/area/order fallback */
function localKey(userId: string) { return `vb_meta_${userId}`; }
type LocalMeta = Record<string, { caption?: string; area?: AreaKey; order_index?: number }>;
function readLocal(userId: string): LocalMeta {
  try { return JSON.parse(localStorage.getItem(localKey(userId)) || "{}"); } catch { return {}; }
}
function writeLocal(userId: string, meta: LocalMeta) {
  try { localStorage.setItem(localKey(userId), JSON.stringify(meta)); } catch { /* ignore */ }
}

/** Types */
type VBImage = {
  path: string;       // storage path
  url: string;        // public URL
  caption: string;    // optional text
  area: AreaKey;      // life area
  order_index: number;// persistent order
  created_at?: string;
};

type SupaMetaRow = {
  user_id: string;
  path: string;
  caption?: string | null;
  area?: AreaKey | null;
  order_index?: number | null;
};

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
        style={{ maxWidth: 760, width: "100%", background: "#fff", borderRadius: 12,
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

/* ---------- Positive help content ---------- */
function VisionHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.6 }}>
      <h4 style={{ margin: 0 }}>Why a Vision Board?</h4>
      <p>Pictures make goals feel real. See them daily, pair with tiny actions, and momentum compounds.</p>

      <h4 style={{ margin: 0 }}>How to use it</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Upload images that represent what you’re moving toward.</li>
        <li>Add a short affirmation under each image.</li>
        <li>Play your board daily (slideshow).</li>
        <li>Ask: “What’s one small step toward this today?” Then do it.</li>
      </ol>

      <h4 style={{ margin: 0 }}>Alfred’s tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>Specific beats vague (“Run 5k on Saturdays” &gt; “Get fitter”).</li>
        <li>Make it visible—open this page when you start your day.</li>
        <li>Consistency &gt; intensity.</li>
      </ul>
    </div>
  );
}

/* ========================== MAIN PAGE ========================== */

export default function VisionBoardScreen() {
  const [userId, setUserId] = useState<string | null>(null);

  // storage prefix detection
  const [prefix, setPrefix] = useState<"" | "user">(""); // "" = root, "user" = {userId}/
  const [storageReady, setStorageReady] = useState(false);

  const [images, setImages] = useState<VBImage[]>([]);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<10000 | 30000 | 60000>(30000);
  const [shuffle, setShuffle] = useState(false);
  const [filterArea, setFilterArea] = useState<AreaKey | "all">("all");

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Alfred
  const [showHelp, setShowHelp] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const VB_ALFRED_SRC = VB_ALFRED_CANDIDATES[imgIdx] ?? "";

  const fileRef = useRef<HTMLInputElement>(null);
  const canAddMore = images.length < 6;

  const styleTag = (
    <style>{`
      .vb-viewer-img { object-fit: contain !important; }
      .vb-circle-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: 999px;
        border: 1px solid #d1d5db; background: #fff; padding: 0;
        line-height: 1; cursor: pointer; color: #111827;
      }
      .vb-circle-btn--sm { width: 26px; height: 26px; }
      .vb-circle-btn svg { display: block; width: 18px; height: 18px; }
      .vb-circle-btn--sm svg { width: 14px; height: 14px; }
      .vb-circle-btn:hover { background: #f8fafc; }
      .vb-thumb { transition: transform .08s ease; }
      .vb-thumb[aria-grabbed="true"] { transform: scale(1.02); box-shadow: 0 6px 16px rgba(0,0,0,.15); }
      .vb-dropover { outline: 2px dashed #cbd5e1; outline-offset: -2px; }
      .vb-chip { border:1px solid var(--border); border-radius:999px; padding:2px 10px; background:#fff; cursor:pointer; }
      .vb-chip--on { background:#111827; color:#fff; border-color:#111827; }
    `}</style>
  );

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- detect folder prefix, then load images ----- */
  useEffect(() => {
    if (!userId) return;

    const uid = userId as string;

    async function detectAndLoad() {
      setErr(null);
      setStorageReady(false);

      // 1) sanity check: bucket exists
      try {
        const { error: be } = await supabase.storage.from(VISION_BUCKET).list(undefined, { limit: 1 });
        if (be) throw be;
      } catch (e: any) {
        setErr(`Bucket "${VISION_BUCKET}" not found. Create it (Public) in Supabase → Storage.`);
        setImages([]);
        setStorageReady(true);
        return;
      }

      // 2) decide prefix: under {userId}/ or root
      let usePrefix: "" | "user" = "user";
      try {
        const resUser = await supabase.storage.from(VISION_BUCKET).list(uid, { limit: 1 });
        if (resUser.error) throw resUser.error;

        const hasInUser = (resUser.data || []).some((f: any) => !("id" in f && (f as any).id === null));
        if (!hasInUser) {
          const resRoot = await supabase.storage.from(VISION_BUCKET).list(undefined, { limit: 1 });
          if (!resRoot.error && (resRoot.data || []).length > 0) {
            usePrefix = "";
          }
        }
      } catch {
        usePrefix = "";
      }

      setPrefix(usePrefix);

      // 3) load images (up to 6)
      try {
        const listPath: string | undefined = usePrefix === "user" ? uid : undefined;
        const { data, error } = await supabase.storage.from(VISION_BUCKET).list(listPath, {
          sortBy: { column: "created_at", order: "asc" },
        });
        if (error) throw error;

        const files = (data || []).filter((f: any) => !("id" in f && (f as any).id === null));

        // Pull metadata if table exists
        let meta: SupaMetaRow[] = [];
        try {
          const { data: caps, error: capErr } = await supabase
            .from("vision_images")
            .select("path, caption, area, order_index")
            .eq("user_id", uid);
          if (!capErr && Array.isArray(caps)) meta = caps as SupaMetaRow[];
        } catch { /* table may not exist; ignore */ }

        const metaMap = new Map<string, SupaMetaRow>(meta.map(m => [m.path, m]));

        // Merge local fallback
        const local = readLocal(uid);

        // Build VBImage rows
        const rows = files.map((f: any, idx: number) => {
          const path = usePrefix === "user" ? `${uid}/${f.name}` : f.name;
          const { data: pub } = supabase.storage.from(VISION_BUCKET).getPublicUrl(path);
          const m = metaMap.get(path);
          const l = local[path] || {};
          const caption = (m?.caption ?? l.caption ?? "") || "";
          const area = (m?.area ?? l.area ?? "other") as AreaKey;
          // default order: DB > local > created order
          const order_index = (typeof m?.order_index === "number" ? m!.order_index! :
                              typeof l.order_index === "number" ? l.order_index! : idx);
          return { path, url: pub.publicUrl, caption, area, order_index, created_at: (f as any)?.created_at } as VBImage;
        });

        // sort by order_index
        rows.sort((a,b) => (a.order_index ?? 0) - (b.order_index ?? 0));

        setImages(rows.slice(0, 6));
        setSelected(0);
      } catch (e: any) {
        setErr(e.message || String(e));
        setImages([]);
      } finally {
        setStorageReady(true);
      }
    }

    detectAndLoad();
  }, [userId]);

  /* ----- slideshow ----- */
  useEffect(() => {
    if (!playing || images.length === 0) return;
    const id = setInterval(() => {
      setSelected(i => {
        const next = (i + 1) % images.length;
        return next;
      });
    }, speed);
    return () => clearInterval(id);
  }, [playing, speed, images.length]);

  // keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ----- actions ----- */
  const filtered = useMemo(() => {
    return filterArea === "all" ? images : images.filter(i => i.area === filterArea);
  }, [images, filterArea]);

  const current = filtered[selected] || null;
  const canAdd = images.length < 6;

  function prev() {
    if (filtered.length) setSelected(i => (i - 1 + filtered.length) % filtered.length);
  }
  function next() {
    if (filtered.length) setSelected(i => (i + 1) % filtered.length);
  }

  async function handleUpload(files: FileList | null) {
    if (!userId || !files || files.length === 0) return;
    const uid = userId as string;
    setBusy(true); setErr(null);
    try {
      const remaining = Math.max(0, 6 - images.length);
      const toUpload = Array.from(files).slice(0, remaining);
      const newOnes: VBImage[] = [];

      for (let j = 0; j < toUpload.length; j++) {
        const file = toUpload[j];
        const safeName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
        const path = (prefix === "user" ? `${uid}/` : "") + safeName;

        const { error: uerr } = await supabase.storage.from(VISION_BUCKET).upload(path, file, { upsert: false });
        if (uerr) throw uerr;

        const { data: pub } = supabase.storage.from(VISION_BUCKET).getPublicUrl(path);
        const order_index = images.length + newOnes.length; // append

        newOnes.push({ path, url: pub.publicUrl, caption: "", area: "other", order_index });

        // best-effort: create empty meta row
        try {
          await supabase.from("vision_images").upsert(
            { user_id: uid, path, caption: "", area: "other", order_index } as SupaMetaRow,
            { onConflict: "user_id,path" } as any
          );
        } catch { /* ignore */ }
      }

      const updated = [...images, ...newOnes].slice(0, 6);
      updated.sort((a,b)=>a.order_index-b.order_index);
      setImages(updated);
      setFilterArea("all");
      setSelected(0);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function persistMeta(path: string, patch: Partial<VBImage>) {
    if (!userId) return;
    const uid = userId as string;
    // local fallback
    const local = readLocal(uid);
    const prev = local[path] || {};
    local[path] = { ...prev };
    if (patch.caption !== undefined) local[path].caption = patch.caption;
    if (patch.area !== undefined) local[path].area = patch.area;
    if (patch.order_index !== undefined) local[path].order_index = patch.order_index;
    writeLocal(uid, local);
    // supabase best-effort
    try {
      const row: SupaMetaRow = {
        user_id: uid,
        path,
        caption: patch.caption ?? prev.caption ?? null,
        area: (patch.area ?? prev.area ?? "other") as AreaKey,
        order_index: patch.order_index ?? prev.order_index ?? 0
      };
      await supabase.from("vision_images").upsert(row as any, { onConflict: "user_id,path" } as any);
    } catch { /* ignore */ }
  }

  async function saveCaption(idxInFiltered: number, caption: string) {
    const img = filtered[idxInFiltered]; if (!img) return;
    // update in full list
    setImages(prev => prev.map(p => p.path === img.path ? { ...p, caption } : p));
    await persistMeta(img.path, { caption });
  }

  async function setArea(idxInFiltered: number, area: AreaKey) {
    const img = filtered[idxInFiltered]; if (!img) return;
    setImages(prev => prev.map(p => p.path === img.path ? { ...p, area } : p));
    await persistMeta(img.path, { area });
  }

  async function removeAt(idxInFiltered: number) {
    if (!userId) return;
    const img = filtered[idxInFiltered]; if (!img) return;
    setBusy(true); setErr(null);
    try {
      await supabase.storage.from(VISION_BUCKET).remove([img.path]);
      try { await supabase.from("vision_images").delete().eq("user_id", userId).eq("path", img.path); } catch {}
      // remove local meta
      const local = readLocal(userId);
      delete local[img.path];
      writeLocal(userId, local);

      setImages(prev => prev.filter(p => p.path !== img.path).map((p, i) => ({ ...p, order_index: i })));
      setSelected(0);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // drag & drop reorder
  const dragSrc = useRef<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);

  function onDragStart(path: string) {
    dragSrc.current = path;
  }
  function onDragOver(path: string, e: React.DragEvent) {
    e.preventDefault();
    setDropOver(path);
  }
  async function onDrop(targetPath: string) {
    const src = dragSrc.current;
    dragSrc.current = null;
    setDropOver(null);
    if (!src || src === targetPath) return;

    setImages(prev => {
      const arr = prev.slice();
      const from = arr.findIndex(i => i.path === src);
      const to = arr.findIndex(i => i.path === targetPath);
      if (from === -1 || to === -1) return prev;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      // reindex
      arr.forEach((it, i) => it.order_index = i);
      // persist updated orders (best-effort)
      (async () => {
        for (const it of arr) await persistMeta(it.path, { order_index: it.order_index });
      })();
      return arr;
    });
  }

  /* ----- layout helpers ----- */
  const monthLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }, []);

  // EXPORT COLLAGE (1920x1080)
  async function exportBoard() {
    const list = filtered.length ? filtered : images;
    if (!list.length) return;
    const W = 1920, H = 1080;
    const cols = 3, rows = 2; // for up to 6 images
    const cellW = Math.floor(W / cols), cellH = Math.floor(H / rows);

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    // background
    ctx.fillStyle = "#0f172a"; // dark slate to make colors pop
    ctx.fillRect(0,0,W,H);

    // draw each image contain-fit + caption
    for (let idx = 0; idx < Math.min(6, list.length); idx++) {
      const img = list[idx];
      const r = Math.floor(idx / cols), c = idx % cols;
      const x = c * cellW, y = r * cellH;

      try {
        const tag = await loadImage(img.url);
        const scale = Math.min(cellW / tag.width, cellH / tag.height);
        const dw = Math.round(tag.width * scale), dh = Math.round(tag.height * scale);
        const dx = x + Math.floor((cellW - dw) / 2), dy = y + Math.floor((cellH - dh) / 2);
        // photo
        ctx.fillStyle = "#0b1220";
        roundRect(ctx, x+8, y+8, cellW-16, cellH-16, 16); ctx.fill();
        ctx.save(); ctx.beginPath(); roundRect(ctx, x+8, y+8, cellW-16, cellH-16, 16); ctx.clip();
        ctx.drawImage(tag, dx, dy, dw, dh);
        // overlay caption
        if (img.caption) {
          const pad = 14;
          const barH = 44;
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(x+8, y+cellH-8-barH, cellW-16, barH);
          ctx.font = "bold 18px system-ui, -apple-system, Segoe UI, Roboto";
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "middle";
          ctx.fillText(img.caption, x+8+pad, y+cellH-8-barH/2);
        }
        ctx.restore();
      } catch {
        // skip image that failed to load
      }
    }

    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
    if (!blob) return;
    const url = URL.createObjectURL(blob);

    // try native share
    // @ts-ignore
    if (navigator.share && (navigator.canShare?.({ files: [] }) || true)) {
      try {
        const file = new File([blob], "vision-board.png", { type: "image/png" });
        // @ts-ignore
        await navigator.share({ files: [file], title: "My Vision Board" });
        URL.revokeObjectURL(url);
        return;
      } catch { /* fall back to download */ }
    }

    // download
    const a = document.createElement("a");
    a.href = url; a.download = "vision-board.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function shuffleNow() {
    setImages(prev => {
      const arr = prev.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      arr.forEach((it, i) => it.order_index = i);
      (async () => { for (const it of arr) await persistMeta(it.path, { order_index: it.order_index }); })();
      return arr;
    });
    setSelected(0);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {styleTag}

      {/* Title card */}
      <div className="card" style={{ position: "relative", paddingRight: 64 }}>
        {/* Alfred — top-right */}
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Vision Board help"
          title="Need a hand? Ask Alfred"
          style={{
            position: "absolute", top: 8, right: 8,
            border: "none", background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0, zIndex: 10,
          }}
        >
          {VB_ALFRED_SRC ? (
            <img
              src={VB_ALFRED_SRC}
              alt="Vision Board Alfred — open help"
              style={{ width: 48, height: 48 }}
              onError={() => setImgIdx(i => i + 1)}
            />
          ) : (
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 999, border: "1px solid #d1d5db",
              background: "#f9fafb", fontWeight: 700,
            }}>?</span>
          )}
        </button>

        <h1 style={{ margin: 0 }}>Vision Board</h1>
        <div className="muted">{monthLabel}</div>
      </div>

      {/* Controls + Upload */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="muted">Upload up to <strong>6 images</strong>. Drag thumbnails to reorder. Tag by life area.</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => handleUpload(e.target.files)}
            style={{ display: "none" }}
            disabled={!userId || !storageReady || !canAdd || busy}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!userId || !storageReady || !canAdd || busy}
            className="btn-primary"
            style={{ borderRadius: 8 }}
          >
            Upload image
          </button>
          {!canAdd && <span className="muted">Limit reached.</span>}

          {/* Filters */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
            <FilterChip label="All" on={filterArea === "all"} onClick={() => { setFilterArea("all"); setSelected(0); }} />
            {AREAS.map(a => (
              <FilterChip key={a.key}
                label={a.label}
                on={filterArea === a.key}
                onClick={() => { setFilterArea(a.key); setSelected(0); }} />
            ))}
          </div>
        </div>

        {/* Play controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setPlaying(p => !p)} disabled={filtered.length <= 1}>
            {playing ? "Pause" : "Play"}
          </button>
          <select value={String(speed)} onChange={e => setSpeed(Number(e.target.value) as any)} title="Slide duration">
            <option value="10000">10s</option>
            <option value="30000">30s</option>
            <option value="60000">60s</option>
          </select>
          <button onClick={() => { setShuffle(s => !s); if (!playing) setPlaying(true); }} aria-pressed={shuffle}>
            {shuffle ? "Shuffle On" : "Shuffle Off"}
          </button>
          <button onClick={shuffleNow}>Randomize order</button>
          <button onClick={exportBoard} className="btn-soft">Export PNG</button>
        </div>

        {err && <div style={{ color: "red", marginTop: 6 }}>{err}</div>}
      </div>

      {/* Viewer */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        {filtered.length === 0 ? (
          <div className="muted">No images yet. Use <strong>Upload image</strong> above to add your first one.</div>
        ) : (
          <>
            {/* Main image with arrows + caption overlay */}
            <div
              style={{
                position: "relative",
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
                height: 360,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#0b1220",
              }}
            >
              <button
                onClick={prev}
                title="Previous"
                aria-label="Previous"
                className="vb-circle-btn"
                style={{ position: "absolute", top: "50%", left: 8, transform: "translateY(-50%)" }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 4 L7 10 L12 16" />
                </svg>
              </button>
              <button
                onClick={next}
                title="Next"
                aria-label="Next"
                className="vb-circle-btn"
                style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)" }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 4 L13 10 L8 16" />
                </svg>
              </button>

              {current && (
                <>
                  <img
                    key={current.path}
                    src={current.url}
                    alt=""
                    className="vb-viewer-img"
                    style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", display: "block" }}
                  />
                  {/* overlay caption */}
                  {current.caption && (
                    <div
                      style={{
                        position: "absolute", left: 0, right: 0, bottom: 0,
                        background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.65) 70%)",
                        color: "#fff", padding: "22px 16px 14px 16px", fontWeight: 700, fontSize: 18,
                        textShadow: "0 2px 4px rgba(0,0,0,.35)",
                      }}
                    >
                      {current.caption}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Caption + area editor */}
            {current && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={current.caption}
                  onChange={e => {
                    const v = e.target.value;
                    setImages(arr => arr.map(it => it.path === current.path ? { ...it, caption: v } : it));
                  }}
                  onBlur={e => saveCaption(selected, e.target.value)}
                  placeholder="Add an affirmation or caption…"
                  aria-label="Image caption"
                  style={{ flex: 1, minWidth: 220 }}
                />
                <select
                  value={current.area}
                  onChange={e => setArea(selected, e.target.value as AreaKey)}
                  title="Life area"
                >
                  {AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <span title="Area color" style={{ display:"inline-block", width:18, height:18, borderRadius:999, background:colorOf(current.area), border:"1px solid #ccc" }} />
                <button onClick={() => removeAt(selected)} className="btn-soft">Remove</button>
              </div>
            )}

            {/* Thumbnails — drag & drop reorder */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {images.map((img) => {
                const isSel = current?.path === img.path;
                const isDropOver = dropOver === img.path;
                return (
                  <div
                    key={img.path}
                    className={`vb-thumb ${isDropOver ? "vb-dropover" : ""}`}
                    style={{
                      position: "relative",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      overflow: "hidden",
                      outlineOffset: -2,
                    }}
                    draggable
                    aria-grabbed={dragSrc.current === img.path}
                    onDragStart={() => onDragStart(img.path)}
                    onDragOver={(e) => onDragOver(img.path, e)}
                    onDrop={() => onDrop(img.path)}
                  >
                    <button
                      onClick={() => {
                        const idx = filtered.findIndex(f => f.path === img.path);
                        setSelected(idx >= 0 ? idx : 0);
                      }}
                      title={img.caption || "Select"}
                      style={{ padding: 0, border: "none", background: "transparent", width: "100%", lineHeight: 0 }}
                    >
                      <img
                        src={img.url}
                        alt=""
                        style={{
                          width: "100%", height: 90, objectFit: "cover", display: "block",
                          opacity: isSel ? 1 : 0.92, filter: isSel ? "none" : "saturate(0.9)"
                        }}
                      />
                    </button>
                    <div style={{
                      position: "absolute", left: 6, top: 6,
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: "rgba(17,24,39,.8)", color:"#fff", borderRadius: 999, padding: "2px 8px",
                      fontSize: 11, border: "1px solid rgba(255,255,255,.2)"
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(img.area) }} />
                      {AREAS.find(a=>a.key===img.area)?.label ?? "Other"}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Help modal (inline content) */}
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

/* ---------- small UI ---------- */
function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`vb-chip ${on ? "vb-chip--on": ""}`} onClick={onClick} aria-pressed={on}>
      {label}
    </button>
  );
}

/* ---------- utils ---------- */
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function roundRect(ctx: CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y,   x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x,   y+h, rr);
  ctx.arcTo(x,   y+h, x,   y,   rr);
  ctx.arcTo(x,   y,   x+w, y,   rr);
  ctx.closePath();
}
