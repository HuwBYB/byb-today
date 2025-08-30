// src/meditation.tsx
import React, { useEffect, useState } from "react";
import type { CSSProperties } from "react";

type Video = {
  id: string;
  title: string;
  url: string;
};

const STORAGE_KEY = "byb.meditationCentre.videos";
const MAX_VIDEOS = 10;

/** Seed videos (your three) */
const SEEDS: Partial<Video>[] = [
  { title: "Starter: 10-min Calm",   url: "https://youtu.be/j734gLbQFbU?si=6AnHq5m0lLMu7zrW" },
  { title: "Starter: Focus Reset",   url: "https://youtu.be/cyMxWXlX9sU?si=HyfDOCQuFNY9chFP" },
  { title: "Starter: Deep Relax",    url: "https://youtu.be/P-8ALcF8AGE?si=JCtNqvsaKfxDLhdO" },
];

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const embed = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (embed) return embed[1];
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
const embedUrl  = (id: string) => `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;

/** Inline styles (type-only import above keeps TS happy with verbatimModuleSyntax) */
const perspectiveStyle: CSSProperties = { perspective: "1000px" };
const preserve3D: CSSProperties     = { transformStyle: "preserve-3d" };
const backfaceHidden: CSSProperties = { backfaceVisibility: "hidden" };
const rotateY180: CSSProperties     = { transform: "rotateY(180deg)" };

export default function MeditationScreen() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load from storage or seeds
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setVideos(JSON.parse(raw));
        return;
      } catch {}
    }
    if (SEEDS.length) {
      const prepared: Video[] = SEEDS.map((s, i) => {
        const id = extractYouTubeId(s.url || "") || `seed-${i}`;
        return { id, title: s.title || `Video ${i + 1}`, url: s.url || "" } as Video;
      });
      setVideos(prepared);
    }
  }, []);

  // Persist
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
    if (flippedIndex === idx) setFlippedIndex(null);
  }

  function resetAll() {
    setVideos([]);
    setFlippedIndex(null);
    setActiveId(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <div className="w-full min-h-[100dvh] bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">BYB Meditation Centre</h1>
            <p className="text-sm md:text-base text-slate-500">Motivation Centre · Save up to {MAX_VIDEOS} favourites</p>
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
              <p className="text-xs text-slate-500 mt-1">You can save {MAX_VIDEOS - videos.length} more.</p>
              {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            </div>
          </div>
        </div>

        {/* Shelf */}
        <div className="space-y-6">
          <div className="rounded-2xl p-4 shadow-inner bg-[url('https://images.unsplash.com/photo-1517329782449-810562a4ec2a?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-3">
              {videos.map((v, i) => {
                const flipped = flippedIndex === i;
                return (
                  <div key={`${v.id}-${i}`} className="relative h-48" style={perspectiveStyle}>
                    <div
                      className="relative h-full w-full transition-transform duration-500"
                      style={{ ...preserve3D, transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
                    >
                      {/* Spine */}
                      <button
                        onClick={() => setFlippedIndex(flipped ? null : i)}
                        className="absolute inset-0 rounded-xl bg-gradient-to-b from-slate-800 to-slate-700 border border-slate-900 shadow-md flex items-center justify-center"
                        style={backfaceHidden}
                        title={v.title}
                      >
                        <div className="flex flex-col items-center">
                          <div className="h-36 w-10 bg-slate-200/10 rounded-md border border-slate-600 shadow-inner flex items-center justify-center">
                            <span
                              className="text-xs font-semibold tracking-wide text-white"
                              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                            >
                              {v.title}
                            </span>
                          </div>
                          <span className="mt-2 text-[10px] uppercase tracking-wider text-slate-300">BYB Tape #{i + 1}</span>
                        </div>
                      </button>

                      {/* Front */}
                      <div
                        className="absolute inset-0 rounded-xl bg-slate-900 border border-slate-700 overflow-hidden"
                        style={{ ...rotateY180, ...backfaceHidden }}
                      >
                        <div className="relative h-full w-full">
                          <img src={thumbUrl(v.id)} alt={v.title} className="h-full w-full object-cover opacity-90" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/0" />
                          <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between gap-2">
                            <button
                              onClick={() => setFlippedIndex(null)}
                              className="px-2 py-1 rounded-md border bg-white text-sm"
                            >
                              Back
                            </button>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setActiveId(v.id)}
                                className="px-2 py-1 rounded-md border bg-black text-white text-sm"
                              >
                                Play
                              </button>
                              <button
                                onClick={() => removeVideo(i)}
                                className="px-2 py-1 rounded-md border bg-white text-sm"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Empty slots */}
              {Array.from({ length: Math.max(0, MAX_VIDEOS - videos.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="relative h-48">
                  <div className="absolute inset-0 rounded-xl border-2 border-dashed border-slate-300/60 flex items-center justify-center">
                    <div className="flex flex-col items-center text-xs text-slate-600">
                      <span className="mb-1">＋</span>
                      Add video
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TV Viewer */}
          {activeId && (
            <div className="mx-auto max-w-5xl">
              <div className="relative mx-auto rounded-[2rem] border-8 border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
                {/* Screen */}
                <div className="bg-black aspect-video w-full">
                  <iframe
                    className="w-full h-[56.25vw] max-h-[70vh]"
                    src={embedUrl(activeId)}
                    title="BYB TV"
                    frameBorder={0}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                {/* Bezel */}
                <div className="absolute -bottom-0 left-0 right-0 h-14 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-4">
                  <span className="font-semibold tracking-widest text-slate-200">BYB TV</span>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" title="Power" />
                    <button onClick={() => setActiveId(null)} className="px-2 py-1 rounded-md border bg-white text-sm">
                      Close
                    </button>
                  </div>
                </div>
                {/* Feet */}
                <div className="absolute -bottom-3 left-6 h-3 w-12 bg-slate-800 rounded-b-xl" />
                <div className="absolute -bottom-3 right-6 h-3 w-12 bg-slate-800 rounded-b-xl" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
