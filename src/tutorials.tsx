import { useEffect, useMemo, useRef, useState } from "react";

/* =====================================================
   BYB Tutorial Page (read‑only for users)
   - Works like Meditation Centre's inline YouTube player grid
   - End users CANNOT add/remove videos
   - You (admin) add YouTube links in the TUTORIALS constant below

   HOW TO ADD BYB TUTORIAL VIDEOS
   1) Upload each tutorial to YouTube (public or unlisted).
   2) Paste a new entry { title, url } into TUTORIALS.
      • Use any valid YouTube URL (watch?v=..., youtu.be/..., or /embed/...)
   3) The component auto‑extracts the video ID and renders the thumbnail/player.
   4) Optional: adjust WIN_SECONDS ("completion" toast threshold). Default: 3 min.

   Example entry:
   { title: "BYB Tour: The Today Page", url: "https://youtu.be/XXXXXXXXXXX" }
===================================================== */

type Video = { id: string; title: string; url: string };

const WIN_SECONDS = 180; // after this, show a small "completed" toast
const TOAST_LOGO_SRC = "/LogoButterfly.png";

/**
 * Place your official BYB tutorial links here.
 * Keep titles short and clear – they appear under each card.
 */
const TUTORIALS: Array<Partial<Video>> = [
  // TODO: Replace the placeholders below with your real links as they are ready.
  { title: "BYB Tour: Welcome & Setup", url: "" },
  { title: "Daily Flow: Today & Big Goal", url: "" },
  { title: "Gratitude Journal & Successes", url: "" },
  { title: "Affirmation Builder Basics", url: "" },
  { title: "Focus Mode & Dopamine Micro‑wins", url: "" },
  // Add more as needed…
];

/* =========================
   Utils (same as Meditation)
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
export default function BYBTutorials() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

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

  // Prepare the fixed list from TUTORIALS
  useEffect(() => {
    const prepared: Video[] = TUTORIALS.filter((t) => !!t.url).map((s, i) => {
      const id = extractYouTubeId(s.url || "") || `tutorial-${i}`;
      return { id, title: s.title || `Tutorial ${i + 1}`, url: s.url || "" } as Video;
    });
    setVideos(prepared);
  }, []);

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
        toast.show(`Tutorial complete — ${title}`);
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
  const countLabel = useMemo(() => `${videos.length}`,[videos.length]);

  /* =========================
     Render
  ========================= */
  return (
    <div className="w-full min-h-[100dvh] bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto max-w-xl md:max-w-3xl px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BYB Tutorials</h1>
            <p className="text-sm text-slate-600">Official walkthroughs. {videos.length > 0 ? `(${countLabel})` : null}</p>
          </div>
          {/* No Add button for users */}
        </div>

        {/* Empty state */}
        {videos.length === 0 ? (
          <div className="border rounded-xl bg-white p-8 text-center text-slate-500">
            Tutorials are coming soon. This page will populate automatically when links are added
            to <code className="px-1 py-0.5 rounded bg-slate-100 border">TUTORIALS</code> in the source file.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {videos.map((v) => {
              const isPlaying = playingId === v.id;
              return (
                <div key={v.id} className="relative group overflow-hidden rounded-xl border bg-white">
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
                    {isPlaying && (
                      <button
                        className="px-2 py-1 rounded-md border text-xs"
                        onClick={() => { destroyPlayer(v.id); setPlayingId(null); }}
                        title="Stop"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast.node}
    </div>
  );
}
