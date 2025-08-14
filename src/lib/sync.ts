// src/lib/sync.ts
import { supabase } from "../lib/supabaseClient";

export type GoalStepRow = {
  id: string;
  user_id: string;
  title: string;
  scheduled_for?: string | null; // YYYY-MM-DD (optional)
  done?: boolean | null;
  // add any other fields you store for steps
};

function toISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Mirror a goal step to the tasks table so it shows on Today/Calendar */
export async function upsertTaskForStep(step: GoalStepRow, opts?: { category?: "health"|"personal"|"financial"|"career"|"other" }) {
  const due = step.scheduled_for || toISO();           // default to today if none
  const category = opts?.category ?? "career";         // pick from your allowed set
  const title = step.title?.trim() || "Goal step";

  const payload: any = {
    user_id: step.user_id,
    title,
    due_date: due,                                     // what Today/Calendar use
    category,                                          // must match your CHECK constraint
    done: !!step.done,
    goal_step_id: step.id,                             // lets us upsert without duplicates
  };

  const { error } = await supabase
    .from("tasks")
    .upsert(payload, { onConflict: "goal_step_id" });  // requires the index above
  if (error) throw error;
}
