import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Item = {
  id: number;
  user_id: string;
  storage_path: string;
  public_url: string;
  caption: string | null;
  sort_order: number | null;
  created_at: string;
};

type Mode = "marquee" | "collage";

function isImage(file: File) {
  return /^image\/(png|jpe?g|webp)$/i.test(file.type);
}

export default function VisionBoardScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("vision_mode") as Mode) || "collage");
  const [marqueeIndex, setMarqueeIndex] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("vision_mode", mode);
  }, [mode]);

  async function load() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("vision_items")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) { setErr(error.message); setItems([]); return; }
    setItems((data as Item[]) || []);
    setMarqueeIndex(0);
  }
  useEffect(() => { if (userId) load(); }, [userId]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.currentTarget.value = "";
    if (!userId || files.length === 0) return;
    const remaining = Math.max(0, 6 - items.length);
    const toUpload = files.filter(isImage).slice(0, remaining);
    if (toUpload.length === 0) { alert("Only JPEG/PNG/WebP images are allowed, and max 6 total."); return; }

    setUploading(true); setErr(null);
    try {
      for (const f of toUpload) {
        const cleanName = f.name.replace(/[^\w.\-]+/g, "_").toLowerCase();
        const path = `${userId}/${Date.now()}-${cleanName}`;
        const up = await supabase.storage.from("vision").upload(path, f, { cacheControl: "3600", upsert: false });
        if (up.error) throw up.error;

        const pub = supabase.storage.from("vision").getPublicUrl(path);
        const publicUrl = pub.data.publicUrl;

        const { error: insErr } = await supabase.from("vision_items").insert({
          user_id: userId,
          storage_path: path,
          public_url: publicUrl,
          caption: null
        });
        if (insErr) throw insErr;
      }
      await load();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setUploading(false);
    }
  }

  async function saveCaption(id: number, caption: string) {
    setBusy(true);
    const { error } = await supabase.from("vision_items").update({ caption }).eq("id", id);
    if (error) setErr(error.message);
    setBusy(false);
  }

  async function removeItem(it: Item) {
    if (!confirm("Remove this image from your vision board?")) return;
    setBusy(true); setErr(null);
    try {
      await supabase.storage.from("vision").remove([it.storage_path]);
      const { error } = await supabase.from("vision_items").delete().eq("id", it.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function move(id: number, dir: -1 | 1) {
    const idx = items.findIndex(x => x.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= items.length) return;
    const a = items[idx], b = items[j];
    setBusy(true);
    try {
      const aOrder = a.sort_order ?? idx;
      const bOrder = b.sort_order ?? j;
      const { error: e1 } = await supabase.from("vision_items").update({ sort_order: 9999 }).eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("vision_items").update({ sort_order: aOrder }).eq("id", b.id);
      if (e2) throw e2;
      const { error: e3 } = await supabase.from("vision_items").update({ sort_order: bOrder }).eq("id", a.id);
      if (e3) throw e3;
      await load();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const canAddMore = items.length < 6;
  const disabled = uploading || busy;

  return (
    <div>
      <h1>Vision Board</h1>

      <div className="card" style={{ marginTop: 8, marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="section-title">Mode</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={mode === "collage" ? "tab" : ""} onClick={() => setMode("collage")}>Collage</button>
          <button className={mode === "marquee" ? "tab" : ""} onClick={() => setMode("marquee")}>Marquee</button>
        </div>

        <div style={{ marginLeft: "auto" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={onUpload} disabled={!canAddMore || disabled} />
            <span className="muted">{canAddMore ? `You can add ${6 - items.length} more` : "Limit reached (6)"}</span>
          </label>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ color: "#666" }}>
          Add up to six images that capture your future. You can give each a short caption.
        </div>
      ) : mode === "collage" ? (
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {items.map((it, idx) => (
              <figure key={it.id} style={{ margin: 0 }}>
                <div style={{ position: "relative" }}>
                  <img src={it.public_url} alt={it.caption ?? `Vision ${idx + 1}`} style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 10, border: "1px solid #e5e7eb" }} />
                  <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                    <button onClick={() => move(it.id, -1)} disabled={disabled || idx === 0}>↑</button>
                    <button onClick={() => move(it.id, +1)} disabled={disabled || idx === items.length - 1}>↓</button>
                    <button onClick={() => removeItem(it)} disabled={disabled}>Delete</button>
                  </div>
                </div>
                <figcaption style={{ marginTop: 6 }}>
                  <input
                    placeholder="Add a short caption…"
                    defaultValue={it.caption ?? ""}
                    onBlur={(e) => { if (e.currentTarget.value !== (it.caption || "")) saveCaption(it.id, e.currentTarget.value); }}
                  />
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{ display: "grid", gridTemplateRows: "1fr auto", gap: 10 }}>
          {/* Simple manual carousel */}
          <div style={{ position: "relative", minHeight: 260 }}>
            {items.map((it, idx) => (
              <div key={it.id} style={{
                position: idx === marqueeIndex ? "relative" : "absolute",
                inset: 0,
                opacity: idx === marqueeIndex ? 1 : 0,
                transition: "opacity .25s ease"
              }}>
                <img src={it.public_url} alt={it.caption ?? `Vision ${idx + 1}`} style={{ width: "100%", height: 340, objectFit: "cover", borderRadius: 12, border: "1px solid #e5e7eb" }} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <input
                    placeholder="Add a short caption…"
                    defaultValue={it.caption ?? ""}
                    onBlur={(e) => { if (e.currentTarget.value !== (it.caption || "")) saveCaption(it.id, e.currentTarget.value); }}
                    style={{ flex: 1, marginRight: 8 }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => move(it.id, -1)} disabled={disabled || marqueeIndex === 0}>↑</button>
                    <button onClick={() => move(it.id, +1)} disabled={disabled || marqueeIndex === items.length - 1}>↓</button>
                    <button onClick={() => removeItem(it)} disabled={disabled}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            <button onClick={() => setMarqueeIndex(i => Math.max(0, i - 1))} disabled={marqueeIndex === 0}>Prev</button>
            <div className="muted">{marqueeIndex + 1} / {items.length}</div>
            <button onClick={() => setMarqueeIndex(i => Math.min(items.length - 1, i + 1))} disabled={marqueeIndex === items.length - 1}>Next</button>
          </div>
        </div>
      )}

      {err && <div style={{ color: "red", marginTop: 12 }}>{err}</div>}
    </div>
  );
}
