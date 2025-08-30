import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Link as LinkIcon, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * BYB Meditation Centre – Motivation TV
 * Single-file React screen. Uses Tailwind + shadcn/ui + framer-motion.
 *
 * UX overview
 * - Old video library shelf of up to 10 tapes (spines).
 * - Click a spine to flip it and reveal the front with the YouTube thumbnail.
 * - Click the front (or the play button) to open the video embedded inside a custom BYB TV frame.
 * - Add your own YouTube links (max 10). Stored in localStorage between sessions.
 * - Optional seed videos can be injected via the SEEDS constant.
 */

const STORAGE_KEY = "byb.meditationCentre.videos";
const MAX_VIDEOS = 10;

// Seed examples (replace with your 2–3 standards later)
const SEEDS: Partial<Video>[] = [
  { title: "Starter: 10‑min Calm", url: "https://youtu.be/j734gLbQFbU?si=6AnHq5m0lLMu7zrW" },
  { title: "Starter: Focus Reset", url: "https://youtu.be/cyMxWXlX9sU?si=HyfDOCQuFNY9chFP" },
  { title: "Starter: Deep Relax", url: "https://youtu.be/P-8ALcF8AGE?si=JCtNqvsaKfxDLhdO" },
];

type Video = {
  id: string; // YouTube Video ID
  title: string;
  url: string;
};

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    // Standard patterns
    if (u.hostname.includes("youtube.com")) {
      // youtu.be and youtube.com forms
      const v = u.searchParams.get("v");
      if (v) return v;
      // /embed/{id}
      const embed = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (embed) return embed[1];
    }
    if (u.hostname.includes("youtu.be")) {
      const short = u.pathname.replace("/", "");
      if (short) return short;
    }
    // Fallback: attempt to match anywhere
    const loose = url.match(/([a-zA-Z0-9_-]{6,})/g)?.find((x) => x.length >= 6);
    return loose || null;
  } catch (_) {
    return null;
  }
}

function thumbUrl(id: string) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

function embedUrl(id: string) {
  return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
}

