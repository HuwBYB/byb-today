// src/lib/greeting.ts
import { supabase } from "./supabaseClient";

const LS_KEY = "byb:nicknames:v1";
const SS_PICK_KEY = "byb:greet:pick"; // keep the same name for a whole app session

export type ProfilePrefs = {
  nicknames?: string[];
  greet_mode?: "mixed" | "name_only" | "nickname_only";
};

export async function loadProfilePrefs(userId: string | null) {
  if (!userId) return {} as ProfilePrefs;

  // Try to read prefs JSON if your profiles table has it. If not, this just fails silently.
  const { data, error } = await supabase
    .from("profiles")
    .select("prefs, full_name, display_name")
    .eq("id", userId)
    .single();

  if (error) return {} as ProfilePrefs;

  const prefs = (data?.prefs || {}) as ProfilePrefs;
  const fullName =
    (data as any)?.display_name ||
    (data as any)?.full_name ||
    null;

  return { ...prefs, /* pass through name for convenience */ nick_source_name: fullName } as ProfilePrefs & { nick_source_name?: string | null };
}

export function getLocalNicknames(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr.map((s) => String(s)).filter((s) => s.trim().length > 0);
    }
  } catch {}
  return [];
}

export function saveLocalNicknames(nicks: string[]) {
  const clean = Array.from(new Set(nicks.map((s) => s.trim()).filter(Boolean)));
  localStorage.setItem(LS_KEY, JSON.stringify(clean));
}

export function pickGreetingName(options: {
  userName?: string | null;
  nicknames: string[];
  mode?: "mixed" | "name_only" | "nickname_only";
}): string {
  const { userName, nicknames, mode = "mixed" } = options;

  // Hold the same chosen name for the whole session so it doesn't change while navigating
  const existing = sessionStorage.getItem(SS_PICK_KEY);
  if (existing) return existing;

  const validNicks = (nicknames || []).filter((s) => s && s.trim().length > 0);
  let choice = userName || "Friend";

  if (mode === "name_only") {
    // nothing
  } else if (mode === "nickname_only" && validNicks.length > 0) {
    choice = validNicks[Math.floor(Math.random() * validNicks.length)];
  } else if (mode === "mixed") {
    // 50/50 between name and a random nickname (if any)
    const useNick = validNicks.length > 0 && Math.random() < 0.5;
    choice = useNick
      ? validNicks[Math.floor(Math.random() * validNicks.length)]
      : (userName || validNicks[Math.floor(Math.random() * validNicks.length)]);
  }

  sessionStorage.setItem(SS_PICK_KEY, choice);
  return choice;
}
