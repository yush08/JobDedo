"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Settings data controls: download every stored row (GET /api/v1/export) and
 * delete personal data (POST /api/v1/wipe with an explicit confirmation).
 * Both hit real endpoints — nothing here fakes success.
 */
export function DataControls() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const canWipe = confirmText.trim().toUpperCase() === "DELETE";

  async function handleWipe() {
    if (!canWipe || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/wipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true, scope: "personal_data" }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      }
      toast.success("Personal data deleted", {
        description: "Sample listings and app configuration were kept.",
      });
      setOpen(false);
      setConfirmText("");
      router.refresh();
    } catch (err) {
      toast.error("Could not delete data", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a href="/api/v1/export" download>
        <Button variant="outline">
          <Download aria-hidden />
          Export all data (JSON)
        </Button>
      </a>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={<Button variant="destructive" />}
        >
          <Trash2 aria-hidden />
          Delete personal data
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete personal data</DialogTitle>
            <DialogDescription>
              This removes your profile content, preferences, saved jobs,
              matches, applications, resumes, recruiters, drafts and
              notifications from storage. Sample listings and app configuration
              are kept. This cannot be undone — export first if you want a copy.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="wipe-confirm"
              className="text-xs font-medium text-muted-foreground"
            >
              Type <span className="font-mono text-foreground">DELETE</span> to
              confirm
            </label>
            <Input
              id="wipe-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleWipe}
              disabled={!canWipe || busy}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {busy ? "Deleting…" : "Delete my data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
