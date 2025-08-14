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
const SLIDESHOW_MS = 30000; // 30s per image

export default function VisionBoardScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<VisionItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline viewer state (no overlay)
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const playTimerRef = useRef<number | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

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
    const list = (data as VisionItem[]) || [];
    setItems(list);
    if (list.length) setCurrentIdx(i => Math.min(i, list.length - 1));
    else { setCurrentIdx(0); setPlaying(false); }
  }

  /* ---- upload ---- */
  function triggerFile() { fileInputRef.current?.click(); }

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
        .insert({ user_id: userId, image_url, storage_path: path, caption: null, sort_order: nextOrder });
      if (insErr) throw insErr;

      await loadItems();
      // jump to the newly added image
      setCurrentIdx(items.length);
      viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setUploading(false);
    }
  }

  /* ---- caption update ---- */
  async function saveCaption(it: VisionItem, caption: string) {
    const { error } = await supabase.from("vision_items").update({ caption }).eq("id", it.id);
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
    await loadItems();
    // keep viewer in range
    setCurrentIdx(i => Math.min(i, Math.max(0, items.length - 2)));
  }

  /* ---- inline viewer nav ---- */
  function next() {
    if (!items.length) return;
    setCurrentIdx(i => (i + 1) % items.length);
  }
  function prev() {
    if (!items.length) return;
    setCurrentIdx(i => (i - 1 + items.length) % items.length);
  }

  // Keyboard support for viewer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!items.length) return;
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); prev(); }
      if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); setPlaying(p => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);

  // Slideshow timer
  useEffect(() => {
    if (!playing || !items.length) {
      if (playTimerRef.current) { window.clearInterval(playTimerRef.current); playTimerRef.current = null; }
      return;
    }
    playTimerRef.current = window.setInterval(() => setCurrentIdx(i => (i + 1) % items.length), SLIDESHOW_MS);
    return () => {
      if (playTimerRef.current) { window.clearInterval(playTimerRef.current); playTimerRef.current = null; }
    };
  }, [playing, items.length]);

  // When clicking a tile, show it in the viewer (and scroll to viewer)
  function showAt(i: number) {
    setCurrentIdx(i);
    viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <style>{CSS_VIEWER}</style>

      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>Vision Board</h1>
          <div className="muted">
            Up to {MAX_ITEMS} images. View on-page, cycle with arrows (or keys), or play a 30s slideshow.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
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

      {/* Inline viewer */}
      {items.length > 0 && (
        <div className="card card--wash" ref={viewerRef}>
          <div className="vb-inline">
            <button className="vb-arrow vb-left" onClick={prev} aria-label="Previous">←</button>

            <div className="vb-stage">
              <img
                key={items[currentIdx].id}
                src={items[currentIdx].image_url}
                alt={items[currentIdx].caption || "Vision"}
                className="vb-img"
              />
              <div className="vb-meta">
                <div className="vb-cap">{items[currentIdx].caption || ""}</div>
                <div className="vb-count muted">{currentIdx + 1} / {items.length}</div>
              </div>
            </div>

            <button className="vb-arrow vb-right" onClick={next} aria-label="Next">→</button>
          </div>

          <div className="vb-controls">
            <button onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pause slideshow" : "Play slideshow"}>
              {playing ? "Pause" : "Play 30s"}
            </button>
          </div>
        </div>
      )}

      {/* Grid of tiles (click to show in viewer). No reordering arrows anymore. */}
      <div className="card" style={{ padding: 12 }}>
        {items.length === 0 && <div className="muted">No images yet. Upload your first vision image.</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden", display: "grid", gridTemplateRows: "auto auto", background: "#fff" }}>
              <div
                style={{ position: "relative", aspectRatio: "4/3", background: "#f8f9fa", cursor: "pointer" }}
                onClick={() => showAt(idx)}
                title="View"
              >
                <img src={it.image_url} alt={it.caption || "Vision"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                {/* delete */}
                <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}>
                  <button onClick={(e) => { e.stopPropagation(); removeItem(it); }} title="Delete" style={{ padding: "4px 8px" }}>×</button>
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
    </div>
  );
}

/* --- inline viewer styles --- */
const CSS_VIEWER = `
.vb-inline{
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  gap: 8px;
  align-items: center;
}
.vb-stage{
  position: relative;
  background: #f8f9fa;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
}
.vb-img{
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #f8f9fa;
}
.vb-meta{
  position: absolute;
  left: 8px; right: 8px; bottom: 8px;
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px;
}
.vb-cap{ 
  background: rgba(255,255,255,.85);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 8px;
  max-width: 70%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vb-count{ background: rgba(255,255,255,.85); border-radius: 8px; padding: 2px 8px; }

.vb-arrow{
  height: 40px; width: 40px;
  border-radius: 999px;
}
.vb-left{ justify-self: start; }
.vb-right{ justify-self: end; }

.vb-controls{
  display: flex; justify-content: center; gap: 8px; margin-top: 8px;
}

@media (max-width: 520px){
  .vb-inline{ grid-template-columns: 32px 1fr 32px; }
  .vb-arrow{ height: 32px; width: 32px; }
}
`;
