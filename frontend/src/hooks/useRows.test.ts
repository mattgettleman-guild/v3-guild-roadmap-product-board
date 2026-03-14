import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useRows, useUpdateRow } from "./useRows";
import type { RoadmapRow } from "@roadmap/shared";

// Mock the api module before any hook imports resolve it
vi.mock("../lib/api", () => ({
  api: {
    listRows: vi.fn(),
    updateRow: vi.fn(),
    createRow: vi.fn(),
    deleteRow: vi.fn(),
  },
}));

import { api } from "../lib/api";
const mockApi = api as unknown as {
  listRows: ReturnType<typeof vi.fn>;
  updateRow: ReturnType<typeof vi.fn>;
};

function makeRow(overrides: Partial<RoadmapRow> = {}): RoadmapRow {
  return {
    id: "row-1",
    investment: "Test Investment",
    domain: "Engineering",
    strategicPillar: "Growth",
    productPriority: "P1",
    owners: "alice@guild.com",
    status: "In Progress",
    tactics: [],
    jiraLinks: [],
    tags: [],
    themes: [],
    visibility: "internal_only",
    sourceOfTruth: {},
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    updatedBy: "alice@guild.com",
    expectedBenefits: [],
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useRows", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("returns an array of rows from the API on success", async () => {
    const rows = [makeRow({ id: "row-1" }), makeRow({ id: "row-2" })];
    mockApi.listRows.mockResolvedValue(rows);

    const { result } = renderHook(() => useRows(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].id).toBe("row-1");
  });

  it("starts in loading state", () => {
    // Never resolves — we just check the initial state
    mockApi.listRows.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRows(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("returns an error state when the API rejects", async () => {
    mockApi.listRows.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useRows(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("calls api.listRows (not some other method)", async () => {
    mockApi.listRows.mockResolvedValue([]);

    const { result } = renderHook(() => useRows(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.listRows).toHaveBeenCalledTimes(1);
  });
});

describe("useUpdateRow", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("calls api.updateRow with the correct id and body", async () => {
    const updatedRow = makeRow({ investment: "Updated Name" });
    mockApi.updateRow.mockResolvedValue(updatedRow);

    const { result } = renderHook(() => useUpdateRow(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: "row-1", body: { investment: "Updated Name" } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.updateRow).toHaveBeenCalledWith("row-1", { investment: "Updated Name" });
  });

  it("applies optimistic update immediately before server responds", async () => {
    const rows = [makeRow({ id: "row-1", investment: "Old Name" })];
    // Seed the cache with initial rows
    queryClient.setQueryData(["rows"], rows);

    let resolveUpdate!: (v: RoadmapRow) => void;
    mockApi.updateRow.mockReturnValue(
      new Promise<RoadmapRow>((res) => {
        resolveUpdate = res;
      }),
    );

    const { result } = renderHook(() => useUpdateRow(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: "row-1", body: { investment: "New Name" } });
    });

    // Optimistic update should be visible in cache before server responds
    await waitFor(() => {
      const cached = queryClient.getQueryData<RoadmapRow[]>(["rows"]);
      return cached?.[0].investment === "New Name";
    });

    // Clean up: let the mutation settle
    resolveUpdate(makeRow({ investment: "New Name" }));
  });

  it("rolls back cache on mutation error", async () => {
    const rows = [makeRow({ id: "row-1", investment: "Original Name" })];
    queryClient.setQueryData(["rows"], rows);

    mockApi.updateRow.mockRejectedValue(new Error("server error"));
    // Prevent unhandled-rejection noise in this test
    mockApi.listRows.mockResolvedValue(rows);

    const { result } = renderHook(() => useUpdateRow(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: "row-1", body: { investment: "Bad Name" } });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After rollback the original name should be restored
    const cached = queryClient.getQueryData<RoadmapRow[]>(["rows"]);
    expect(cached?.[0].investment).toBe("Original Name");
  });
});
