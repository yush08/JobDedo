"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Info,
  Mail,
  Users,
  File,
  Loader2,
  Save,
  Play,
  Copy,
} from "lucide-react";


import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format";
import type { EmailDraft, Recruiter, ResumeVersion } from "@/types";

type DraftType = EmailDraft["draft_type"];

interface GeneratedDraft extends EmailDraft {
  associatedJob?: { title: string; company: string; description: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseItems(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  if (Array.isArray(value[key])) return value[key];
  return isRecord(value.data) && Array.isArray(value.data[key]) ? value.data[key] : [];
}

function isRecruiter(value: unknown): value is Recruiter {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
    typeof value.title === "string" && typeof value.evidence_url === "string" &&
    (value.verification_status === "public_confirmed" || value.verification_status === "uncertain" || value.verification_status === "not_found");
}

function isEmailDraft(value: unknown): value is GeneratedDraft {
  return isRecord(value) && typeof value.id === "string" && typeof value.subject === "string" &&
    typeof value.body === "string" && typeof value.draft_type === "string" && typeof value.status === "string";
}

function isResumeVersion(value: unknown): value is ResumeVersion {
  return isRecord(value) && typeof value.id === "string" && typeof value.resume_id === "string" &&
    typeof value.version_number === "number";
}

export interface OutreachPageClientProps {
  resumeVersionId?: string;
  onDraftSave?: (draft: EmailDraft) => void;
}

export default function OutreachClient({
  resumeVersionId: initialResumeVersionId,
  onDraftSave,
}: OutreachPageClientProps) {
  // --- State ---
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [drafts, setDrafts] = useState<GeneratedDraft[]>([]);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [selectedResumeVersion, setSelectedResumeVersion] = useState<string>(
    "",
  );
  const [selectedDraft, setSelectedDraft] = useState<GeneratedDraft | null>(null);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [draftType, setDraftType] = useState<DraftType>("hiring_manager_intro");
  const [jobDescription, setJobDescription] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecruiterContacts, setShowRecruiterContacts] = useState(true);

  // --- Fetch resume versions from API ---
  const fetchResumeVersions = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/resumes/versions", {
        credentials: "include",
      });
      if (res.ok) {
        const data: unknown = await res.json();
        const foundVersions = responseItems(data, "versions").filter(isResumeVersion);
        setVersions(foundVersions);
        setSelectedResumeVersion((current) => current || initialResumeVersionId || foundVersions[0]?.id || "");
      }
    } catch {
      setSelectedResumeVersion("");
    }
  }, [initialResumeVersionId]);

  // --- Fetch recruiter contacts from API ---
  const fetchRecruiters = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/outreach/recruiters", {
        credentials: "include",
      });
      if (res.ok) {
        const data: unknown = await res.json();
        setRecruiters(responseItems(data, "recruiters").filter(isRecruiter));
      }
    } catch {
      setRecruiters([]);
    }
  }, []);

  // --- Fetch drafts from API ---
  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/outreach/drafts", {
        credentials: "include",
      });
      if (res.ok) {
        const data: unknown = await res.json();
        setDrafts(responseItems(data, "drafts").filter(isEmailDraft));
      }
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void Promise.all([fetchRecruiters(), fetchDrafts(), fetchResumeVersions()]);
    });
  }, [fetchDrafts, fetchRecruiters, fetchResumeVersions]);

  // --- Generate email via API ---
  const handleGenerate = async () => {
    setError(null);
    setIsGenerating(true);
    try {
      const res = await fetch("/api/v1/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeVersionId: selectedResumeVersion, jobDescription, draftType }),
      });
      const result: unknown = await res.json();
      const draft = isRecord(result) && isEmailDraft(result.draft) ? result.draft : null;
      if (!res.ok || !draft) {
        setError(isRecord(result) && typeof result.error === "string" ? result.error : "Failed to generate draft");
        return;
      }
      setSubject(draft.subject);
      setBody(draft.body);
      setSelectedDraft(draft);
      setShowDraftDialog(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedDraft) return;
    try {
      const res = await fetch("/api/v1/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeVersionId: selectedResumeVersion, jobDescription, draftType }),
      });
      const result: unknown = await res.json();
      const saved = isRecord(result) && isEmailDraft(result.draft) ? result.draft : null;
      if (res.ok && saved) {
        const editedDraft: GeneratedDraft = { ...saved, subject: subject.trim() || saved.subject, body: body.trim() || saved.body };
        setDrafts((prev) => [editedDraft, ...prev]);
        setShowDraftDialog(false);
        setError(null);
        if (typeof onDraftSave === "function") {
          onDraftSave(editedDraft);
        }
      } else {
        setError(isRecord(result) && typeof result.error === "string" ? result.error : "Failed to save draft");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Copy to clipboard ---
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cold Email Assistant"
        description="Personalised recruiter and hiring-manager outreach built from verified public contacts and your real profile."
        actions={
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Outreach
          </Badge>
        }
      />

      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          <strong className="font-medium">Email drafts</strong> are saved with
          their status (draft ΓåÆ approved ΓåÆ sent) and always require your approval
          before sending. Recruiter contacts are only stored with a public source
          URL as evidence. No email addresses are ever guessed or synthesized.
        </p>
      </div>

      {/* --- Recruiter contacts --- */}
      <Card className="card-shadow">
        <div
          className="flex items-center justify-between px-4 py-3"
        >
          <div>
            <strong className="text-sm font-semibold">
              Recruiter contacts
            </strong>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRecruiterContacts((v) => !v)}
          >
            {showRecruiterContacts ? "Hide contacts" : "Show contacts"}
          </Button>
        </div>
        <div className="p-4">
          {recruiters.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Contacts will only ever be stored with a public source URL proving where they were found."
              className="py-10"
            />
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {recruiters.map((r) => {
                const meta = RECRUITER_STATUS[r.verification_status] ?? {
                  label: r.verification_status,
                  className: "",
                };
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {r.name}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {r.title}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={meta.className}
                      >
                        {meta.label}
                      </Badge>
                    </div>
                    {r.evidence_url && (
                      <a
                        href={r.evidence_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block truncate text-[11px] text-primary underline-offset-2 hover:underline"
                      >
                        Evidence source
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      {/* --- Drafts list --- */}
      <Card className="card-shadow">
        <div
          className="flex items-center justify-between px-4 py-3"
        >
          <div>
            <strong className="text-sm font-semibold">
              Email drafts
            </strong>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDraftDialog(true)}
          >
            <Mail className="size-4 mr-2" /> New Draft
          </Button>
        </div>
        <div className="p-4">
          {drafts.length === 0 ? (
            <EmptyState
              icon={File}
              title="No drafts yet"
              description="Create your first draft by selecting a resume version and entering a job description."
              className="py-10"
            />
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {drafts.map((draft) => {
                return (
                  <li key={draft.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {draft.subject}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {DRAFT_TYPE_LABEL[
                            draft.draft_type
                          ] ?? draft.draft_type} ┬╖
                          {formatDate(draft.created_at)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          draft.status === "sent"
                            ? "border-success/40 bg-success/10 text-success"
                            : draft.status === "approved"
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : ""
                        }
                      >
                        {draft.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {draft.associatedJob?.title && (
                        <span>
                          {draft.associatedJob.title} at{" "}{draft.associatedJob.company}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      {/* --- Draft generation workspace --- */}
      <Card className="card-shadow">
        <div
          className="flex items-center justify-between px-4 py-3"
        >
          <strong className="text-sm font-semibold">
            Generate Email Draft
          </strong>
        </div>
        <div className="p-4">
          {isGenerating ? (
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 mr-2 animate-spin" />
              <span>Generating draftΓÇª</span>
            </div>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault();
              handleGenerate();
            }}>
              <div className="grid gap-4 lg:grid-cols-2 mb-4">
                <div>
                  <label className="block text-xs font-medium mb-2">
                    Resume Version
                  </label>
                  <select
                    onChange={(e) => {
                      setSelectedResumeVersion(
                        e.target.value,
                      );
                    }}
                    value={selectedResumeVersion}
                  >
                    <option value="">Select a resume version</option>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        Version {version.version_number}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Upload a resume in Resume Studio or select an existing version.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-2">
                    Draft Type
                  </label>
                  <select
                    value={draftType}
                    onChange={(e) =>
                      setDraftType((e.target.value || "hiring_manager_intro") as DraftType)
                    }
                  >
                    <option value="">Select draft type</option>
                    {"hiring_manager_intro recruiter_intro follow_up referral_request thank_you internship_outreach".split(
                      " ",
                    ).map((key) => (
                      <option key={key} value={key}>
                        {DRAFT_TYPE_LABEL[key as keyof typeof DRAFT_TYPE_LABEL]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-2">
                  Job Description
                </label>
                <Textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  rows={6}
                  placeholder="Paste the job description here..."
                  className="w-full"
                  minLength={20}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Required ΓÇö at least 20 characters for analysis.
                </p>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={isGenerating}>
                  {isGenerating ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="size-4 mr-2" />
                  )}
                  Generate Email
                </Button>
                <Button
                  variant="outline"
                  disabled={isGenerating}
                  onClick={() => setJobDescription("")}
                >
                  Clear
                </Button>
              </div>
            </form>
          )}

          {/* --- Generated email editor --- */}
          {selectedDraft && showDraftDialog && !isGenerating && (
            <div className="mt-4 p-4 rounded-lg border bg-primary/10">
              <h3 className="text-sm font-medium mb-3">
                Preview Email
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium mb-1">
                    Subject
                  </label>
                  <Input
                    value={subject || selectedDraft.subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject line"
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium mb-1">
                    Email Body
                  </label>
                  <Textarea
                    value={body || selectedDraft.body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    className="w-full"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() =>
                      handleCopy(subject || selectedDraft.subject)
                    }
                    disabled={!(subject || selectedDraft.subject).length}
                  >
                    <Copy className="size-4 mr-2" /> Copy Subject
                  </Button>
                  <Button
                    onClick={() =>
                      handleCopy(body || selectedDraft.body)
                    }
                    disabled={!(body || selectedDraft.body).length}
                  >
                    <Copy className="size-4 mr-2" /> Copy Email
                  </Button>
                </div>

                <div className="flex gap-3 mt-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSubject("");
                      setBody("");
                      setSelectedDraft(null);
                    }}
                  >
                    Regenerate
                  </Button>
                  <Button
                    onClick={handleSaveDraft}
                    disabled={!(subject?.trim() || body?.trim())}
                  >
                    <Save className="size-4 mr-2" /> Save Draft
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!selectedDraft && !isGenerating && (
            <div className="mt-4 p-4 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-sm">
                Select a resume version and enter a job description, then click{" "}
                <Play className="size-4 mr-2" /> Generate Email
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                The draft will use real content from your resume ΓÇö no invented
                experience or achievements.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// Helper records (kept at module level for the client component)
const RECRUITER_STATUS: Record<string, { label: string; className: string }> = {
  public_confirmed: {
    label: "Public contact confirmed",
    className: "border-success/40 bg-success/10 text-success",
  },
  uncertain: {
    label: "Uncertain",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  not_found: {
    label: "No public contact found",
    className: "border-border bg-muted text-muted-foreground",
  },
};

const DRAFT_TYPE_LABEL: Record<string, string> = {
  hiring_manager_intro: "Hiring manager intro",
  follow_up: "Follow-up",
  referral_request: "Referral request",
  thank_you: "Post-interview thank-you",
  internship_outreach: "Internship outreach",
  generic: "Generic outreach",
};
