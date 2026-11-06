"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/utils/format";
import { DRAFT_TYPES, DRAFT_TYPE_LABEL } from "@/lib/outreach/draft-generator";
import type { DraftType } from "@/lib/outreach/draft-generator";
import type { EmailDraft, Recruiter, ResumeVersion } from "@/types";

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

function isEmailDraft(value: unknown): value is EmailDraft {
  return isRecord(value) && typeof value.id === "string" && typeof value.subject === "string" &&
    typeof value.body === "string" && typeof value.draft_type === "string" && typeof value.status === "string";
}

function isResumeVersion(value: unknown): value is ResumeVersion {
  return isRecord(value) && typeof value.id === "string" && typeof value.resume_id === "string" &&
    typeof value.version_number === "number";
}

function extractErrorMessage(result: unknown, fallback: string): string {
  if (!isRecord(result)) return fallback;
  if (typeof result.error === "string") return result.error;
  if (isRecord(result.error) && typeof result.error.message === "string") {
    return result.error.message;
  }
  return fallback;
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
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [selectedResumeVersion, setSelectedResumeVersion] = useState<string>(
    "",
  );
  const [selectedDraft, setSelectedDraft] = useState<EmailDraft | null>(null);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [draftType, setDraftType] = useState<DraftType>("hiring_manager_intro");
  const [jobDescription, setJobDescription] = useState<string>("");
  const [contextNote, setContextNote] = useState<string>("");
  const [recruiterId, setRecruiterId] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  /** The stored draft this preview corresponds to (null = not saved yet). */
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  /** True when the preview content differs from what is stored. */
  const [dirty, setDirty] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecruiterContacts, setShowRecruiterContacts] = useState(true);
  const generateInFlight = useRef(false);
  const saveInFlight = useRef(false);
  // Upload state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadedVersionId, setUploadedVersionId] = useState<string | null>(null);
  const [uploadedResumeTitle, setUploadedResumeTitle] = useState<string | null>(null);
  const [extractedResumeText, setExtractedResumeText] = useState<string>("");

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

  // --- Generate email via API (preview only; nothing is stored yet) ---
  const handleGenerate = async () => {
    if (generateInFlight.current) return;
    generateInFlight.current = true;
    setError(null);
    setIsGenerating(true);
    try {
      const res = await fetch("/api/v1/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeVersionId: uploadedVersionId || selectedResumeVersion,
          jobDescription,
          draftType,
          recruiterId: recruiterId || undefined,
          contextNote: contextNote.trim() || undefined,
        }),
      });
      const result: unknown = await res.json();
      const draft = isRecord(result) && isEmailDraft(result.draft) ? result.draft : null;
      if (!res.ok || !draft) {
        setError(extractErrorMessage(result, "Failed to generate draft"));
        return;
      }
      setSubject(draft.subject);
      setBody(draft.body);
      setSelectedDraft(draft);
      setSavedDraftId(null); // a fresh generation is not stored yet
      setDirty(false);
      setShowDraftDialog(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      generateInFlight.current = false;
      setIsGenerating(false);
    }
  };

  // --- Save: create a new stored draft, or update the opened one in place ---
  const handleSaveDraft = async () => {
    if (saveInFlight.current) return;
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody) {
      setError("Add a subject and an email body before saving.");
      return;
    }
    saveInFlight.current = true;
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch("/api/v1/outreach/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedDraftId ?? undefined,
          subject: trimmedSubject,
          body: trimmedBody,
          draftType,
          recruiterId: recruiterId || undefined,
        }),
      });
      const result: unknown = await res.json();
      const saved = isRecord(result) && isEmailDraft(result.draft) ? result.draft : null;
      if (!res.ok || !saved) {
        setError(extractErrorMessage(result, "Failed to save draft"));
        return;
      }
      setSubject(trimmedSubject);
      setBody(trimmedBody);
      setSavedDraftId(saved.id);
      setDirty(false);
      setSelectedDraft((current) => (current ? { ...current, ...saved } : saved));
      void fetchDrafts();
      if (typeof onDraftSave === "function") {
        onDraftSave(saved);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  // --- Resume upload state ---
  const uploadInFlight = useRef<boolean>(false);

  // --- File change handler ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setUploadFile(file);
    setUploadMessage(null);
    setUploadProgress(0);
  };

  // --- Upload resume handler ---
  const handleUploadResume = async () => {
    if (!uploadFile || uploadInFlight.current) return;
    uploadInFlight.current = true;
    setUploadProgress(10);
    setUploadMessage(null);
    const formData = new FormData();
    formData.append("resume", uploadFile);
    try {
      const res = await fetch("/api/v1/resumes/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errorPayload = await res.json();
        const errorMsg = errorPayload instanceof Error ? errorPayload.message : String(errorPayload?.message ?? errorPayload?.error ?? "Upload failed");
        throw new Error(errorMsg);
      }
      const payload = (await res.json()) as {
        draftId: string;       // ResumeVersion's database UUID
        versionNumber: number;
        extractedText: string;
        originalFileName: string;
        warnings: string;
        source: string;
      };
      setUploadProgress(100);
      setUploadMessage("Resume uploaded successfully.");
      // Parse the response to get version ID and resume details
      const extractedText = payload.extractedText ?? "";
      const originalFileName = payload.originalFileName ?? uploadFile?.name ?? "";
      const warnings = payload.warnings ?? "[]";
      const source = payload.source ?? "pdf";

      setUploadedVersionId(payload.draftId ?? "");
      setUploadedResumeTitle(originalFileName ?? "Uploaded resume");

      // Store extracted text so the generator can use it
      setExtractedResumeText(extractedText);

      // Only auto-select this version if extraction succeeded with meaningful content
      if (extractedText && extractedText.trim().length >= 20) {
        setSelectedResumeVersion(payload.draftId ?? "");
      } else {
        setUploadMessage(
          extractedText?.trim().length > 0
            ? "Resume uploaded but extraction produced limited text. Please review."
            : "Resume uploaded but no text could be extracted.",
        );
      }

      setUploadFile(null);
      await fetchResumeVersions();
    } catch (reason) {
      setUploadProgress(0);
      setUploadMessage(
        reason instanceof Error ? reason.message : "Upload failed",
      );
    } finally {
      uploadInFlight.current = false;
      setUploadProgress(0);
    }
  };

  // --- Regenerate: never silently overwrite user edits ---
  const handleRegenerate = () => {
    if (generateInFlight.current) return;
    if (
      dirty &&
      !window.confirm("Discard your current edits and generate a new draft?")
    ) {
      return;
    }
    void handleGenerate();
  };

  // --- Reset the preview (New Draft) ---
  const handleNewDraft = () => {
    if (
      dirty &&
      !window.confirm("Discard your current edits and start a new draft?")
    ) {
      return;
    }
    setSelectedDraft(null);
    setShowDraftDialog(false);
    setSubject("");
    setBody("");
    setSavedDraftId(null);
    setDirty(false);
    setError(null);
  };

  // --- Open a stored draft with its exact saved content ---
  const handleEditSaved = (draft: EmailDraft) => {
    setSubject(draft.subject);
    setBody(draft.body);
    setDraftType(draft.draft_type);
    setRecruiterId(draft.recruiter_id ?? "");
    setSavedDraftId(draft.id);
    setDirty(false);
    setSelectedDraft(draft);
    setShowDraftDialog(true);
    setError(null);
  };

  // --- Edit tracking: the preview reflects real user changes ---
  const handleSubjectChange = (value: string) => {
    setSubject(value);
    setDirty(true);
  };
  const handleBodyChange = (value: string) => {
    setBody(value);
    setDirty(true);
  };

  // --- Copy to clipboard (copies the current edited values) ---
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

  const showContextNote =
    draftType === "follow_up" || draftType === "thank_you";

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
          their status (draft → approved → sent) and always require your approval
          before sending. Recruiter contacts are only stored with a public source
          URL as evidence. No email addresses are ever guessed or synthesized.
        </p>
      </div>

      {/* --- Recruiter contacts --- */}
      <Card className="card-shadow">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <strong className="text-sm font-semibold">
              Recruiter contacts
            </strong>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
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
          ) : showRecruiterContacts ? (
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
          ) : (
            <p className="text-xs text-muted-foreground">
              Contacts are hidden. Use “Show contacts” to display them.
            </p>
          )}
        </div>
      </Card>

      {/* --- Drafts list --- */}
      <Card className="card-shadow">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <strong className="text-sm font-semibold">
              Email drafts
            </strong>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleNewDraft}
          >
            <Mail className="size-4 mr-2" /> New Draft
          </Button>
        </div>
        <div className="p-4">
          {drafts.length === 0 ? (
            <EmptyState
              icon={File}
              title="No drafts yet"
              description="Create your first draft by selecting a resume version and entering a job description, then save it here to reopen and edit it later."
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
                          {DRAFT_TYPE_LABEL[draft.draft_type] ?? draft.draft_type} ·
                          {" "}{formatDate(draft.created_at)}
                        </p>
                        {draft.body && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {draft.body}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
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
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => handleEditSaved(draft)}
                        >
                          Edit
                        </Button>
                      </div>
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
        <div className="flex items-center justify-between px-4 py-3">
          <strong className="text-sm font-semibold">
            Generate Email Draft
          </strong>
        </div>
        <div className="p-4">
          {isGenerating ? (
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 mr-2 animate-spin" />
              <span>Generating draft…</span>
            </div>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault();
              void handleGenerate();
            }}>
              <div className="grid gap-4 lg:grid-cols-2 mb-4">
                <div>
                  <label className="block text-xs font-medium mb-2">
                    Resume
                  </label>
                  {selectedResumeVersion ? (
                    <div>
                      <p className="text-sm font-medium">
                        {uploadedResumeTitle ?? "Resume loaded from studio"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Version {selectedResumeVersion}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => {
                          setSelectedResumeVersion("");
                          setUploadedVersionId(null);
                          setUploadedResumeTitle(null);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  )
                  : (
                    <>
                      <Input
                        type="file"
                        accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={handleFileChange}
                        className="w-full"
                        disabled={uploadProgress > 0 && uploadProgress < 100}
                      />
                      {uploadFile && uploadProgress === 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={handleUploadResume}
                        >
                          Upload
                        </Button>
                      )}
                      {uploadProgress > 0 && uploadProgress < 100 && (
                        <Progress value={uploadProgress} />
                      )}
                      {uploadMessage && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {uploadMessage}
                        </p>
                      )}
                    </>
                  )}

                  <p className="text-[10px] text-muted-foreground mt-1">
                    Supported: PDF or DOCX. Max 5 MB.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-2">
                    Draft Type
                  </label>
                  <select
                    value={draftType}
                    onChange={(e) => {
                      const next = (e.target.value || "hiring_manager_intro") as DraftType;
                      setDraftType(next);
                      if (savedDraftId) setDirty(true);
                    }}
                  >
                    {DRAFT_TYPES.map((key) => {
                      return (
                        <option key={key} value={key}>
                          {DRAFT_TYPE_LABEL[key]}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2 mb-4">
                <div>
                  <label className="block text-xs font-medium mb-2">
                    Recruiter (optional)
                  </label>
                  <select
                    value={recruiterId}
                    onChange={(e) => {
                      setRecruiterId(e.target.value);
                      if (savedDraftId) setDirty(true);
                    }}
                  >
                    <option value="">No recruiter selected</option>
                    {recruiters.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}{r.title ? ` — ${r.title}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Only used when you select one — no recruiter details are ever invented.
                  </p>
                </div>

                {showContextNote && (
                  <div>
                    <label className="block text-xs font-medium mb-2">
                      Additional context (optional)
                    </label>
                    <Textarea
                      value={contextNote}
                      onChange={(e) => setContextNote(e.target.value)}
                      rows={3}
                      placeholder={
                        draftType === "follow_up"
                          ? "e.g. where you applied or who you spoke with"
                          : "e.g. topics you discussed with the interviewer"
                      }
                      className="w-full"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Added as written — nothing here is invented for you.
                    </p>
                  </div>
                )}
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
                  Required — at least 20 characters for analysis.
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
                  type="button"
                  variant="outline"
                  disabled={isGenerating}
                  onClick={() => {
                    setJobDescription("");
                    setContextNote("");
                  }}
                >
                  Clear
                </Button>
              </div>
            </form>
          )}

          {/* --- Generated email editor --- */}
          {selectedDraft && showDraftDialog && !isGenerating && (
            <div className="mt-4 p-4 rounded-lg border bg-primary/10">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                  Preview Email
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {savedDraftId
                    ? dirty
                      ? "Unsaved changes"
                      : "Saved"
                    : "Not saved yet"}
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium mb-1">
                    Subject
                  </label>
                  <Input
                    value={subject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    placeholder="Subject line"
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium mb-1">
                    Email Body
                  </label>
                  <Textarea
                    value={body}
                    onChange={(e) => handleBodyChange(e.target.value)}
                    rows={8}
                    className="w-full"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    onClick={() => void handleCopy(subject)}
                    disabled={!subject.trim()}
                  >
                    <Copy className="size-4 mr-2" /> Copy Subject
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleCopy(body)}
                    disabled={!body.trim()}
                  >
                    <Copy className="size-4 mr-2" /> Copy Email
                  </Button>
                </div>

                <div className="flex gap-3 mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                  >
                    Regenerate
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSaveDraft()}
                    disabled={
                      isSaving ||
                      !subject.trim() ||
                      !body.trim() ||
                      (savedDraftId !== null && !dirty)
                    }
                  >
                    {isSaving ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="size-4 mr-2" />
                    )}
                    {savedDraftId !== null && !dirty ? "Saved" : "Save Draft"}
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
                The draft will use real content from your resume — no invented
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