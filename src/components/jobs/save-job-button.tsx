"use client";

import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";

/**
 * Save / unsave a job. Persists to the database immediately (the saved flag
 * is never kept only in component state).
 */
export function SaveJobButton({
  jobId,
  saved,
  size = "icon-sm",
  className,
}: {
  jobId: string;
  saved: boolean;
  size?: "icon-sm" | "sm";
  className?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [optimistic, setOptimistic] = useState(saved);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await fetch(`/api/v1/jobs/${jobId}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saved: next }),
      });
      const json = (await res.json()) as ApiResponse<{ saved: boolean }>;
      if (!res.ok || !json.ok) throw new Error("Could not update saved state");
      return json.data.saved;
    },
    onMutate: (next) => {
      setOptimistic(next);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      router.refresh();
    },
    onError: (_err, previous) => {
      setOptimistic(!previous);
    },
  });

  const label = optimistic ? "Remove from saved" : "Save job";

  return (
    <Button
      variant="outline"
      size={size}
      aria-label={label}
      title={label}
      disabled={mutation.isPending}
      onClick={(event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        mutation.mutate(!optimistic);
      }}
      className={cn("shrink-0", className)}
    >
      {mutation.isPending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : optimistic ? (
        <BookmarkCheck className="text-primary" aria-hidden />
      ) : (
        <Bookmark aria-hidden />
      )}
      {size === "sm" && <span>{optimistic ? "Saved" : "Save"}</span>}
    </Button>
  );
}
