import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";

export function useClients() {
  return useQuery({
    queryKey:["clients"],
    queryFn: async () => {
      const { data } =
      await supabase
      .from("clients")
      .select("*");

      return data;
    }
  });
}