// src/meditation.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* =========================
   Types & constants
========================= */
type Video = { id: string; title: string; url: string };

const STORAGE_KEY = "byb.meditationCentre.videos";
const MAX_VIDEOS = 10;
const WIN_SECONDS = 180; // 3 minutes
const TOAST_LOGO_SRC = "/LogoButterfly.png";

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
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve) => {
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
    (window as any).onYouTubeIframeAPIReady = () => resolve((window as any).YT);
  });
  return ytPromise;
}

/* =========================
   Tiny BYB toast
========================= */
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  function show(m: string) { setMsg(m); setTimeout(() => setMsg(null), 2600); }
  const node = (
    <div
      aria-live="polite"
      style={{
        position: "fixed", left: 0, right: 0,
        bottom: "calc(16px + env(safe-area-inset-bottom,0))",
        display: "flex", justifyContent: "center",
        pointerEvents: "none", zIndex: 3500
      }}
    >
      {msg && (
        <div
          style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            background: "#D7F0FA", color: "#0f172a",
            borderRadius: 14, padding: "10px 14px",
            boxShadow: "0 8px 20px rgba(0,0,0,.10)",
            border: "1px solid #bfe5f3", pointerEvents: "all"
          }}
        >
          <img
            src={TOAST_LOGO_SRC} alt="" width={22} height={22}
            style={{ display: "block", objectFit: "contain", borderRadius: 6, border: "1px solid #bfe5f3", background: "#ffffff88" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span style={{ fontWeight: 700 }}>{msg}</span>
        </div>
      )}
    </div>
  );
  return { node, show };
}

/* =========================
   Component
========================= */
export default function MeditationScreen() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toast = useToast();

  // map videoId -> container div for inline player
  const hostRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // map videoId -> YT.Player
  const playersRef = useRef<Record<string, any>>({});
  // map videoId -> interval id
  const timersRef = useRef<Record<string, number | null>>({});
  // map videoId -> watched seconds
  const secondsRef = useRef<Record<string, number>>({});
  // track which video already triggered a win
  const completedRef = useRef<Set<string>>(new Set());

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
    const target = videos[idx];
    if (target) {
      destroyPlayer(target.id);
    }
    setVideos((v) => v.filter((_, i) => i !== idx));
    if (playingId && target?.id === playingId) {
      setPlayingId(null);
    }
  }

  function restoreStarters() {
    Object.keys(playersRef.current).forEach(destroyPlayer);
    const starters: Video[] = SEEDS.map((s, i) => {
      const id = extractYouTubeId(s.url || "") || `seed-${i}`;
      return { id, title: s.title || `Video ${i + 1}`, url: s.url || "" } as Video;
    });
    setVideos(starters);
    setPlayingId(null);
  }

  /* =========================
     Inline player plumbing
  ========================= */
  function stopTimer(id: string) {
    const t = timersRef.current[id];
    if (t != null) {
      clearInterval(t);
      timersRef.current[id] = null;
    }
  }
  function startTimer(id: string, title: string) {
    stopTimer(id);
    timersRef.current[id] = window.setInterval(() => {
      secondsRef.current[id] = (secondsRef.current[id] || 0) + 1;
      const secs = secondsRef.current[id];
      if (secs >= WIN_SECONDS && !completedRef.current.has(id)) {
        completedRef.current.add(id);
        toast.show(`Meditation done — ${title}`);
      }
    }, 1000);
  }
  function destroyPlayer(id: string) {
    stopTimer(id);
    try { playersRef.current[id]?.destroy?.(); } catch {}
    delete playersRef.current[id];
  }

  // Create / swap inline player when playingId changes
  useEffect(() => {
    let disposed = false;

    (async () => {
      if (!playingId) return;
      const host = hostRefs.current[playingId];
      if (!host) return;

      // Only one active player at a time: destroy others
      Object.keys(playersRef.current).forEach((k) => {
        if (k !== playingId) destroyPlayer(k);
      });

      const YT = await loadYouTubeAPI();
      if (disposed || !YT) return;

      const video = videos.find((v) => v.id === playingId);
      if (!video) return;

      // (Re)build the player in place
      destroyPlayer(playingId);
      const player = new YT.Player(host, {
        height: "100%",
        width: "100%",
        videoId: playingId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, autoplay: 1 },
        events: {
          onReady: (e: any) => { try { e.target.playVideo(); } catch {} },
          onStateChange: (e: any) => {
            const YTS = (YT as any).PlayerState;
            if (e.data === YTS.PLAYING) {
              startTimer(playingId, video.title);
            } else if (e.data === YTS.PAUSED || e.data === YTS.BUFFERING) {
              stopTimer(playingId);
            } else if (e.data === YTS.ENDED) {
              stopTimer(playingId);
            }
          }
        }
      });
      playersRef.current[playingId] = player;
    })();

    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingId, videos]);

  // Cleanup all players on unmount
  useEffect(() => {
    return () => {
      Object.keys(playersRef.current).forEach(destroyPlayer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <h1 className="text-2xl font-bold tracking-tight">Meditation Centre</h1>
            {/* subtitle removed per request */}
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

        {/* Gallery grid (inline players) */}
        {videos.length === 0 ? (
          <div className="border rounded-xl bg-white p-8 text-center text-slate-500">
            No videos yet. Tap <strong>Add Video</strong> to save your first favourite.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {videos.map((v, i) => {
              const isPlaying = playingId === v.id;
              return (
                <div key={`${v.id}-${i}`} className="relative group overflow-hidden rounded-xl border bg-white">
                  {/* Media area */}
                  <div className="aspect-video bg-black/10">
                    {isPlaying ? (
                      <div
                        ref={(el) => { hostRefs.current[v.id] = el; }}
                        className="w-full h-full"
                      />
                    ) : (
                      <button
                        className="block w-full h-full"
                        title={v.title}
                        onClick={() => setPlayingId(v.id)}
                      >
                        <img src={thumbUrl(v.id)} alt={v.title} className="w-full h-full object-cover" />
                      </button>
                    )}
                  </div>

                  {/* Title + controls */}
                  <div className="p-2 text-left flex items-center justify-between gap-2">
                    <p className="text-sm font-medium line-clamp-2">{v.title}</p>
                    <div className="flex items-center gap-1">
                      {isPlaying && (
                        <button
                          className="px-2 py-1 rounded-md border text-xs"
                          onClick={() => { destroyPlayer(v.id); setPlayingId(null); }}
                          title="Stop"
                        >
                          Stop
                        </button>
                      )}
                      <button
                        onClick={() => removeVideo(i)}
                        className="px-2 py-1 rounded-md border text-xs"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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

      {/* Toast */}
      {toast.node}
    </div>
  );
}
