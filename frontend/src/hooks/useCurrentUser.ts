/**
 * useCurrentUser — fetches the current authenticated user from the session.
 * Returns user data or null if not authenticated.
 */
import { useQuery } from "@tanstack/react-query";

interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const API_BASE = import.meta.env.VITE_API_BASE || "";
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as CurrentUser;
  } catch {
    return null;
  }
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  });
}
