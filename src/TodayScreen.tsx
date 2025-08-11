import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type ItemType = "task" | "daily_action";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function TodayScreen({ externalDateISO }: { externalDateISO?: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string>(todayISO());
  const [items, setItems] = useState<any[]>([]);
  const [affirmation, setAffirmation] = useState<any>(null);
  const [affirmationText, setAffirmationText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<string>("");
  const [newTaskDate, setNewTaskDate] = useState<string>(todayISO());

  // pick up date from Calendar when provided
  useEffect(() => {
    if (externalDateISO) {
      setDateISO(externalDateISO);
      setNewTaskDate(exter
