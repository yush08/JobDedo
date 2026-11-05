"use client";

import { useState, useEffect } from "react";
import { ScanSearch, Play, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Textarea, Button, Input, ProgressBar } from "@/components/ui";

export function ATSClient() {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [reports, setReports] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState<string | null>(null);

  // Mock data and handlers
  const handleUploadResume = (file: File) => { };
  const resumeTitle = (resumeId: string) => { return "Resume"; };
  const versionLabel = (id: string) => { return "Version " + id; };
  const handleAnalyze = () => { setAnalyzing(true); setTimeout(() => setAnalyzing(false), 1000); };

  useEffect(() => {
    if (!selectedVersion || !jobDescription) {
      setAnalysisResult(null);
      setError(null);
    }
  }, [selectedVersion, jobDescription]);

  useEffect(() => {
    // Reset upload states when version or job description changes
    setUploadProgress(0);
    setUploadError(null);
    setUploadSuccess(null);
  }, [selectedVersion, jobDescription]);

  return (
    <div className="space-y-6">
      {/* Card 1: Analyze Configuration */}
      <Card className="card-shadow flex-1">
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Analyze Configuration</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {versions.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              <p className="text-sm">No resume versions available.</p>
              <p className="text-xs mt-1">Upload a resume or create a version in Resume Studio first.</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium mb-2">Resume Version</label>
                <Select
                  onValueChange={(value: string | null) => setSelectedVersion(value || "")}
                  value={selectedVersion}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a resume version" />
                    <SelectContent>
                      {versions.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {versionLabel(v.id)}
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

      {/* Card 2: Analysis Results */}
      <Card className="card-shadow">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Analysis Results</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Document Quality</span>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground">Score</span>
                    <span className="font-semibold">{analysisResult?.documentQualityScore || 0}</span>
                  </div>
                </div>
                <ProgressBar value={analysisResult?.documentQualityScore} />
              </div>
            </div>
            <div className="flex-1">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Job Coverage</span>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground">Score</span>
                    <span className="font-semibold">{analysisResult?.jobCoverageScore || 0}</span>
                  </div>
                </div>
                <ProgressBar value={analysisResult?.jobCoverageScore} />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold mb-2">Missing Keywords</h3>
            <div className="flex flex-wrap gap-1">
              {analysisResult?.missingKeywords.map((kw: string, i: number) => (
                <span key={i} className="text-[10px] px-2 py-1 rounded border border-warning/40 bg-warning/10 text-warning">
                  {kw}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold mb-2">Formatting Issues</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              {analysisResult?.formattingIssues.map((issue: string, i: number) => (
                <li key={i}>• {issue}</li>
              ))}
            </ul>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold mb-2">Suggestions</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              {analysisResult?.suggestions.map((s: string, i: number) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground italic">
            {analysisResult?.disclaimer}
          </p>
        </CardContent>
      </Card>

      {/* Card 3: Stored Reports */}
      <Card className="card-shadow">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Stored Reports {reports.length}</CardTitle>
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
              {reports.map((report) => {
                const version = versions.find((v) => v.id === report.resume_version_id);
                const title = version ? resumeTitle(version.resume_id) : null;
                const reportLabel = version
                  ? title
                    ? `${title} — Version ${version.version_number}`
                    : `Version ${version.version_number}`
                  : `Version ${report.resume_version_id.slice(0, 8)}`;
                return (
                  <div
                    key={report.id}
                    className="p-3 rounded-lg border bg-card/50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{reportLabel}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(report.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2 text-xs tabular-nums">
                        <div className="text-right">
                          <span className="block text-[10px] text-muted-foreground">Document</span>
                          <span className="block font-semibold">{report.document_quality}</span>
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] text-muted-foreground">Coverage</span>
                          <span className="block font-semibold">{report.job_coverage}</span>
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] text-muted-foreground">Evidence</span>
                          <span className="block font-semibold">{report.evidence_alignment}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 bg-muted/20 rounded-full overflow-hidden">
      <div
        className="h-full bg-primary"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}