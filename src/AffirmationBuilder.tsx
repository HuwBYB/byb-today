// src/AffirmationBuilder.tsx — Per-area saved slots with Edit + Pick from suggested (no Today, no bottom editor)
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/* ---------- Shared category palette ---------- */
import {
  CATS,
  colorOf,
  type AllowedCategory as Category,
} from "./theme/categories";

/* ---------- Types ---------- */
type AffirmationRow = {
  id?: number;
  user_id?: string | null;
  category: Category;
  text: string;
  created_at?: string;
};

/* ---------- Helpers ---------- */
function hexToRgba(hex: string, alpha = 0.45) {
  const m = hex.replace("#", "");
  const [r, g, b] =
    m.length === 3
      ? [m[0] + m[0], m[1] + m[1], m[2] + m[2]]
      : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)];
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
}

/* ---------- Local storage (per-area default + vault history) ---------- */
const LS_VAULT = "byb:affirmations:v1";
const LS_DEFAULT_PREFIX = "byb:affirmation:default:";
const defaultKey = (cat: string) => `${LS_DEFAULT_PREFIX}${cat}`;

function setDefaultLocal(category: Category, text: string) {
  try {
    localStorage.setItem(defaultKey(category), text);
  } catch {}
}
function getDefaultLocal(category: Category): string {
  try {
    return localStorage.getItem(defaultKey(category)) || "";
  } catch {
    return "";
  }
}
function getAllDefaults(): Record<Category, string> {
  const map = {} as Record<Category, string>;
  CATS.forEach((c) => {
    map[c.key as Category] = getDefaultLocal(c.key as Category);
  });
  return map;
}
async function saveToVaultLocal(row: AffirmationRow) {
  try {
    const arr: AffirmationRow[] = JSON.parse(localStorage.getItem(LS_VAULT) || "[]");
    arr.unshift({ ...row, created_at: new Date().toISOString() });
    localStorage.setItem(LS_VAULT, JSON.stringify(arr));
  } catch {}
}

/* ---------- Static suggestion bank (3 per focus area) ---------- */
const SUGGESTION_BANK: Record<Category, string[]> = {
  business: [
    "I lead with clarity and calm.",
    "I ship progress every day.",
    "I make smart, simple decisions.",
  ],
  financial: [
    "I steward money wisely and well.",
    "I create value and earn fairly.",
    "I respect my budget and build wealth.",
  ],
  health: [
    "I fuel my body and move daily.",
    "I train with patience and consistency.",
    "I choose rest to grow stronger.",
  ],
  personal: [
    "I show up as my best self today.",
    "I keep promises to myself.",
    "I act with integrity and curiosity.",
  ],
  relationships: [
    "I listen fully and speak kindly.",
    "I set clear, loving boundaries.",
    "I invest time in the people I love.",
  ],
};

/* ---------- Generic modal ---------- */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 720,
          width: "100%",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.2)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" title="Close" style={{ borderRadius: 8 }}>
            ✕
          </button>
        </div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Help content ---------- */
function BuilderHelpContent() {
  return (
    <div style={{ display: "grid", gap: 12, lineHeight: 1.5 }}>
      <p>
        <em>
          Save one affirmation for each area of life. Edit your own or pick from suggestions. Keep them short, present-tense, believable.
        </em>
      </p>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        <li><b>Edit</b> lets you type your own line and save it for that area.</li>
        <li><b>Pick from suggested</b> shows three options tailored to the area.</li>
      </ul>
    </div>
  );
}

/* =========================================================
   PAGE
   ========================================================= */
