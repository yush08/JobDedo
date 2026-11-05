"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APPLICATION_STAGES, type ApplicationStage } from "@/types";
import { titleCase } from "@/lib/utils/format";
import type { ApiErrorBody } from "@/types";

/** Stages that imply the candidate actually submitted an application. */
const POST_SUBMISSION: ApplicationStage[] = [
  "applied",
  "recruiter_contacted",
  "interview",
  "offer",
  "rejected",
];

interface Props {
  job: {
    id: string;
    title: string;
    original_url: string;
    application_url: string;
  };
  companyName: string;
}

/**
 * Track a job in the application tracker.
 * Creating an entry in a post-submission stage requires an explicit
 * confirmation checkbox — JobDedo never marks anything as applied on its own.
 */
export function TrackApplicationButton({ job, companyName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<ApplicationStage>("shortlisted");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);

  const needsConfirmation = POST_SUBMISSION.includes(stage);

  const submit = async () => {
    if (needsConfirmation && !confirmed) {
      toast.error("Confirmation required", {
        description:
          "Confirm that you actually submitted this application before tracking it as such.",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          company_name: companyName,
          job_title: job.title,
          original_url: job.original_url,
          application_url: job.application_url,
          stage,
          notes,
          confirmed_applied: confirmed,
          follow_up_at: followUp ? new Date(`${followUp}T09:00:00`).toISOString() : null,
        }),
      });
      const json = (await res.json()) as
        | { ok: true }
        | ApiErrorBody;

      if (!res.ok || !("ok" in json)) {
        const message =
          "error" in json ? json.error.message : "Could not create application.";
        toast.error(message);
        return;
      }

      toast.success("Added to application tracker", {
        description: `${job.title} · ${titleCase(stage)}`,
      });
      setOpen(false);
      setNotes("");
      setConfirmed(false);
      router.push("/applications");
      router.refresh();
    } catch {
      toast.error("Could not reach the applications endpoint.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => setOpen(next)}>
      <DialogTrigger
        render={<Button variant="outline" aria-label="Track this application" />}
      >
        <ClipboardList aria-hidden />
        Track application
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Track application</DialogTitle>
          <DialogDescription>
            {job.title} · {companyName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="stage">Stage</Label>
            <Select
              value={stage}
              onValueChange={(value) => {
                if (!value) return;
                setStage(value);
                if (!POST_SUBMISSION.includes(value)) setConfirmed(false);
              }}
            >
              <SelectTrigger id="stage" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {titleCase(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="follow-up">Follow-up date (optional)</Label>
            <input
              id="follow-up"
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="flex h-8 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Referral contact, portal details, next steps…"
              rows={3}
            />
          </div>

          {needsConfirmation && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
                className="mt-0.5"
                aria-label="Confirm I submitted this application"
              />
              <span className="text-xs">
                I confirm I have <strong>actually submitted</strong> this
                application (or the employer has contacted me). JobDedo never
                records an application as submitted without your confirmation.
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Save to tracker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
