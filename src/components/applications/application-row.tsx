"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";

import { StageBadge } from "@/components/applications/stage-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { APPLICATION_STAGES, type Application, type ApplicationStage } from "@/types";
import { formatDate, formatDateTime, titleCase } from "@/lib/utils/format";
import type { ApiErrorBody } from "@/types";

const POST_SUBMISSION: ApplicationStage[] = [
  "applied",
  "recruiter_contacted",
  "interview",
  "offer",
  "rejected",
];

/** One application row with inline stage control and expandable history. */
export function ApplicationRow({ application }: { application: Application }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmStage, setConfirmStage] = useState<ApplicationStage | null>(null);
  const [stageNote, setStageNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const moveStage = async (stage: ApplicationStage, note: string) => {
    setMoving(true);
    try {
      const res = await fetch(`/api/v1/applications/${application.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage, stage_note: note }),
      });
      const json = (await res.json()) as { ok: true } | ApiErrorBody;
      if (!res.ok || !("ok" in json)) {
        toast.error(
          "error" in json ? json.error.message : "Stage could not be updated.",
        );
        return;
      }
      toast.success(`Moved to ${titleCase(stage)}`, {
        description: "Status history recorded.",
      });
      setConfirmStage(null);
      setStageNote("");
      setConfirmed(false);
      router.refresh();
    } catch {
      toast.error("Could not reach the applications endpoint.");
    } finally {
      setMoving(false);
    }
  };

  const needsConfirmation =
    confirmStage !== null && POST_SUBMISSION.includes(confirmStage);

  return (
    <>
      <Card className="card-shadow">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[15px] font-semibold tracking-tight">
                  {application.job_title}
                </p>
                <StageBadge stage={application.stage} />
                {application.match_score != null && (
                  <Badge variant="outline" className="text-[10px]">
                    Match {application.match_score}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {application.company_name}
                </span>
                {application.applied_at && (
                  <span>Applied {formatDate(application.applied_at)}</span>
                )}
                {application.follow_up_at && (
                  <span className="text-warning">
                    Follow up {formatDate(application.follow_up_at)}
                  </span>
                )}
                <span>Updated {formatDateTime(application.updated_at)}</span>
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Select
                value={application.stage}
                onValueChange={(value) => {
                  if (!value || value === application.stage) return;
                  setConfirmStage(value as ApplicationStage);
                }}
              >
                <SelectTrigger
                  className="w-[180px]"
                  aria-label={`Change stage for ${application.job_title}`}
                  disabled={moving}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPLICATION_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {titleCase(stage)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                History ({application.events.length})
              </Button>
            </div>
          </div>

          {expanded && (
            <div className="mt-3 border-t pt-3">
              {application.notes && (
                <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs">
                  <span className="font-semibold">Notes:</span> {application.notes}
                </p>
              )}
              {application.events.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No status changes recorded yet. History is append-only — every
                  stage move is kept.
                </p>
              ) : (
                <ol className="space-y-2">
                  {application.events.map((event) => (
                    <li key={event.id} className="flex items-start gap-2 text-xs">
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                        aria-hidden
                      />
                      <span>
                        <span className="font-medium">
                          {event.from_stage
                            ? `${titleCase(event.from_stage)} → ${titleCase(event.to_stage)}`
                            : `Created as ${titleCase(event.to_stage)}`}
                        </span>
                        {event.note && (
                          <span className="text-muted-foreground"> — {event.note}</span>
                        )}
                        <span className="ml-2 text-muted-foreground/80">
                          {formatDateTime(event.created_at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stage-move confirmation (post-submission moves need explicit confirm) */}
      <Dialog
        open={confirmStage !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setConfirmStage(null);
            setStageNote("");
            setConfirmed(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Move to {confirmStage ? titleCase(confirmStage) : ""}
            </DialogTitle>
            <DialogDescription>
              {application.job_title} · {application.company_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`note-${application.id}`}>Note (optional)</Label>
              <Textarea
                id={`note-${application.id}`}
                rows={2}
                value={stageNote}
                onChange={(event) => setStageNote(event.target.value)}
                placeholder="Recruiter replied on LinkedIn…"
              />
            </div>

            {needsConfirmation && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 size-4"
                  aria-label="Confirm this stage change reflects reality"
                />
                <span className="text-xs">
                  I confirm this reflects what actually happened. JobDedo never
                  marks an application as submitted or contacted without your
                  confirmation.
                </span>
              </label>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStage(null)}>
              Cancel
            </Button>
            <Button
              disabled={moving || (needsConfirmation && !confirmed)}
              onClick={() => {
                if (confirmStage) void moveStage(confirmStage, stageNote);
              }}
            >
              {moving && <Loader2 className="animate-spin" aria-hidden />}
              Update stage
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
