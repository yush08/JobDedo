"use client";

import { useState, useEffect } from "react";
import { ScanSearch, Play, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Textarea, Button, Input, ProgressBar } from "@/components/ui";
import { StoredReportCard } from "@/components/ats/stored-report-card";
import { scoreCard } from "@/components/matching/score";

export function AtsClient() {
  const [reports, setReports] = useState([]);
  const [versions, setVersions] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/resume/ats-reports");
        if (res.ok && mounted) {
          const data = await res.json();
          setReports(data.data?.reports || data.reports || []);
        }
      } catch {
        if (mounted) setError("Failed to load reports");
      }
      try {
        const res = await fetch("/api/v1/resume/versions");
        if (res.ok && mounted) {
          const data = await res.json();
          const rawVersions = (data.data?.versions || data.versions || []) as any[];
          const rawResumes = (data.data?.resumes || data.resumes || []) as any[];
          setVersions(rawVersions);
          setResumes(rawResumes);
        }
      } catch {
        if (mounted) setError("Failed to load versions");
      }
    })();
    return () => { mounted = false; };
  }, [selectedVersion, jobDescription]);

  // Clear analysis result when inputs change
  useEffect(() => {
    if (!selectedVersion || !jobDescription) {
      setAnalysisResult(null);
      setError(null);
    }
  }, [selectedVersion, jobDescription]);

  // Reset upload states when version or job description changes
  useEffect(() => {
    setUploadProgress(0);
    setUploadError(null);
    setUploadSuccess(null);
  }, [selectedVersion, jobDescription]);

  const handleAnalyze = async () => {
    if (!selectedVersion || !jobDescription) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/resumes/analyze?resumeVersionId=${selectedVersion}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_description: jobDescription }),
        }
      );
      const result = await res.json();
      if (res.ok) {
        setAnalysisResult({
          documentQualityScore: result.documentQualityScore,
          jobCoverageScore: result.jobCoverageScore,
          evidenceAlignmentScore: result.evidenceAlignmentScore ?? result.alignmentScore,
          missingKeywords: result.missingKeywords || [],
          formattingIssues: result.formattingIssues || [],
          suggestions: result.suggestions || [],
          disclaimer: result.disclaimer || "Scores are estimates, not guarantees of employer ATS results.",
        });
        try {
          const reportsRes = await fetch("/api/v1/resume/ats-reports");
          if (reportsRes.ok) {
            const reportsData = await reportsRes.json();
            setReports(reportsData.data?.reports || reportsData.reports || []);
          }
        } catch {
          // Non-critical: keep existing reports list.
        }
      } else {
        setError(result.error || "Analysis failed");
        setAnalysisResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAnalysisResult(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleUploadResume = async (file: File) => {
    setUploadProgress(0);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      if (!file.type.startsWith("application/pdf") && !file.type.startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
        setUploadError("Unsupported file type. Please select a PDF or DOCX file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setUploadError("File size must be under 5 MB.");
        return;
      }

      setUploadProgress(10);
      const formData = new FormData();
      formData.append("resume", file);

      setUploadProgress(50);
      const res = await fetch("/api/v1/resumes/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      setUploadProgress(100);
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error || "Upload failed");
        return;
      }

      setUploadSuccess(`Resume uploaded successfully: ${data.resumeId}`);
      setTimeout(async () => {
        try {
          const versionsRes = await fetch("/api/v1/resume/versions", {
            credentials: "include",
          });
          if (versionsRes.ok) {
            const versionsData = await versionsRes.json();
            const rawVersions = (versionsData.data?.versions || versionsData.versions || []) as any[];
            setVersions(rawVersions);
            if (rawVersions.length > 0) {
              setSelectedVersion(rawVersions[rawVersions.length - 1].id);
            }
          }
        } catch {
          // Non-critical: keep existing versions.
        }
      }, 100);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadProgress(0);
    }
  };

  const resumeTitle = (resumeId: string | null): string | null => {
    if (!resumeId) return null;
    const resume = resumes.find((r) => r.id === resumeId);
    return resume?.title ?? null;
  };

  const versionLabel = (v: any) => {
    const title = resumeTitle(v.resume_id);
    const date = new Date(v.created_at).toLocaleDateString();
    return title
      ? `${title} — Version ${v.version_number} (${date})`
      : `Version ${v.version_number} (${date})`;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <h1 className="text-xl font-bold">ATS Analyzer</h1>

      <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
        <ScanSearch className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          <strong className="font-medium">Analyze Resume</strong>
          {" "}
          Select a resume version and provide a job description to get three
          honest scores — document quality, job coverage, and evidence-backed
          alignment.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="ml-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-xs underline text-destructive hover:text-destructive/80"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-[320px] flex flex-col gap-4">
          <Card className="card-shadow flex-1">
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Analyze Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {versions.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <p className="text-sm">No resume versions available.</p>
                  <p className="text-xs mt-1">
                    Upload a resume or create a version in Resume Studio first.
                  </p>
                </div>
              ) : (
                <>
                  <StoredReportCard
                    key={selectedVersion}
                    report={{
                      id: selectedVersion,
                      resume_version_id: selectedVersion,
                      document_quality: 0,
                      job_coverage: 0,
                      evidence_alignment: 0,
                      created_at: new Date().toISOString(),
                    }}
                  />
                  <div>
                    <label className="block text-xs font-medium mb-2">Resume Version</label>
                    <Select
                      onValueChange={(value: string | null) =>
                        setSelectedVersion(value || "")}
                      value={selectedVersion}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a resume version" />
                        <SelectContent>
                          {versions.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {versionLabel(v)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectTrigger>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-2">Job Description</label>
                    <Textarea
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      rows={6}
                      placeholder="Paste the job description here..."
                      className="w-full"
                    />
                  </div>
                  <Button
                    onClick={handleAnalyze}
                    disabled={!selectedVersion || !jobDescription || analyzing}
                    className="w-full"
                  >
                    {analyzing ? (
                      <span>
                        <Loader2 className="size-4 mr-2 animate-spin" /> Analyzing...
                      </span>
                    ) : (
                      <span>
                        <Play className="size-4 mr-2" /> Run Analysis
                      </span>
                    )}
                  </Button>
                </>
              )}
              {/* Upload Resume Section */}
              <div>
                <Button
                  variant="outline"
                  onClick={() => setShowUpload(true)}
                  className="w-full mb-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="size-4 mr-2 opacity-80"
                    viewBox="0 0 24 24"
                    stroke-width={2}
                    stroke="currentColor"
                    fill="none"
                  >
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M5 7a2 2 0 012-2h10a2 2 0 012 2v4M7 7h2m4 11h2m-4-11v2m-4 0h2" />
                  </svg>
                  Upload Resume
                </Button>
                {showUpload && (
                  <div className="mt-4">
                    <Input
                      type="file"
                      accept="application/pdf, application/msword, application/vnd.openxmlformats-officedocument.word-processingml.document"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleUploadResume(file);
                          setShowUpload(false);
                        }
                      }}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Supported: PDF, DOCX · Max 5 MB
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {analysisResult && (
            <Card className="card-shadow">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Analysis Results</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <StoredReportCard
                    key={analysisResult.documentQualityScore}
                    report={{
                      id: String(analysisResult.documentQualityScore),
                      resume_version_id: selectedVersion || "",
                      document_quality: analysisResult.documentQualityScore,
                      job_coverage: analysisResult.jobCoverageScore,
                      evidence_alignment: analysisResult.evidenceAlignmentScore,
                      created_at: new Date().toISOString(),
                    }}
                  />
                  {scoreCard(
                    "Document Quality",
                    analysisResult.documentQualityScore
                  )}
                  {scoreCard(
                    "Job Coverage",
                    analysisResult.jobCoverageScore
                  )}
                  {scoreCard(
                    "Evidence Alignment",
                    analysisResult.evidenceAlignmentScore
                  )}
                </div>
                <div className="mt-4">
                  <h3 className="text-xs font-semibold mb-2">Missing Keywords</h3>
                  <div className="flex flex-wrap gap-1">
                    {analysisResult.missingKeywords.map(
                      (kw: string, i: number) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-1 rounded border border-warning/40 bg-warning/10 text-warning"
                        >
                          {kw}
                        </span>
                      )
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <h3 className="text-xs font-semibold mb-2">Formatting Issues</h3>
                  <ul className="text-xs space-y-1 text-muted-foreground">
                    {analysisResult.formattingIssues.map(
                      (issue: string, i: number) => (
                        <li key={i}>• {issue}</li>
                      )
                    )}
                  </ul>
                </div>
                <div className="mt-4">
                  <h3 className="text-xs font-semibold mb-2">Suggestions</h3>
                  <ul className="text-xs space-y-1 text-muted-foreground">
                    {analysisResult.suggestions.map(
                      (s: string, i: number) => (
                        <li key={i}>• {s}</li>
                      )
                    )}
                  </ul>
                  <p className="mt-3 text-[10px] text-muted-foreground italic">
                    {analysisResult.disclaimer}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex-1 min-w-[320px] flex flex-col gap-4">
          <Card className="card-shadow">
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Stored Reports {reports.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              {reports.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-4 text-muted-foreground">
                  <ScanSearch className="size-12 opacity-20 mb-2" />
                  <p className="text-sm">No reports yet</p>
                  <p className="text-xs">Run an analysis above to generate your first report.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {reports.map((report) => (
                    <StoredReportCard key={report.id} report={report} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function scoreCard(label: string, value: number) {
  return (
    <div className="flex-1 text-sm">
      <div>{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}