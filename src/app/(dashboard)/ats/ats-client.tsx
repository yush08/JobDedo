"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { AlertCircle, Loader2, Play, ScanSearch } from "lucide-react";

import { StoredReportCard } from "@/components/ats/stored-report-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import type { AtsReport, Resume, ResumeVersion } from "@/types";

interface AtsAnalysis {
  documentQualityScore: number;
  jobCoverageScore: number;
  evidenceAlignmentScore: number;
  missingKeywords: string[];
  formattingIssues: string[];
  suggestions: string[];
  disclaimer: string;
}

interface AtsAnalysisResponse {
  documentQualityScore: number;
  jobCoverageScore: number;
  alignmentScore: number;
  missingKeywords: unknown[];
  formattingIssues: unknown[];
  suggestions: unknown[];
  disclaimer?: unknown;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getArray(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const direct = value[key];
  if (Array.isArray(direct)) return direct;
  return isRecord(value.data) && Array.isArray(value.data[key]) ? value.data[key] : [];
}

function isResume(value: unknown): value is Resume {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string";
}

function isResumeVersion(value: unknown): value is ResumeVersion {
  return isRecord(value) && typeof value.id === "string" && typeof value.resume_id === "string" &&
    typeof value.version_number === "number" && typeof value.created_at === "string";
}

function isAtsReport(value: unknown): value is AtsReport {
  return isRecord(value) && typeof value.id === "string" && typeof value.resume_version_id === "string" &&
    typeof value.document_quality === "number" && typeof value.job_coverage === "number" &&
    typeof value.evidence_alignment === "number" && typeof value.created_at === "string";
}

interface UploadResumeResponse {
  draftId: string;
  versionNumber: number;
  extractedText: string;
  originalFileName: string;
  warnings: string[];
}

function isUploadResumeResponse(value: unknown): value is UploadResumeResponse {
  return isRecord(value) && typeof value.draftId === "string" && typeof value.versionNumber === "number" && typeof value.extractedText === "string";
}

function messageFrom(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

function isAnalysis(value: unknown): value is AtsAnalysisResponse {
  return isRecord(value) && typeof value.documentQualityScore === "number" &&
    typeof value.jobCoverageScore === "number" && typeof value.alignmentScore === "number" &&
    Array.isArray(value.missingKeywords) && Array.isArray(value.formattingIssues) &&
    Array.isArray(value.suggestions);
}

export function AtsClient() {
  const [reports, setReports] = useState<AtsReport[]>([]);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [jobDescription, setJobDescription] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AtsAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [extractedResumeText, setExtractedResumeText] = useState<string>("");

  const loadResumeData = async () => {
    const [reportsResponse, versionsResponse] = await Promise.all([
      fetch("/api/v1/resumes/ats-reports"),
      fetch("/api/v1/resumes/versions"),
    ]);
    const [reportsPayload, versionsPayload]: [unknown, unknown] = await Promise.all([
      reportsResponse.json(),
      versionsResponse.json(),
    ]);

    if (!reportsResponse.ok) throw new Error(messageFrom(reportsPayload, "Failed to load ATS reports"));
    if (!versionsResponse.ok) throw new Error(messageFrom(versionsPayload, "Failed to load resume versions"));

    setReports(getArray(reportsPayload, "reports").filter(isAtsReport));
    setVersions(getArray(versionsPayload, "versions").filter(isResumeVersion));
    setResumes(getArray(versionsPayload, "resumes").filter(isResume));
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      void loadResumeData().catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Failed to load ATS data");
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const handleAnalyze = async () => {
    if (!selectedVersion || !jobDescription.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/resumes/analyze?resumeVersionId=${encodeURIComponent(selectedVersion)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_description: jobDescription }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isAnalysis(payload)) {
        throw new Error(messageFrom(payload, "Analysis failed"));
      }
      setAnalysisResult({
        documentQualityScore: payload.documentQualityScore,
        jobCoverageScore: payload.jobCoverageScore,
        evidenceAlignmentScore: payload.alignmentScore,
        missingKeywords: payload.missingKeywords.filter((item): item is string => typeof item === "string"),
        formattingIssues: payload.formattingIssues.filter((item): item is string => typeof item === "string"),
        suggestions: payload.suggestions.filter((item): item is string => typeof item === "string"),
        disclaimer: typeof payload.disclaimer === "string"
          ? payload.disclaimer
          : "Scores are estimates, not guarantees of employer ATS results.",
      });
      await loadResumeData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadMessage(null);
  };

  const handleUploadResume = async () => {
    if (!selectedFile) return;
    setUploadProgress(10);
    setUploadMessage(null);
    const formData = new FormData();
    formData.append("resume", selectedFile);
    try {
      const response = await fetch("/api/v1/resumes/upload", { method: "POST", body: formData });
      const payload = await response.json();
      if (!isUploadResumeResponse(payload)) throw new Error("Upload failed: invalid response");
      if (!response.ok) throw new Error(messageFrom(payload, "Upload failed"));
      setUploadProgress(100);
      setUploadMessage("Resume uploaded successfully.");
      // Use the draftId (UUID) from the upload response as the resume version ID
      const versionId = payload.draftId;
      setSelectedVersion(versionId);
      setExtractedResumeText(payload.extractedText ?? "");
      setSelectedFile(null);
    } catch (reason) {
      setUploadProgress(0);
      setUploadMessage(reason instanceof Error ? reason.message : "Upload failed");
    }
  };

  const resumeTitle = (resumeId: string) => resumes.find((resume) => resume.id === resumeId)?.title;

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="ATS Analyzer" description="Resume quality and job-alignment analysis with three separate, honest scores." actions={<Badge variant="outline">Scores</Badge>} />
      {error && <div className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="size-4 shrink-0" />{error}<button className="underline" onClick={() => setError(null)}>Dismiss</button></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="card-shadow">
          <CardHeader><CardTitle>Analyze Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><label className="mb-2 block text-xs font-medium">Job description</label><Textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} rows={6} placeholder="Paste the job description here..." /></div>
            <Button className="w-full" onClick={handleAnalyze} disabled={!selectedVersion || !jobDescription.trim() || analyzing}>{analyzing ? <><Loader2 className="size-4 animate-spin" />Analyzing…</> : <><Play className="size-4" />Run Analysis</>}</Button>
            <div className="space-y-2 border-t pt-4"><label className="block text-xs font-medium">Upload a resume</label><Input type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileChange} /><Button variant="outline" className="w-full" onClick={handleUploadResume} disabled={!selectedFile || uploadProgress > 0 && uploadProgress < 100}>Upload resume</Button>{uploadProgress > 0 && <Progress value={uploadProgress} />}{uploadMessage && <p className="text-xs text-muted-foreground">{uploadMessage}</p>}</div>
          </CardContent>
        </Card>
        <Card className="card-shadow">
          <CardHeader><CardTitle>Analysis Results</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {analysisResult ? <><div className="grid grid-cols-3 gap-3"><ScoreCard label="Document Quality" value={analysisResult.documentQualityScore} /><ScoreCard label="Job Coverage" value={analysisResult.jobCoverageScore} /><ScoreCard label="Evidence Alignment" value={analysisResult.evidenceAlignmentScore} /></div><ResultList label="Missing Keywords" items={analysisResult.missingKeywords} /><ResultList label="Formatting Issues" items={analysisResult.formattingIssues} /><ResultList label="Suggestions" items={analysisResult.suggestions} /><p className="text-xs italic text-muted-foreground">{analysisResult.disclaimer}</p></> : <div className="flex flex-col items-center py-12 text-muted-foreground"><ScanSearch className="mb-2 size-10 opacity-30" /><p>Run an analysis to see results.</p></div>}
          </CardContent>
        </Card>
      </div>
      <Card className="card-shadow"><CardHeader><CardTitle>Stored Reports ({reports.length})</CardTitle></CardHeader><CardContent className="space-y-2">{reports.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No reports yet.</p> : reports.map((report) => <StoredReportCard key={report.id} report={report} />)}</CardContent></Card>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>;
}

function ResultList({ label, items }: { label: string; items: string[] }) {
  return <div><h3 className="mb-2 text-xs font-semibold">{label}</h3>{items.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : <ul className="space-y-1 text-xs text-muted-foreground">{items.map((item) => <li key={item}>• {item}</li>)}</ul>}</div>;
}