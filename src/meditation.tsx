// src/meditation.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* =========================
   Types & constants
========================= */
type Video = { id: string; title: string; url: string };
type View = "gallery" | "tv";

const STORAGE_KEY = "byb.meditationCentre.videos";
const MAX_VIDEOS = 10;

/** Your starter videos */
const SEEDS: Partial<Video>[] = [
  { title: "Starter: 10-min Calm", url: "https://youtu.be/j734gLbQFbU?si=6AnHq5m0lLMu7zrW" },
  { title: "Starter: Focus Reset", url: "https://youtu.be/cyMxWXlX9sU?si=HyfDOCQuFNY9chFP" },
  { title: "Starter: Deep Relax",  url: "https://youtu.be/P-8ALcF8AGE?si=JCtNqvsaKfxDLhdO" },
];

/* =========================
   Utils
========================= */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (m) return m[1];
    }
    if (u.hostname.includes("youtu.be")) {
      const short = u.pathname.replace("/", "");
      if (short) return short;
    }
    const loose = url.match(/([a-zA-Z0-9_-]{6,})/g)?.find((x) => x.length >= 6);
    return loose || null;
  } catch {
    return null;
  }
}
const thumbUrl = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

function dedupeById(list: Video[]): Video[] {
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const v of list) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

/** Load YT iframe API once and share the promise */
let ytPromise: Promise<any> | null = null;
function loadYouTubeAPI(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if ((window as any).YT?.Player) return Promise.resolve((window as any).YT);
  if (ytPromise) return ytPromise;

  ytPromise = new Promise((resolve) => {
    const w = window as any;
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
    w.onYouTubeIframeAPIReady = () => resolve(w.YT);
  });
  return ytPromise;
}

