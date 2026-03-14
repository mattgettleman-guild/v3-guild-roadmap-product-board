import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Priority } from "@roadmap/shared";

export function usePriorities() {
  return useQuery({
    queryKey: ["priorities-v3"],
    queryFn: api.listPrioritiesV3,
  });
}

export function useUpdatePriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Priority> }) =>
      api.updatePriorityById(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["priorities-v3"] }),
  });
}
