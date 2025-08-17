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

/** Types */
type VBImage = {
  path: string;       // storage path
  url: string;        // public URL
  caption: string;    // optional text
  created_at?: string;
};

/* ---------- Modal shell ---------- */
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

/* ---------- Inline help content ---------- */
function VisionHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <h4 style={{ margin: 0 }}>Introduction / Motivation</h4>
      <p><em>“If you look at what you want every day and really imagine it you can make it your reality, well if you believe some sort of secret. We don’t believe that but if you vision what you want and actually take steps to get there then it is possible”</em></p>

      <h4 style={{ margin: 0 }}>Step-by-Step Guidance</h4>
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        <li>Upload some images of things you would like to have in your life</li>
        <li>You can add some text to each picture that makes it more personal to you</li>
        <li>Once you have your images in place you can either scroll through by pressing the left and right arrows on the top image</li>
        <li>You can watch it as a slide show by pressing <strong>Play 30s</strong> (this will scroll the images every 30 seconds)</li>
        <li>When you look at each image you should imagine they are already in your life, really vividly imagine yourself in the picture with whatever items are there.</li>
      </ol>

      <h4 style={{ margin: 0 }}>Alfred’s Tips</h4>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li>You can make dreams come to your reality if you imagine what it will be like to already have them</li>
        <li>Think about what you will need to do to make it real and start doing the things it will take</li>
      </ul>

      <h4 style={{ margin: 0 }}>Closing Note</h4>
      <p><em>“You can manifest what you want if you work hard enough to get it. Seeing the things you want every day should be your motivation”</em></p>
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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Alfred
  const [showHelp, setShowHelp] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const VB_ALFRED_SRC = VB_ALFRED_CANDIDATES[imgIdx] ?? "";

  const fileRef = useRef<HTMLInputElement>(null);
  const canAddMore = images.length < 6;
  const current = images[selected] || null;

  /* ----- local CSS to keep icons perfectly centered ----- */
  const styleTag = (
    <style>{`
      .vb-viewer-img { object-fit: contain !important; }
      .vb-circle-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: 999px;
        border: 1px solid #d1d5db; background: #fff; padding: 0;
        line-height: 1; cursor: pointer; color: #111827;
      }
      .vb-circle-btn--sm {
        width: 26px; height: 26px;
      }
      .vb-circle-btn svg { display: block; width: 18px; height: 18px; }
      .vb-circle-btn--sm svg { width: 14px; height: 14px; }
      .vb-circle-btn:hover { background: #f8fafc; }
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
        const rows: VBImage[] = files.map((f: any) => {
          const path = usePrefix === "user" ? `${uid}/${f.name}` : f.name;
          const { data: pub } = supabase.storage.from(VISION_BUCKET).getPublicUrl(path);
          return { path, url: pub.publicUrl, caption: "", created_at: (f as any)?.created_at };
        });

        // optional captions table
        try {
          const { data: caps } = await supabase
            .from("vision_images")
            .select("path, caption")
            .eq("user_id", uid);
          if (caps && Array.isArray(caps)) {
            const map = new Map<string, string>(caps.map((c: any) => [c.path, c.caption || ""]));
            rows.forEach(r => { r.caption = map.get(r.path) || ""; });
          }
        } catch { /* table may not exist; ignore */ }

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

  /* ----- slideshow every 30s ----- */
  useEffect(() => {
    if (!playing || images.length === 0) return;
    const id = setInterval(() => setSelected(i => (i + 1) % images.length), 30000);
    return () => clearInterval(id);
  }, [playing, images.length]);

  /* ----- actions ----- */
  function prev() { if (images.length) setSelected(i => (i - 1 + images.length) % images.length); }
  function next() { if (images.length) setSelected(i => (i + 1) % images.length); }

  async function handleUpload(files: FileList | null) {
    if (!userId || !files || files.length === 0) return;
    const uid = userId as string;
    setBusy(true); setErr(null);
    try {
      const remaining = Math.max(0, 6 - images.length);
      const toUpload = Array.from(files).slice(0, remaining);
      const newOnes: VBImage[] = [];

      for (const file of toUpload) {
        const safeName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
        const path = (prefix === "user" ? `${uid}/` : "") + safeName;

        const { error: uerr } = await supabase.storage.from(VISION_BUCKET).upload(path, file, { upsert: false });
        if (uerr) throw uerr;

        const { data: pub } = supabase.storage.from(VISION_BUCKET).getPublicUrl(path);
        newOnes.push({ path, url: pub.publicUrl, caption: "" });

        // best-effort: persist caption row
        try { await supabase.from("vision_images").insert({ user_id: uid, path, caption: "" }); } catch {}
      }

      const updated = [...images, ...newOnes].slice(0, 6);
      setImages(updated);
      if (images.length === 0 && updated.length > 0) setSelected(0);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCaption(idx: number, caption: string) {
    const img = images[idx]; if (!img || !userId) return;
    const uid = userId as string;
    const nextImgs = images.slice(); nextImgs[idx] = { ...img, caption };
    setImages(nextImgs);
    try {
      await supabase.from("vision_images").upsert(
        { user_id: uid, path: img.path, caption },
        { onConflict: "user_id,path" } as any
      );
    } catch {}
  }

  async function removeAt(idx: number) {
    if (!userId) return;
    const img = images[idx]; if (!img) return;
    setBusy(true); setErr(null);
    try {
      await supabase.storage.from(VISION_BUCKET).remove([img.path]);
      try { await supabase.from("vision_images").delete().eq("user_id", userId).eq("path", img.path); } catch {}
      const next = images.filter((_, i) => i !== idx);
      setImages(next);
      setSelected(Math.max(0, Math.min(selected, next.length - 1)));
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ----- layout helpers ----- */
  const monthLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }, []);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {styleTag}

      {/* Title card ONLY */}
      <div className="card" style={{ position: "relative", paddingRight: 64 }}>
        {/* Alfred — top-right */}
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Open Vision Board help"
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
          {VB_ALFRED_SRC ? (
            <img
              src={VB_ALFRED_SRC}
              alt="Vision Board Alfred — open help"
              style={{ width: 48, height: 48 }}
              onError={() => setImgIdx(i => i + 1)}
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

        <h1 style={{ margin: 0 }}>Vision Board</h1>
        <div className="muted">{monthLabel}</div>
      </div>

      {/* Info + Upload BELOW the title */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="muted">
          You can upload up to <strong>6 images</strong> for your vision board.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => handleUpload(e.target.files)}
            style={{ display: "none" }}
            disabled={!userId || !storageReady || !canAddMore || busy}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!userId || !storageReady || !canAddMore || busy}
            className="btn-primary"
            style={{ borderRadius: 8 }}
          >
            Upload image
          </button>
          {!canAddMore && <span className="muted">Limit reached.</span>}
          <button onClick={() => setPlaying(p => !p)} disabled={images.length <= 1} style={{ marginLeft: "auto" }}>
            {playing ? "Pause" : "Play 30s"}
          </button>
        </div>
        {err && <div style={{ color: "red", marginTop: 6 }}>{err}</div>}
      </div>

      {/* Viewer */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        {images.length === 0 ? (
          <div className="muted">No images yet. Use <strong>Upload image</strong> above to add your first one.</div>
        ) : (
          <>
            {/* Main image with arrows — no cropping, centered */}
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
                background: "#f8fafc",
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
                <img
                  key={current.path}
                  src={current.url}
                  alt=""
                  className="vb-viewer-img"
                  style={{
                    width: "100%",
                    height: "100%",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    display: "block",
                  }}
                />
              )}
            </div>

            {/* Caption editor for selected — input only */}
            {current && (
              <div>
                <input
                  value={current.caption}
                  onChange={e => {
                    const v = e.target.value;
                    setImages(imgs => {
                      const copy = imgs.slice();
                      copy[selected] = { ...copy[selected], caption: v };
                      return copy;
                    });
                  }}
                  onBlur={e => saveCaption(selected, e.target.value)}
                  placeholder="Add text for this image here"
                  aria-label="Image caption"
                />
              </div>
            )}

            {/* Thumbnails */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
              {images.map((img, i) => (
                <div key={img.path} style={{ position: "relative", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <button
                    onClick={() => setSelected(i)}
                    title={img.caption || "Select"}
                    style={{ padding: 0, border: "none", background: "transparent", width: "100%", lineHeight: 0 }}
                  >
                    <img src={img.url} alt="" style={{ width: "100%", height: 80, objectFit: "cover", display: "block", opacity: i === selected ? 1 : 0.9 }} />
                  </button>
                  <button
                    onClick={() => removeAt(i)}
                    title="Remove"
                    aria-label="Remove"
                    className="vb-circle-btn vb-circle-btn--sm"
                    style={{ position: "absolute", top: 6, right: 6 }}
                  >
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M5 5 L15 15" />
                      <path d="M15 5 L5 15" />
                    </svg>
                  </button>
                </div>
              ))}
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