/* =========================
   Component
========================= */
export default function MeditationScreen() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [view, setView] = useState<View>("gallery");
  const [active, setActive] = useState<Video | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load saved list or seeds on first run
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Video[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setVideos(parsed);
          return;
        }
      } catch { /* ignore */ }
    }
    // First run – load seeds
    const prepared: Video[] = SEEDS.map((s, i) => {
      const id = extractYouTubeId(s.url || "") || `seed-${i}`;
      return { id, title: s.title || `Video ${i + 1}`, url: s.url || "" } as Video;
    });
    setVideos(prepared);
  }, []);

  // Persist
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  }, [videos]);

  const canAddMore = videos.length < MAX_VIDEOS;

  function addVideo() {
    setError(null);
    const id = extractYouTubeId((formUrl || "").trim() || "");
    if (!id) return setError("Please paste a valid YouTube link.");
    const title = (formTitle || "Untitled").trim();
    setVideos((v) => dedupeById([...v, { id, title, url: (formUrl || "").trim() }]).slice(0, MAX_VIDEOS));
    setFormTitle("");
    setFormUrl("");
    setFormOpen(false);
  }

  function removeVideo(idx: number) {
    setVideos((v) => v.filter((_, i) => i !== idx));
    if (active && videos[idx]?.id === active.id) {
      setActive(null);
      setView("gallery");
    }
  }

  function restoreStarters() {
    const starters: Video[] = SEEDS.map((s, i) => {
      const id = extractYouTubeId(s.url || "") || `seed-${i}`;
      return { id, title: s.title || `Video ${i + 1}`, url: s.url || "" } as Video;
    });
    setVideos(starters);
    setActive(null);
    setView("gallery");
  }

  /* =========================
     TV player
  ========================= */
  const tvRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (view !== "tv" || !active?.id) return;

    let disposed = false;
    (async () => {
      const YT = await loadYouTubeAPI();
      if (disposed || !YT || !tvRef.current) return;

      if (playerRef.current?.destroy) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }

      playerRef.current = new YT.Player(tvRef.current, {
        height: "100%",
        width: "100%",
        videoId: active.id,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: (e: any) => { try { e.target.playVideo(); } catch {} } },
      });
    })();

    return () => {
      disposed = true;
      if (playerRef.current?.destroy) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, [view, active?.id]);

  function pauseVideo() { try { playerRef.current?.pauseVideo?.(); } catch {} }
  function playVideo()  { try { playerRef.current?.playVideo?.(); }  catch {} }
  function closeTV()    { try { playerRef.current?.stopVideo?.(); }   catch {} ; setView("gallery"); setActive(null); }

  /* =========================
     Layout helpers
  ========================= */
  const countLabel = useMemo(() => `${videos.length}/${MAX_VIDEOS}`, [videos.length]);

  /* =========================
     Render
  ========================= */
  return (
    <div className="w-full min-h-[100dvh] bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto max-w-xl md:max-w-3xl px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BYB Meditation Centre</h1>
            <p className="text-xs text-slate-500">Motivation videos you trust</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFormOpen(true)}
              disabled={!canAddMore}
              className="px-3 py-2 rounded-md border bg-black text-white disabled:opacity-40"
            >
              Add Video ({countLabel})
            </button>
          </div>
        </div>

        {/* Optional helper for first-run / partial lists */}
        <div className="text-xs text-slate-500 mb-3">
          Missing the starters?{" "}
          <button onClick={restoreStarters} className="underline hover:text-slate-700">
            Restore starter set
          </button>
        </div>

        {/* Gallery grid (mobile-first) */}
        {videos.length === 0 ? (
          <div className="border rounded-xl bg-white p-8 text-center text-slate-500">
            No videos yet. Tap <strong>Add Video</strong> to save your first favourite.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {videos.map((v, i) => (
              <div key={`${v.id}-${i}`} className="relative group overflow-hidden rounded-xl border bg-white">
                <button
                  className="block w-full"
                  title={v.title}
                  onClick={() => { setActive(v); setView("tv"); }}
                >
                  <div className="aspect-video bg-black/10">
                    <img src={thumbUrl(v.id)} alt={v.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="p-2 text-left">
                    <p className="text-sm font-medium line-clamp-2">{v.title}</p>
                  </div>
                </button>

                {/* Delete button */}
                <button
                  onClick={() => removeVideo(i)}
                  className="absolute top-2 right-2 px-2 py-1 rounded-md bg-white/90 border text-xs opacity-0 group-hover:opacity-100 transition"
                  title="Delete"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Video modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center px-4" onClick={() => setFormOpen(false)}>
          <div
            className="w-full max-w-sm rounded-xl border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Add a YouTube video</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Title</label>
                <input
                  value={formTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormTitle(e.target.value)}
                  placeholder="e.g. 10-Min Morning Breath"
                  className="mt-1 w-full border rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="text-sm font-medium">YouTube Link</label>
                <input
                  value={formUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormUrl(e.target.value)}
                  placeholder="https://youtu.be/… or https://www.youtube.com/watch?v=…"
                  className="mt-1 w-full border rounded-md px-3 py-2"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setFormOpen(false)} className="px-3 py-2 rounded-md border bg-white">
                  Cancel
                </button>
                <button
                  onClick={addVideo}
                  disabled={!canAddMore}
                  className="px-3 py-2 rounded-md border bg-black text-white disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              <p className="text-[11px] text-slate-500 text-right">Max {MAX_VIDEOS} videos</p>
            </div>
          </div>
        </div>
      )}

      {/* BYB TV page (full-screen overlay with TV bezel) */}
      {view === "tv" && active && (
        <div className="fixed inset-0 z-50 bg-black/80 overflow-auto" role="dialog" aria-modal="true">
          <div className="mx-auto max-w-xl md:max-w-3xl px-4 py-8">
            {/* Top bar */}
            <div className="flex items-center justify-between text-white mb-4">
              <button onClick={closeTV} className="px-3 py-2 rounded-md border border-white/30">
                Close
              </button>
              <div className="text-sm font-medium line-clamp-1 text-center px-2">{active.title}</div>
              <div style={{ width: 72 }} />
            </div>

            {/* TV Shell */}
            <div className="relative mx-auto">
              {/* Outer glossy bezel */}
              <div className="rounded-[22px] bg-neutral-950 shadow-[0_30px_90px_rgba(0,0,0,0.7)] p-2 md:p-3 border border-neutral-800">
                {/* Inner bezel */}
                <div className="rounded-[18px] bg-black p-2 md:p-3">
                  {/* Screen */}
                  <div className="rounded-[10px] overflow-hidden bg-black aspect-video">
                    <div ref={tvRef} className="w-full h-full" />
                  </div>
                </div>
              </div>

              {/* Stand (simple) */}
              <div className="mx-auto mt-4 h-3 w-32 rounded-full bg-neutral-900 shadow-[0_10px_30px_rgba(0,0,0,0.6)]" />

              {/* BYB TV badge */}
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-8">
                <div className="px-5 py-1.5 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-200 tracking-[0.35em] text-[11px] font-semibold">
                  BYB TV
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="mt-10 flex items-center justify-center gap-3">
              <button onClick={playVideo} className="px-4 py-2 rounded-md border border-white/30 text-white">
                Play
              </button>
              <button onClick={pauseVideo} className="px-4 py-2 rounded-md border border-white/30 text-white">
                Pause
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
