// src/meditation.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

/* =========================
   Types & constants
========================= */
type Video = { id: string; title: string; url: string };

const STORAGE_KEY = "byb.meditationCentre.videos";
const MAX_VIDEOS = 10;

/** Seed videos (yours) */
const SEEDS: Partial<Video>[] = [
  { title: "Starter: 10-min Calm", url: "https://youtu.be/j734gLbQFbU?si=6AnHq5m0lLMu7zrW" },
  { title: "Starter: Focus Reset", url: "https://youtu.be/cyMxWXlX9sU?si=HyfDOCQuFNY9chFP" },
  { title: "Starter: Deep Relax",  url: "https://youtu.be/P-8ALcF8AGE?si=JCtNqvsaKfxDLhdO" },
];

/* =========================
   Utilities
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
    // Fallback loose match
    const loose = url.match(/([a-zA-Z0-9_-]{6,})/g)?.find((x) => x.length >= 6);
    return loose || null;
  } catch {
    return null;
  }
}
const thumbUrl = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

/** Load YT iframe API once and share the promise */
let ytPromise: Promise<any> | null = null;
function loadYouTubeAPI(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if ((window as any).YT?.Player) return Promise.resolve((window as any).YT);
  if (ytPromise) return ytPromise;

  ytPromise = new Promise((resolve) => {
    const w = window as any;
    const existing = document.getElementById("youtube-iframe-api");
    if (!existing) {
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
   Styles for the VHS spines
========================= */
const vhsGreen = "linear-gradient(180deg, #0f2b20 0%, #0b2218 100%)"; // deep green
const gold = "#d6b66b";
const spineStyle: CSSProperties = {
  backgroundImage: vhsGreen,
  border: `1px solid ${gold}`,
  borderRadius: 10,
  boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.25)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const goldRule: CSSProperties = {
  height: "100%",
  width: 40,
  borderLeft: `2px solid ${gold}`,
  borderRight: `2px solid ${gold}`,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const verticalTitle: CSSProperties = {
  writingMode: "vertical-rl",
  transform: "rotate(180deg)",
  color: gold,
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: "0.04em",
};

/* =========================
   Main component
========================= */
export default function MeditationScreen() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // ----- Load from storage or seeds on first run
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Video[];
        // If parsed is empty (e.g., first-ever run but localStorage set), fall back to seeds
        if (Array.isArray(parsed) && parsed.length > 0) {
          setVideos(parsed);
          return;
        }
      } catch {
        /* noop */
      }
    }
    const prepared: Video[] = SEEDS.map((s, i) => {
      const id = extractYouTubeId(s.url || "") || `seed-${i}`;
      return { id, title: s.title || `Video ${i + 1}`, url: s.url || "" } as Video;
    });
    setVideos(prepared);
  }, []);

  // ----- Persist on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  }, [videos]);

  const canAddMore = videos.length < MAX_VIDEOS;

  function addVideo() {
    setError(null);
    if (!canAddMore) return setError(`Max ${MAX_VIDEOS} videos reached.`);
    const id = extractYouTubeId(formUrl.trim() || "");
    if (!id) return setError("Please paste a valid YouTube link.");
    const title = (formTitle || "Untitled").trim();
    setVideos((v) => [...v, { id, title, url: formUrl.trim() }]);
    setFormTitle("");
    setFormUrl("");
  }

  function removeVideo(idx: number) {
    setVideos((v) => v.filter((_, i) => i !== idx));
    if (selected === idx) setSelected(null);
    if (videos[idx]?.id === activeId) setActiveId(null);
  }

  function resetAll() {
    setVideos([]);
    setSelected(null);
    setActiveId(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  /* =========================
     TV Overlay with YT Player
  ========================= */
  const tvRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  // Create/destroy player when activeId changes
  useEffect(() => {
    let disposed = false;
    async function mount() {
      if (!activeId || !tvRef.current) return;
      const YT = await loadYouTubeAPI();
      if (disposed || !YT || !tvRef.current) return;

      // Clean old player if any
      if (playerRef.current?.destroy) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }

      playerRef.current = new YT.Player(tvRef.current, {
        height: "100%",
        width: "100%",
        videoId: activeId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (e: any) => {
            try { e.target.playVideo(); } catch {}
          },
        },
      });
    }
    mount();
    return () => {
      disposed = true;
      if (playerRef.current?.destroy) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, [activeId]);

  function handlePause() {
    try { playerRef.current?.pauseVideo?.(); } catch {}
  }
  function handlePlay() {
    try { playerRef.current?.playVideo?.(); } catch {}
  }
  function handleCloseTV() {
    try { playerRef.current?.stopVideo?.(); } catch {}
    setActiveId(null);
  }

  /* =========================
     Render
  ========================= */
  const selectedVideo = useMemo(
    () => (selected != null ? videos[selected] : null),
    [selected, videos]
  );

  return (
    <div className="w-full min-h-[100dvh] bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">BYB Meditation Centre</h1>
            <p className="text-sm md:text-base text-slate-500">
              Motivation Centre · Save up to {MAX_VIDEOS} favourites
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetAll} className="px-3 py-2 rounded-md border bg-white hover:bg-slate-50">
              Reset
            </button>
          </div>
        </div>

        {/* Add form */}
        <div className="mb-8 border rounded-xl bg-white">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Add a YouTube video</h2>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
            <div className="md:col-span-2">
              <label className="text-sm font-medium">Title</label>
              <input
                placeholder="e.g. 10-Min Morning Breath"
                value={formTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormTitle(e.target.value)}
                className="mt-1 w-full border rounded-md px-3 py-2"
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-sm font-medium">YouTube Link</label>
              <div className="flex gap-2 mt-1">
                <input
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={formUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormUrl(e.target.value)}
                  className="w-full border rounded-md px-3 py-2"
                />
                <button
                  onClick={addVideo}
                  disabled={!canAddMore}
                  className="px-3 py-2 rounded-md border bg-black text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                You can save {Math.max(0, MAX_VIDEOS - videos.length)} more.
              </p>
              {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            </div>
          </div>
        </div>

        {/* Shelf – clean row of VHS spines */}
        <div className="border rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex gap-3 overflow-x-auto pb-1" role="list">
            {videos.map((v, i) => (
              <button
                key={`${v.id}-${i}`}
                role="listitem"
                className="h-48 w-[64px] shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                style={spineStyle}
                title={v.title}
                onClick={() => setSelected(i)}
              >
                <div style={goldRule}>
                  <span style={verticalTitle}>{v.title}</span>
                </div>
              </button>
            ))}
            {/* Empty placeholders */}
            {Array.from({ length: Math.max(0, MAX_VIDEOS - videos.length) }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="h-48 w-[64px] shrink-0 rounded-lg border-2 border-dashed border-slate-300 grid place-items-center text-xs text-slate-500"
              >
                Empty
              </div>
            ))}
          </div>
        </div>

        {/* Details panel below shelf (shows when a spine is selected) */}
        {selectedVideo && (
          <div className="mt-6 border rounded-xl bg-white overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3">
              <div className="aspect-video md:col-span-2 bg-black/5">
                <img
                  src={thumbUrl(selectedVideo.id)}
                  alt={selectedVideo.title}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4 flex flex-col gap-3">
                <h3 className="text-lg font-semibold">{selectedVideo.title}</h3>
                <div className="mt-auto flex flex-wrap gap-2">
                  <button
                    onClick={() => setActiveId(selectedVideo.id)}
                    className="px-3 py-2 rounded-md border bg-black text-white"
                  >
                    Play on BYB TV
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 rounded-md border bg-white"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => removeVideo(selected!)}
                    className="px-3 py-2 rounded-md border bg-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TV Overlay */}
        {activeId && (
          <div
            className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4"
            onClick={handleCloseTV}
          >
            <div
              className="relative w-full max-w-5xl"
              onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
            >
              {/* TV bezel */}
              <div className="relative bg-black rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
                {/* Inner glossy frame */}
                <div className="rounded-xl border border-slate-800 p-3">
                  <div className="rounded-md overflow-hidden bg-black aspect-video">
                    {/* YT player mounts here */}
                    <div ref={tvRef} className="w-full h-full" />
                  </div>
                </div>

                {/* Lower bezel badge */}
                <div className="absolute -bottom-10 left-1/2 -translate-x-1/2">
                  <div className="px-6 py-2 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-200 tracking-[0.3em] text-xs font-semibold shadow">
                    BYB TV
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-16 flex items-center justify-center gap-3">
                <button onClick={handlePlay} className="px-4 py-2 rounded-md border bg-white">
                  Play
                </button>
                <button onClick={handlePause} className="px-4 py-2 rounded-md border bg-white">
                  Pause
                </button>
                <button onClick={handleCloseTV} className="px-4 py-2 rounded-md border bg-black text-white">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
