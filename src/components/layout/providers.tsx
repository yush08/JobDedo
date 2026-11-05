"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { useState } from "react";

/**
 * Client-side providers: TanStack Query (interactive fetches such as global
 * search, discovery status polling), tooltips and toasts.
 * Server components read the database directly — they do not go through
 * React Query.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delay={200}>{children}</TooltipProvider>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