export default function AffirmationBuilderScreen() {
  const [userId, setUserId] = useState<string | null>(null);

  // Per-area saved defaults
  const [defaultsMap, setDefaultsMap] = useState<Record<Category, string>>(() => getAllDefaults());

  // UI state
  const [showHelp, setShowHelp] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editText, setEditText] = useState("");
  const [suggestCat, setSuggestCat] = useState<Category | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  /* ---------- Actions ---------- */
  function openEdit(cat: Category) {
    setEditCat(cat);
    setEditText(defaultsMap[cat] || "");
  }
  function closeEdit() {
    setEditCat(null);
    setEditText("");
  }

  async function saveEdit() {
    if (!editCat) return;
    const clean = (editText || "").trim();
    if (!clean) return; // keep empty-as-noop; shout if you want a “Clear” option

    // Persist locally
    setDefaultLocal(editCat, clean);
    setDefaultsMap((m) => ({ ...m, [editCat]: clean }));

    // Best-effort: vault + Supabase
    const row: AffirmationRow = { user_id: userId, category: editCat, text: clean };
    await saveToVaultLocal(row);
    try {
      if (userId) {
        await supabase
          .from("affirmation_defaults")
          .upsert({ user_id: userId, category: editCat, text: clean }, { onConflict: "user_id,category" } as any);
      }
    } catch {}
    closeEdit();
    if ((navigator as any).vibrate) (navigator as any).vibrate(6);
  }

  function openSuggestions(cat: Category) {
    setSuggestCat(cat);
  }
  function closeSuggestions() {
    setSuggestCat(null);
  }

  async function pickSuggestionFor(cat: Category, text: string) {
    const clean = text.trim();
    if (!clean) return;

    setDefaultLocal(cat, clean);
    setDefaultsMap((m) => ({ ...m, [cat]: clean }));

    const row: AffirmationRow = { user_id: userId, category: cat, text: clean };
    await saveToVaultLocal(row);
    try {
      if (userId) {
        await supabase
          .from("affirmation_defaults")
          .upsert({ user_id: userId, category: cat, text: clean }, { onConflict: "user_id,category" } as any);
      }
    } catch {}

    closeSuggestions();
    if ((navigator as any).vibrate) (navigator as any).vibrate(6);
  }

  return (
    <div className="page-affirmation-builder" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="container" style={{ display: "grid", gap: 12 }}>
        {/* Header */}
        <div className="card" style={{ position: "relative" }}>
          <h1 style={{ margin: 0 }}>Affirmations — Your Daily Set</h1>
          <div className="muted">
            Save one affirmation for each area of life. Edit your own or pick from suggestions.
          </div>
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Open builder help"
            title="Need a hand?"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              lineHeight: 0,
              zIndex: 10,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#f9fafb",
                fontWeight: 700,
              }}
            >
              ?
            </span>
          </button>
        </div>

        {/* My Daily Set (one slot per category) */}
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div className="section-title">My Daily Set</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {CATS.map((c) => {
              const cat = c.key as Category;
              const val = defaultsMap[cat] || "";
              const col = colorOf(cat);
              const hasVal = !!val.trim();
              return (
                <div
                  key={cat}
                  style={{
                    border: `1px solid ${hasVal ? col : "#e5e7eb"}`,
                    borderRadius: 12,
                    padding: 12,
                    background: hasVal ? hexToRgba(col, 0.18) : "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                    <strong>{c.label}</strong>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => openEdit(cat)} title="Edit this affirmation">Edit</button>
                      <button onClick={() => openSuggestions(cat)} title="Pick from suggested">
                        Pick from suggested
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontWeight: 700, lineHeight: 1.3 }}>
                    {hasVal ? val : <span className="muted">No saved affirmation yet</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        open={!!editCat}
        onClose={closeEdit}
        title={editCat ? `Edit ${CATS.find((c) => c.key === editCat)?.label}` : "Edit"}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder='e.g., "I lead with calm, decisive action."'
            aria-label="Edit affirmation"
          />
          <div className="muted" style={{ fontSize: 12 }}>
            Keep it short, present-tense, and believable.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={closeEdit}>Cancel</button>
            <button onClick={saveEdit} className="btn-primary" style={{ borderRadius: 10 }}>
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Suggestions Modal */}
      <Modal
        open={!!suggestCat}
        onClose={closeSuggestions}
        title={
          suggestCat ? `Suggestions — ${CATS.find((c) => c.key === suggestCat)?.label}` : "Suggestions"
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          {(suggestCat ? SUGGESTION_BANK[suggestCat] : []).map((s, i) => {
            const col = suggestCat ? colorOf(suggestCat) : "#e5e7eb";
            return (
              <button
                key={i}
                onClick={() => suggestCat && pickSuggestionFor(suggestCat, s)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${col}`,
                  background: hexToRgba(col, 0.12),
                  textAlign: "left",
                  fontWeight: 700,
                }}
                title={s}
              >
                {s}
              </button>
            );
          })}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeSuggestions}>Close</button>
          </div>
        </div>
      </Modal>

      {/* Help modal */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Affirmations — Help">
        <BuilderHelpContent />
      </Modal>
    </div>
  );
}
