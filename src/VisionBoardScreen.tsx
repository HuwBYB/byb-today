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

  // storage detection
  const [bucket, setBucket] = useState<string | null>(null);
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

  /* ----- auth ----- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setUserId(data.user?.id ?? null);
    });
  }, []);

  /* ----- detect bucket + folder prefix, then load images ----- */
  useEffect(() => {
    if (!userId) return;

    const uid = userId as string; // non-null here

    const envBucket =
      (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_VISION_BUCKET) ||
      (typeof process !== "undefined" && (process as any).env?.VITE_VISION_BUCKET) ||
      "";

    const BUCKET_CANDIDATES = Array.from(
      new Set([envBucket, "vision_board", "visionboard"].filter(Boolean))
    );

    async function bucketExists(name: string) {
      try {
        const { error } = await supabase.storage.from(name).list(undefined, { limit: 1 });
        return !error;
      } catch {
        return false;
      }
    }

    async function detect() {
      setErr(null);
      setStorageReady(false);

      // 1) find a bucket that exists
      let chosen: string | null = null;
      for (const name of BUCKET_CANDIDATES) {
        if (await bucketExists(name)) { chosen = name; break; }
      }
      if (!chosen) {
        setErr(
          `Storage bucket not found. Tried: ${BUCKET_CANDIDATES.map((b) => `"${b}"`).join(", ")}. ` +
          `Create one in Supabase Studio (public) or set VITE_VISION_BUCKET.`
        );
        setBucket(null);
        setImages([]);
        setStorageReady(true);
        return;
      }

      // 2) decide prefix: under {userId}/ or root
      let usePrefix: "" | "user" = "user";
      try {
        const resUser = await supabase.storage.from(chosen).list(uid, { limit: 1 }); // uid is string
        if (resUser.error) throw resUser.error;

        const hasInUser = (resUser.data || []).some((f: any) => !("id" in f && (f as any).id === null));
        if (!hasInUser) {
          const resRoot = await supabase.storage.from(chosen).list(undefined, { limit: 1 });
          if (!resRoot.error && (resRoot.data || []).length > 0) {
            usePrefix = "";
          }
        }
      } catch {
        usePrefix = "";
      }

      setBucket(chosen);
      setPrefix(usePrefix);

      // 3) load images (up to 6)
      try {
        const listPath: string | undefined = usePrefix === "user" ? uid : undefined;
        const { data, error } = await supabase.storage.from(chosen).list(listPath, {
          sortBy: { column: "created_at", order: "asc" },
        });
        if (error) throw error;

        const files = (data || []).filter((f: any) => !("id" in f && (f as any).id === null));
        const rows: VBImage[] = files.map((f: any) => {
          const path = usePrefix === "user" ? `${uid}/${f.name}` : f.name;
          const { data: pub } = supabase.storage.from(chosen).getPublicUrl(path);
          return { path, url: pub.publicUrl, caption: "", created_at: (f as any)?.created_at };
        });

        //
