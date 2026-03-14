import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useTaxonomy() {
  return useQuery({
    queryKey: ["taxonomy"],
    queryFn: api.listTaxonomy,
  });
}
