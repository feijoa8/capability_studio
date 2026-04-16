import { supabase } from "../../lib/supabase";
import type {
  DevelopmentFocusItemRow,
  DevelopmentFocusItemSource,
  DevelopmentFocusItemStatus,
  DevelopmentFocusUpdateRow,
} from "./types";

export type AddDevelopmentFocusItemInput = {
  organisation_id: string | null;
  title: string;
  description: string | null;
  source: DevelopmentFocusItemSource;
  related_signals?: Record<string, unknown>;
  status?: DevelopmentFocusItemStatus;
};

export async function addDevelopmentFocusItem(input: AddDevelopmentFocusItemInput) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const payload = {
    user_id: uid,
    organisation_id: input.organisation_id,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    source: input.source,
    related_signals: input.related_signals ?? {},
    status: input.status ?? "backlog",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("development_focus_items")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message || "Could not create focus item.");
  return data as DevelopmentFocusItemRow;
}

export async function listPersonalDevelopmentFocusItems() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("development_focus_items")
    .select("*")
    .eq("user_id", uid)
    .is("organisation_id", null)
    .eq("archived", false)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message || "Could not load focus items.");
  return (data ?? []) as DevelopmentFocusItemRow[];
}

export async function updateDevelopmentFocusItemStatus(args: {
  id: string;
  status: DevelopmentFocusItemStatus;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("development_focus_items")
    .update({ status: args.status, updated_at: new Date().toISOString() })
    .eq("id", args.id)
    .eq("user_id", uid);

  if (error) throw new Error(error.message || "Could not update focus item.");
}

export async function setDevelopmentFocusItemDueDate(args: {
  id: string;
  due_date: string | null;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("development_focus_items")
    .update({ due_date: args.due_date, updated_at: new Date().toISOString() })
    .eq("id", args.id)
    .eq("user_id", uid);

  if (error) throw new Error(error.message || "Could not set due date.");
}

export async function archiveDevelopmentFocusItem(id: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("development_focus_items")
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", uid);

  if (error) throw new Error(error.message || "Could not archive item.");
}

export async function deleteDevelopmentFocusItem(id: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("development_focus_items")
    .delete()
    .eq("id", id)
    .eq("user_id", uid);

  if (error) throw new Error(error.message || "Could not delete focus item.");
}

export async function listUpdatesForFocusItem(focusItemId: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("development_focus_updates")
    .select("id,focus_item_id,user_id,note,created_at")
    .eq("focus_item_id", focusItemId)
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message || "Could not load updates.");
  return (data ?? []) as DevelopmentFocusUpdateRow[];
}

export async function addUpdateForFocusItem(args: {
  focus_item_id: string;
  note: string;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in.");
  const note = args.note.trim();
  if (!note) throw new Error("Update text is required.");

  const { data, error } = await supabase
    .from("development_focus_updates")
    .insert({
      focus_item_id: args.focus_item_id,
      user_id: uid,
      note,
    })
    .select("id,focus_item_id,user_id,note,created_at")
    .maybeSingle();

  if (error) throw new Error(error.message || "Could not add update.");
  return data as DevelopmentFocusUpdateRow;
}

