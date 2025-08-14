import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type VisionItem = {
  id: number;
  user_id: string;
  image_url: string;
  storage_path: string | null;
  caption: string | null;
  sort_order: number | null;
  created_at?: string;
};

const MAX_ITEMS = 6;
const SLIDESHOW_MS = 30000; // 30 seconds per image

export default function VisionBoardScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<VisionItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Lightbox viewer state
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState<boolean>(false);
  const playTimerRef = useRef<number | null>(null);

  /* ---- auth ---- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ---- load items ---- */
  useEffect(() => { if (userId) loadItems(); }, [userId]);

  async function loadItems() {
    if (!userId) return;
    setErr(null);
    const { data, error } = await supabase
      .from("vision_items")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) { setErr(error.message); setItems([]); return; }
    setItems((data as VisionItem[]) || []);
  }

  /* ---- upload ---- */
  function triggerFile() {
    fileInputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    e.target.value = "";
    if (!file.type.startsWith("image/")) { setErr("Please choose an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { setErr("Image is too large (max 10MB)."); return; }

    setUploading(true); setErr(null);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("vision").upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("vision").getPublicUrl(path);
      const image_url = pub.publicUrl;

      const nextOrder = items.length ? Math.max(...items.map(i => i.sort_order ?? 0)) + 1 : 0;
      const { error: insErr } = await supabase
        .from("vision_items")
        .insert({
          user_id: userId,
          image_url,
          storage_path: path,
          caption: null,
          sort_order: nextOrder
        });
      if (insErr) throw insErr;

      await loadItems();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setUploading(false);
    }
  }

  /* ---- caption update ---- */
  async function saveCaption(it: VisionItem, caption: string) {
    const { error } = await supabase
      .from("vision_items")
      .update({ caption })
      .eq("id", it.id);
    if (error) { setErr(error.message); return; }
    setItems(items.map(x => x.id === it.id ? { ...x, caption } : x));
  }

  /* ---- delete ---- */
  async function removeItem(it: VisionItem) {
    setErr(null);
    const { error: delErr } = await supabase.from("vision_items").delete().eq("id", it.id);
    if (delErr) { setErr(delErr.message); return; }
    if (it.storage_path) {
      const { error: storErr } = await supabase.storage.from("vision").remove([it.storage_path]);
      if (storErr) setErr(`Removed from board, but not storage: ${storErr.message}`);
    }
    // Adjust viewer index if open
    if (viewIdx !== null) {
      if (items.length <= 1) { setViewIdx(null); setPlaying(false); }
      else {
        setViewIdx(prev => {
          if (prev == null) return null;
          const removedAt = items.findIndex(x => x.id === it.id);
          const next = Math.max(0, Math.min(prev, items.length - 2));
          return removedAt === prev ? next : prev > removedAt ? prev - 1 : prev;
        });
      }
    }
    await loadItems();
  }

  /* ---- viewer (lightbox) helpers ---- */
  function openViewer(i: number) { setViewIdx(i); }
  function closeViewer() {
    setViewIdx(null);
    setPlaying(false);
  }
  function next() {
    if (viewIdx == null || items.length === 0) return;
    setViewIdx((viewIdx + 1) % items.length);
  }
  function prev() {
    if (viewIdx == null || items.length === 0) return;
    setViewIdx((viewIdx - 1 + items.length) % items.length);
  }

  // Keyboard support for viewer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (viewIdx == null) return;
      if (e.key === "Escape") { e.preventDefault(); closeViewer(); }
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); setPlaying(p => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewIdx, items.length]);

  // Slideshow timer
  useEffect(() => {
    if (!playing || viewIdx == null || items.length < 2) {
      if (playTimerRef.current) {
        window.clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }
    playTimerRef.current = window.setInterval(() => {
      setViewIdx(i => (i == null ? 0 : (i + 1) % items.length));
    }, SLIDESHOW_MS);
    return () => {
      if (playTimerRef.current) {
        window.clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [playing, viewIdx, items.length]);

  // If items change while viewing, keep index in range
  useEffect(() => {
    if (viewIdx != null && viewIdx >= items.length) {
      setViewIdx(items.length ? items.length - 1 : null);
    }
  }, [items.length, viewIdx]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* page styles for lightbox */}
      <style>{CSS_LIGHTBOX}</style>

      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>Vision Board</h1>
          <div className="muted">
            Up to {MAX_ITEMS} images. Click to view; use arrows (or keys) to cycle. Start a 30s slideshow from the viewer.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            style={{ display: "none" }}
          />
          <button
            className="btn-primary"
            onClick={triggerFile}
            disabled={!userId || items.length >= MAX_ITEMS || uploading}
            style={{ borderRadius: 8 }}
            title={items.length >= MAX_ITEMS ? "Maximum reached" : "Upload image"}
          >
            {uploading ? "Uploading…" : items.length >= MAX_ITEMS ? "Max reached" : "Upload image"}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="card" style={{ padding: 12 }}>
        {items.length === 0 && <div className="muted">No images yet. Upload your first vision image.</div>}

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12
        }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden", display: "grid", gridTemplateRows: "auto auto", background: "#fff" }}>
              <div
                style={{ position: "relative", aspectRatio: "4/3", background: "#f8f9fa", cursor: "zoom-in" }}
                onClick={() => openViewer(idx)}
                title="Click to view"
              >
                <img
                  src={it.image_url}
                  alt={it.caption || "Vision"}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                {/* delete */}
                <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}>
                  <button onClick={(e) => { e.stopPropagation(); removeItem(it); }} title="Delete" style={{ padding: "4px 8px" }}>×</button>
                </div>
                {/* nav (no reorder any more) */}
                <div style={{ position: "absolute", bottom: 6, left: 6, display: "flex", gap: 6 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewIdx((idx - 1 + items.length) % items.length); }}
                    title="Previous"
                  >←</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewIdx((idx + 1) % items.length); }}
                    title="Next"
                  >→</button>
                </div>
              </div>

              <div style={{ padding: 8, display: "grid", gap: 6 }}>
                <input
                  placeholder="Add a short caption (optional)"
                  defaultValue={it.caption || ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if ((it.caption || "") !== v) saveCaption(it, v || null as any);
                  }}
                />
                <div className="muted" style={{ fontSize: 12 }}>
                  {it.storage_path ? <span>Stored: {it.storage_path.split("/").slice(-1)[0]}</span> : <span>External</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {err && <div style={{ color: "red", marginTop: 12 }}>{err}</div>}
      </div>

      {/* Lightbox viewer */}
      {viewIdx !== null && items[viewIdx] && (
        <div className="vb-lightbox" onClick={closeViewer} role="dialog" aria-modal="true">
          <div className="vb-sheet" onClick={(e) => e.stopPropagation()}>
            <img
              src={items[viewIdx].image_url}
              alt={items[viewIdx].caption || "Vision"}
              className="vb-img"
            />
            {items[viewIdx].caption && <div className="vb-cap">{items[viewIdx].caption}</div>}

            <div className="vb-controls">
              <button onClick={prev} aria-label="Previous">← Prev</button>
              {items.length > 1 && (
                <button onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pause slideshow" : "Play slideshow"}>
                  {playing ? "Pause" : "Play 30s"}
                </button>
              )}
              <button onClick={next} aria-label="Next">Next →</button>
            </div>

            <button className="vb-close" onClick={closeViewer} aria-label="Close">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- simple lightbox styles (uses your theme vars) --- */
const CSS_LIGHTBOX = `
.vb-lightbox{
  position: fixed; inset: 0; z-index: 60;
  background: rgba(0,0,0,.6);
  display: grid; place-items: center;
  padding: 24px;
}
.vb-sheet{
  position: relative;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  max-width: min(100%, 960px);
  width: 100%;
  box-shadow: var(--shadow);
  padding: 16px;
}
.vb-img{
  width: 100%; height: auto; display: block;
  max-height: calc(80vh - 100px);
  object-fit: contain;
  border-radius: 8px;
  background: #f8f9fa;
}
.vb-cap{
  margin-top: 8px;
  text-align: center;
  color: var(--muted);
}
.vb-close{
  position: absolute; top: 8px; right: 8px;
  padding: 4px 10px; border-radius: 8px;
}
.vb-controls{
  margin-top: 10px;
  display: flex; gap: 8px; justify-content: center; align-items: center;
}
@media (max-width: 520px){
  .vb-sheet{ padding: 10px; }
  .vb-img{ max-height: calc(80vh - 80px); }
}
`;
