export type AllowedCategory =
  | "business"
  | "financial"
  | "health"
  | "personal"
  | "relationships";

export const CATS: ReadonlyArray<{ key: AllowedCategory; label: string; color: string }> = [
  { key: "business",      label: "Business",      color: "#C7D2FE" },
  { key: "financial",     label: "Financial",     color: "#FDE68A" }, // amber (distinct)
  { key: "health",        label: "Health",        color: "#99F6E4" },
  { key: "personal",      label: "Personal",      color: "#E9D5FF" },
  { key: "relationships", label: "Relationships", color: "#FECDD3" },
];

export const colorOf = (k: AllowedCategory) =>
  CATS.find(c => c.key === k)?.color || "#E5E7EB";

export const labelOf = (k: AllowedCategory) =>
  CATS.find(c => c.key === k)?.label || k;

// Legacy → unified (same logic you had)
export function normalizeCat(x: string | null | undefined): AllowedCategory {
  const s = (x || "").toLowerCase().trim();
  if (s === "career" || s === "business") return "business";
  if (s === "finance" || s === "financial") return "financial";
  if (s === "relationship" || s === "relationships") return "relationships";
  if (s === "health") return "health";
  if (s === "personal" || s === "personal_development" || s === "other" || !s) return "personal";
  return "personal"; // safe default
}
