"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/types";

/**
 * Manual recheck trigger. The server performs a bounded, real check and
 * appends to verification history; nothing is simulated client-side.
 */
export function RecheckButton({
  jobId,
  size = "sm",
}: {
  jobId: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/jobs/${jobId}/verify`, { method: "POST" });
      const json = await res.json();
      if (res.ok && json.ok) {
        toast.success("Recheck completed", {
          description: json.data.note as string,
        });
        router.refresh();
      } else {
        const err = json as ApiErrorBody;
        toast.error("Recheck failed", { description: err.error?.message });
      }
    } catch {
      toast.error("Recheck failed", {
        description: "Could not reach the verification endpoint.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size={size} onClick={run} disabled={loading}>
      {loading ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <RefreshCw aria-hidden />
      )}
      {loading ? "Rechecking…" : "Recheck"}
    </Button>
  );
}
