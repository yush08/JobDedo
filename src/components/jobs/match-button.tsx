"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Recompute + persist the match explanation for one job. */
export function MatchButton({ jobId, size = "sm" }: { jobId: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/jobs/${jobId}/match`, { method: "POST" });
      const json = await res.json();
      if (res.ok && json.ok) {
        toast.success(`Match score: ${json.data.match.score}/100`, {
          description: "Explanation saved to your match history.",
        });
        router.refresh();
      } else {
        toast.error("Could not compute match", {
          description: json?.error?.message,
        });
      }
    } catch {
      toast.error("Could not reach the matching endpoint.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size={size} onClick={run} disabled={loading}>
      {loading ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Sparkles aria-hidden />
      )}
      {loading ? "Computing…" : "Explain match"}
    </Button>
  );
}
