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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows"] }),
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
