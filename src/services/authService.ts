import { supabase } from "../lib/supabaseClient";

export async function getProfile() {
  return await supabase
    .from("profiles")
    .select("*")
    .single();
}