export default function BYBMeditationCentre() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load from storage (or seeds on first run)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setVideos(JSON.parse(raw));
      } catch {
        // ignore
      }
    } else if (SEEDS.length) {
      const prepared: Video[] = SEEDS.map((s, i) => {
        const id = extractYouTubeId(s.url || "") || `seed-${i}`;
        return { id, title: s.title || `Video ${i + 1}` , url: s.url || "" } as Video;
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
    if (!canAddMore) {
      setError(`Max ${MAX_VIDEOS} videos reached.`);
      return;
    }
    const id = extractYouTubeId(formUrl.trim() || "");
    if (!id) {
      setError("Please paste a valid YouTube link.");
      return;
    }
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
    <div className="w-full min-h-[100dvh] bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 text-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">BYB Meditation Centre</h1>
            <p className="text-sm md:text-base text-slate-500 dark:text-slate-400">Motivation Centre · Save up to {MAX_VIDEOS} favourites</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={resetAll} className="gap-2" title="Clear saved list">
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </div>

        {/* Add form */}
        <Card className="mb-8">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Add a YouTube video</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
              <div className="md:col-span-2">
                <label className="text-sm font-medium">Title</label>
                <Input
                  placeholder="e.g. 10-Min Morning Breath"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-sm font-medium">YouTube Link</label>
                <div className="flex gap-2 mt-1">
                  <Input
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                  />
                  <Button onClick={addVideo} disabled={!canAddMore} className="gap-2">
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
                <p className="text-xs text-slate-500 mt-1">You can save {MAX_VIDEOS - videos.length} more.</p>
                {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Shelf */}
        <div className="space-y-6">
          <Shelf>
            {videos.map((v, i) => (
              <Tape
                key={`${v.id}-${i}`}
                index={i}
                video={v}
                flipped={flippedIndex === i}
                onFlip={() => setFlippedIndex(flippedIndex === i ? null : i)}
                onPlay={() => setActiveId(v.id)}
                onRemove={() => removeVideo(i)}
              />
            ))}
            {/* Empty placeholders to fill the shelf visually */}
            {Array.from({ length: Math.max(0, MAX_VIDEOS - videos.length) }).map((_, i) => (
              <EmptyTape key={`empty-${i}`} />
            ))}
          </Shelf>

          {/* TV Viewer */}
          <AnimatePresence>{activeId && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <BYBTVFrame onClose={() => setActiveId(null)}>
                <iframe
                  className="w-full h-[56.25vw] max-h-[70vh]"
                  src={embedUrl(activeId)}
                  title="BYB TV"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </BYBTVFrame>
            </motion.div>
          )}</AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** Shelf & Tape components **/
function Shelf({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[url('https://images.unsplash.com/photo-1517329782449-810562a4ec2a?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center rounded-2xl p-4 shadow-inner">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-3">
        {children}
      </div>
    </div>
  );
}

function Tape({
  index,
  video,
  flipped,
  onFlip,
  onPlay,
  onRemove,
}: {
  index: number;
  video: Video;
  flipped: boolean;
  onFlip: () => void;
  onPlay: () => void;
  onRemove: () => void;
}) {
  return (
    <motion.div layout className="relative">
      <div className="relative h-48 [perspective:1000px]">
        <motion.div
          className="relative h-full w-full"
          initial={false}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.5 }}
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* Spine */}
          <button
            onClick={onFlip}
            className="absolute inset-0 rounded-xl bg-gradient-to-b from-slate-800 to-slate-700 border border-slate-900 shadow-md flex items-center justify-center [backface-visibility:hidden]"
            title={video.title}
          >
            <div className="flex flex-col items-center">
              <div className="h-36 w-10 bg-slate-200/10 rounded-md border border-slate-600 shadow-inner flex items-center justify-center">
                <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold tracking-wide">
                  {video.title}
                </span>
              </div>
              <span className="mt-2 text-[10px] uppercase tracking-wider text-slate-300">BYB Tape #{index + 1}</span>
            </div>
          </button>

          {/* Front */}
          <div
            className="absolute inset-0 rounded-xl bg-slate-900 border border-slate-700 overflow-hidden [transform:rotateY(180deg)] [backface-visibility:hidden]"
          >
            <div className="relative h-full w-full">
              <img src={thumbUrl(video.id)} alt={video.title} className="h-full w-full object-cover opacity-90" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/0" />
              <div className="absolute bottom-0 left-0 right-0 p-2">
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="secondary" className="gap-1" onClick={onFlip}>
                    Back
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="gap-2" onClick={onPlay}>
                      <Play className="h-4 w-4" /> Play
                    </Button>
                    <Button size="sm" variant="destructive" onClick={onRemove}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function EmptyTape() {
  return (
    <div className="relative h-48">
      <div className="absolute inset-0 rounded-xl border-2 border-dashed border-slate-300/40 dark:border-slate-700/60 flex items-center justify-center">
        <div className="flex flex-col items-center text-xs text-slate-500">
          <LinkIcon className="h-4 w-4 mb-1" />
          Add video
        </div>
      </div>
    </div>
  );
}

/** TV Frame **/
function BYBTVFrame({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="relative mx-auto rounded-[2rem] border-8 border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
        {/* Screen */}
        <div className="bg-black aspect-video w-full">
          {children}
        </div>
        {/* Bezel */}
        <div className="absolute -bottom-0 left-0 right-0 h-14 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-4">
          <span className="font-semibold tracking-widest text-slate-200">BYB TV</span>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" title="Power" />
            <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
        {/* Feet */}
        <div className="absolute -bottom-3 left-6 h-3 w-12 bg-slate-800 rounded-b-xl" />
        <div className="absolute -bottom-3 right-6 h-3 w-12 bg-slate-800 rounded-b-xl" />
      </div>
    </div>
  );
}
