"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  FileText,
  GitBranch,
  ListChecks,
  Sparkles,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import {
  CapabilitySection,
  EndpointList,
} from "@/components/dashboard/capability";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils/format";

interface ResumeRow {
  id: string;
  title: string;
  source: string;
  created_at: string;
}

interface ResumeVersionRow {
  id: string;
  resume_id: string;
}

/** Safe error-to-message helper: never render an arbitrary object as React child. */
function errorToMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const maybe = err as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
    if (typeof maybe.code === "string") return maybe.code;
    return String(err);
  }
  return String(err);
}

export function ResumeClient() {
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const [versions, setVersions] = useState<ResumeVersionRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<{
    filename: string;
    size: number;
    extractedText: string;
    versionId: string;
  } | null>(null);

  const loadResumes = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/resumes/versions");
      if (res.ok) {
        const data = await res.json();
        // ok() wrapper returns { ok: true, data: { ... } }
        const payload = data.data ?? data;
        setResumes(payload.resumes || []);
        setVersions(payload.versions || []);
      }
    } catch {
      // Silently fail — empty state is fine
    }
  }, []);

  // Fetch on mount via setTimeout so setState is not called directly in the effect body.
  useEffect(() => {
    const timer = setTimeout(loadResumes, 0);
    return () => clearTimeout(timer);
  }, [loadResumes]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Client-side validation
      const validTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (!validTypes.includes(file.type)) {
        setUploadError("Unsupported file type. Please upload a PDF or DOCX file.");
        return;
      }

      const maxSize = 5 * 1024 * 1024; // 5 MB
      if (file.size > maxSize) {
        setUploadError("File size must be under 5 MB.");
        return;
      }

      setUploadError(null);
      setUploadSuccess(null);
      setUploading(true);

      const formData = new FormData();
      formData.append("resume", file);

      try {
        const res = await fetch("/api/v1/resumes/upload", {
          method: "POST",
          body: formData,
        });

        const result = await res.json();

        if (!res.ok) {
          setUploadError(errorToMessage(result.error));
          setUploading(false);
          return;
        }

        setUploadSuccess({
          filename: file.name,
          size: file.size,
          extractedText: result.extractedText || "",
          versionId: result.draftId || result.id || "",
        });
        setUploading(false);

        // Refresh resume list
        await loadResumes();
      } catch (err) {
        setUploadError(errorToMessage(err));
        setUploading(false);
      }
    },
    [loadResumes],
  );

  const clearError = useCallback(() => setUploadError(null), []);
  const clearSuccess = useCallback(() => setUploadSuccess(null), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resume Studio"
        description="Upload, parse, tailor and version resumes — grounded strictly in your Master Profile."
        actions={
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Resume Studio
          </Badge>
        }
      />

      <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
        <Upload className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          <strong className="font-medium">Upload Resume</strong>
          {" "}
          Select a PDF or DOCX file to get started. Supported: PDF, DOCX. Max size: 5MB.
        </p>
      </div>

      {uploadError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span className="ml-1">{uploadError}</span>
          <button
            onClick={clearError}
            className="ml-2 text-xs underline text-destructive hover:text-destructive/80"
          >
            Dismiss
          </button>
        </div>
      )}

      {uploadSuccess && (
        <div className="rounded-md border border-green/50 bg-green/10 p-4 text-sm text-green">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
          <div className="ml-1">
            <p className="font-medium">Upload complete</p>
            <p className="text-xs text-green/80">
              {uploadSuccess.filename} ({Math.round(uploadSuccess.size / 1024)} KB)
            </p>
            <p className="text-xs text-green/80">Extracted text ready for review.</p>
          </div>
          <button
            onClick={clearSuccess}
            className="ml-2 text-xs underline text-green hover:text-green/80"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-4">
        <label
          className={
            "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2" +
            (uploading
              ? " bg-muted text-muted-foreground cursor-not-allowed"
              : " bg-primary text-white hover:bg-primary/90")
          }
        >
          {uploading ? (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Upload className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span>{uploading ? "Uploading…" : "Upload Resume"}</span>
          <input
            type="file"
            name="resume"
            accept=".pdf, .docx"
            onChange={handleFileChange}
            className="opacity-0 absolute inset-0 w-full h-full pointer-events-none"
            disabled={uploading}
          />
        </label>
      </div>

      {/* Real rows only — empty until resumes are uploaded via the API */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Your resumes</h2>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {resumes.length} file{resumes.length === 1 ? "" : "s"} ·{" "}
            {versions.length} version{versions.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {resumes.length === 0 ? (
          <EmptyState
            icon={Upload}
            title="No resumes uploaded yet"
            description="Upload a PDF or DOCX resume via the API to get started. Text extraction always comes back as a review draft you confirm before anything touches your Master Profile."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {resumes.map((resume) => {
              const resumeVersions = versions.filter(
                (v) => v.resume_id === resume.id,
              );
              return (
                <Card key={resume.id} className="card-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium" title={resume.title}>
                        {resume.title}
                      </p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {resume.source}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {resumeVersions.length} version
                      {resumeVersions.length === 1 ? "" : "s"} · created{" "}
                      {formatDate(resume.created_at)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Planned Capability Section */}
          <CapabilitySection
            icon={Sparkles}
            title="Resume Studio Features"
            badge="Ready"
          >
            <ul className="space-y-2 text-xs text-muted-foreground">
              {[
                "PDF / DOCX upload with server-side text extraction",
                "Extraction review draft — you confirm before profile writes",
                "Job-specific tailoring grounded only in verified profile facts",
                "Version history with side-by-side comparison",
                "PDF and DOCX export",
                "One-page concise resume option",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground"
                    aria-hidden
                  />
                  {item}
                </li>
              ))}
            </ul>
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              Hard rule: generated resumes may only rewrite, reorder, shorten or
              emphasise facts already in your profile — never invent skills,
              dates, metrics or certifications.
            </p>
          </CapabilitySection>

          {/* API Contracts Section */}
          <CapabilitySection
            icon={ListChecks}
            title="API Endpoints"
            badge="Versioned · /api/v1"
          >
            <EndpointList
              endpoints={[
                {
                  method: "POST",
                  path: "/api/v1/resumes/upload",
                  status: "ready",
                  description:
                    "PDF/DOCX upload + server-side text extraction with review draft.",
                },
                {
                  method: "POST",
                  path: "/api/v1/resumes/tailor",
                  status: "ready",
                  description:
                    "Job-specific resume generation grounded in profile facts.",
                },
                {
                  method: "POST",
                  path: "/api/v1/resumes/analyze",
                  status: "ready",
                  description:
                    "Resume quality + job alignment report with three scores.",
                },
                {
                  method: "GET",
                  path: "/api/v1/resumes/versions",
                  status: "ready",
                  description: "Reads stored resumes and versions (real rows).",
                },
              ]}
            />
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <GitBranch className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              All endpoints return structured JSON — see the API routes for contracts.
            </p>
          </CapabilitySection>
        </div>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The Master Profile you already maintain on{" "}
          <Link href="/profile" className="underline underline-offset-2">
            My Profile
          </Link>{" "}
          is the single source of truth every future resume will be built from.
        </p>
      </section>
    </div>
  );
}