/**
 * Shared QueryClient + stable query keys for the cloud API.
 *
 * Mount the provider once (e.g. in main.tsx):
 *   import { QueryClientProvider } from "@tanstack/react-query";
 *   import { queryClient } from "@/lib/api";
 *   <QueryClientProvider client={queryClient}>...</QueryClientProvider>
 */

import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (failureCount, error) => {
        // Don't retry auth/permission style errors; do retry transient ones.
        if (error instanceof ApiError && error.code !== -1) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

/** Centralized, type-safe query keys. */
export const qk = {
  eqShareList: (vid?: number, pid?: number, adc?: boolean) =>
    ["eq", "shareList", { vid, pid, adc }] as const,
  reportType: () => ["eq", "reportType"] as const,
  firmwareList: (vid: number, pid: number) =>
    ["firmware", "list", { vid, pid }] as const,
  comments: (eqId: number) => ["comments", "list", eqId] as const,
  userDetail: () => ["user", "detail"] as const,
} as const;
