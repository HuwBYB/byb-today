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

export default function VisionBoardScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<VisionItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    // reset the input so choosing the same file again re-triggers
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
    // Delete DB row first
    const { error: delErr } = await supabase.from("vision_items").delete().eq("id", it.id);
    if (delErr) { setErr(delErr.message); return; }
    // Then try to remove the storage object (if we have the path)
    if (it.storage_path) {
      const { error: storErr } = await supabase.storage.from("vision").remove([it.storage_path]);
      // If storage removal fails, we just log the error to UI; DB row is already removed.
      if (storErr) setErr(`Removed from board, but not storage: ${storErr.message}`);
    }
    await loadItems();
  }

  /* ---- reorder ---- */
  function canMoveLeft(index: number) { return index > 0; }
  function canMoveRight(index: number) { return index < items.length - 1; }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const newItems = [...items];
    const tmp = newItems[index];
    newItems[index] = newItems[j];
    newItems[j] = tmp;
    // renumber sort_order by array position
    const updates = newItems.map((it, idx) => ({ id: it.id, sort_order: idx }));
    setItems(newItems);
    // Persist: update just the two that changed is fine, but with only 6 we can update all
    for (const u of updates) {
      await supabase.from("vision_items").update({ sort_order: u.sort_order }).eq("id", u.id);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>Vision Board</h1>
          <div className="muted">Up to {MAX_ITEMS} images. Drag-free reorder with left/right arrows.</div>
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
              <div style={{ position: "relative", aspectRatio: "4/3", background: "#f8f9fa" }}>
                <img
                  src={it.image_url}
                  alt={it.caption || "Vision"}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                {/* reorder + delete */}
                <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}>
                  <button onClick={() => removeItem(it)} title="Delete" style={{ padding: "4px 8px" }}>×</button>
                </div>
                <div style={{ position: "absolute", bottom: 6, left: 6, display: "flex", gap: 6 }}>
                  <button onClick={() => move(idx, -1)} disabled={!canMoveLeft(idx)} title="Move left">←</button>
                  <button onClick={() => move(idx, +1)} disabled={!canMoveRight(idx)} title="Move right">→</button>
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
