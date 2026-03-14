import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { RoadmapRow } from "@roadmap/shared";

export function useRows() {
  return useQuery({
    queryKey: ["rows"],
    queryFn: api.listRows,
  });
}

export function useUpdateRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<RoadmapRow> }) =>
      api.updateRow(id, body),

    // Optimistic update — immediately reflect the change in the UI
    onMutate: async ({ id, body }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: ["rows"] });

      // Snapshot the previous value
      const previous = qc.getQueryData<RoadmapRow[]>(["rows"]);

      // Optimistically update the cache
      if (previous) {
        qc.setQueryData<RoadmapRow[]>(
          ["rows"],
          previous.map((row) =>
            row.id === id ? { ...row, ...body, updatedAt: new Date().toISOString() } : row,
          ),
        );
      }

      return { previous };
    },

    // If the mutation fails, roll back to the previous value
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(["rows"], context.previous);
      }
    },

    // After success or error, refetch to ensure server state is accurate
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["rows"] });
    },
  });
}

export function useCreateRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<RoadmapRow>) => api.createRow(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows"] }),
  });
}

export function useDeleteRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows"] }),
  });
}
