"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Download,
  Save,
  AlertCircle,
  Loader2,
  Code,
  File,
  Plus,
  Upload,
  RotateCw,
} from "lucide-react";

import CodeMirror from "@uiw/react-codemirror";
import { basicSetup, defaultLightThemeOption as lightTheme } from "@uiw/react-codemirror";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils/format";
import type {
  ResumeProject,
  ResumeSourceVersion,
  ResumeCompilation,
} from "@/types";

/** Safe error-to-message helper. */
function errorToMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const maybe = err as Record<string, unknown>;
    if (typeof maybe.message === "string") return maybe.message;
    if (typeof maybe.code === "string") return maybe.code;
    return String(err);
  }
  return String(err);
}

interface WorkspaceProps {
  projectId?: string;
}

const STARTER_LATEX = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage[margin=1in]{geometry}
\\usepackage{xcolor}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage{hyperref}
\\hypersetup{colorlinks=true, linkcolor=blue, urlcolor=blue}
\\definecolor{headingcolor}{RGB}{0,51,102}
\\definecolor{subheadingcolor}{RGB}{70,130,180}
\\titleformat{\\section}{\\color{headingcolor}\\Large\\bfseries}{\\thesection}{1em}{}
\\titleformat{\\subsection}{\\color{subheadingcolor}\\large\\bfseries}{\\thesubsection}{1em}{}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{6pt}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
{\\Huge\\bfseries\\color{headingcolor} Your Name}\\\\
your.email@example.com \\textbullet{} (555) 123-4567 \\textbullet{} City, State
\\end{center}

\\vspace{0.5cm}
\\hrule
\\vspace{0.3cm}

\\section*{Professional Summary}
A brief summary of your professional background and career objectives.

\\section*{Education}
\\textbf{Degree Name}\\\\
Institution Name, Graduation Date

\\section*{Experience}
\\textbf{Job Title} \\hfill Start Date -- End Date\\
Company Name, Location\\
Job description and key achievements.

\\section*{Skills}
\\textbf{Technical Skills:} Skill 1, Skill 2, Skill 3

\\end{document}`;

export function ResumeWorkspace({ projectId }: WorkspaceProps = {}) {
  const [projects, setProjects] = useState<ResumeProject[]>([]);
  const [currentProject, setCurrentProject] = useState<ResumeProject | null>(
    null,
  );
  const [versions, setVersions] = useState<ResumeSourceVersion[]>([]);
  const [compilations, setCompilations] = useState<ResumeCompilation[]>([]);
  const [currentVersion, setCurrentVersion] = useState<
    ResumeSourceVersion | null
  >(null);
  const [latexSource, setLatexSource] = useState("");
  const [initialLatexSource, setInitialLatexSource] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<{
    status: "success" | "failed";
    log: string;
    warnings: string[];
    errors: string[];
    pdfUrl: string | null;
    compilationId: string | null;
    durationMs: number;
  } | null>(null);
  const [lastSuccessfulPdfUrl, setLastSuccessfulPdfUrl] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const router = useRouter();

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/resumes/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.data?.projects || data.projects || []);
      }
    } catch {
      setError("Failed to load projects");
    }
  }, []);

  // Persist which version is active so a page refresh restores the same state.
  const persistActiveVersion = useCallback(async (pid: string, vid: string) => {
    try {
      const res = await fetch(`/api/v1/resumes/projects/[id]?id=${pid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_version_id: vid }),
      });
      if (res.ok) {
        const data = await res.json();
        const p = data.data?.project || data.project;
        if (p) setCurrentProject(p);
      }
    } catch {
      // Non-critical: the active version is re-derived from latest on load.
    }
  }, []);

  const loadCompilations = useCallback(
    async (pid: string) => {
      try {
        const res = await fetch(
          `/api/v1/resumes/compilations?projectId=${pid}`,
        );
        if (res.ok) {
          const data = await res.json();
          const comps = (data.data?.compilations || data.compilations || []) as ResumeCompilation[];
          setCompilations(comps);
          // Find the last successful compilation
          const lastSuccess = comps
            .filter((c: ResumeCompilation) => c.status === "success")
            .sort(
              (a: ResumeCompilation, b: ResumeCompilation) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            )[0];
          if (lastSuccess?.pdf_artifact_id) {
            setLastSuccessfulPdfUrl(
              `/api/v1/resumes/artifacts/[id]?id=${lastSuccess.pdf_artifact_id}`,
            );
          }
        }
      } catch {
        setError("Failed to load compilations");
      }
    },
    [],
  );

  useEffect(() => {
    (async () => {
      await loadProjects();
    })();
  }, [loadProjects]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const versionsRes = await fetch(
          `/api/v1/resumes/projects/${projectId}/versions?projectId=${projectId}`,
        );
        const vs: ResumeSourceVersion[] = versionsRes.ok
          ? ((await versionsRes.json()).data?.versions || [])
          : [];
        if (cancelled) return;
        setVersions(vs);

        await loadCompilations(projectId);
        if (cancelled) return;

        const res = await fetch(
          `/api/v1/resumes/projects/[id]?id=${projectId}`,
        );
        const data = await res.json();
        const p = data.data?.project || data.project;
        if (cancelled || !p) return;
        setCurrentProject(p);
        // Resolve the active version from the freshly loaded list
        if (p.active_version_id) {
          const active = vs.find((v) => v.id === p.active_version_id);
          if (active) {
            setCurrentVersion(active);
            setLatexSource(active.latex_source);
            setInitialLatexSource(active.latex_source);
            setIsDirty(false);
          }
        } else if (vs.length > 0) {
          // Fall back to the latest version
          const latest = vs[0];
          setCurrentVersion(latest);
          setLatexSource(latest.latex_source);
          setInitialLatexSource(latest.latex_source);
          setIsDirty(false);
        }
      } catch {
        if (!cancelled) setError("Failed to load project");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, loadCompilations]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      setError("Project name is required");
      return;
    }
    setShowNewProjectDialog(false);
    try {
      const res = await fetch("/api/v1/resumes/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim(), template_id: "minimal" }),
      });
      const data = await res.json();
      if (res.ok) {
        const p = data.data?.project || data.project;
        setNewProjectName("");
        setCurrentProject(p);
        setProjects([p, ...projects]);
        setCurrentVersion(null);
        setLatexSource(STARTER_LATEX);
        setInitialLatexSource(STARTER_LATEX);
        setIsDirty(false);
        setCompileResult(null);
        setLastSuccessfulPdfUrl(null);
        // Create an initial source version with the starter template
        try {
          const versionRes = await fetch(
            `/api/v1/resumes/projects/${p.id}/versions?projectId=${p.id}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                latex_source: STARTER_LATEX,
                structured_content: null,
                template_id: p.template_id,
              }),
            },
          );
          if (versionRes.ok) {
            const versionData = await versionRes.json();
            const v = versionData.data?.version || versionData.version;
            setCurrentVersion(v);
            setVersions((prev) => [v, ...prev]);
            setIsDirty(false);
            persistActiveVersion(p.id, v.id);
          }
        } catch {
          // Version creation is non-critical; user can create manually
        }
      } else {
        setError(errorToMessage(data.error || "Failed to create project"));
      }
    } catch (err) {
      setError(errorToMessage(err));
    }
  };

  const handleCreateVersion = async () => {
    if (!currentProject) return;
    if (!latexSource.trim()) {
      setError("Cannot create version with empty LaTeX source");
      return;
    }
    try {
      const res = await fetch(
        `/api/v1/resumes/projects/${currentProject!.id}/versions?projectId=${currentProject!.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latex_source: latexSource,
            structured_content: null,
            template_id: currentProject.template_id,
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        const v = data.data?.version || data.version;
        setCurrentVersion(v);
        setVersions((prev) => [v, ...prev]);
        setInitialLatexSource(latexSource);
        setIsDirty(false);
        setCompileResult(null);
        persistActiveVersion(currentProject.id, v.id);
      } else {
        setError(errorToMessage(data.error || "Failed to create version"));
      }
    } catch (err) {
      setError(errorToMessage(err));
    }
  };

  const handleSave = async () => {
    if (!currentVersion) {
      setError("No version selected to save to");
      return;
    }
    try {
      const res = await fetch(
        `/api/v1/resumes/projects/${currentProject!.id}/versions/${currentVersion.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latex_source: latexSource,
            structured_content: null,
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        setInitialLatexSource(latexSource);
        setIsDirty(false);
        setError(null);
        persistActiveVersion(currentProject!.id, currentVersion.id);
      } else {
        setError(errorToMessage(data.error || "Failed to save"));
      }
    } catch (err) {
      setError(errorToMessage(err));
    }
  };

  const handleCompile = async () => {
    if (!currentProject) return;
    setCompiling(true);
    setCompileResult(null);
    setError(null);
    try {
      // Never compile stale source: persist the editor content first.
      let versionId = currentVersion?.id ?? null;
      if (!versionId) {
        // No version yet — create one from the current editor content.
        const createRes = await fetch(
          `/api/v1/resumes/projects/${currentProject.id}/versions?projectId=${currentProject.id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latex_source: latexSource,
              structured_content: null,
              template_id: currentProject.template_id,
            }),
          },
        );
        const createData = await createRes.json();
        if (!createRes.ok) {
          setError(errorToMessage(createData.error || "Failed to create version before compiling"));
          setCompiling(false);
          return;
        }
        const v = createData.data?.version || createData.version;
        setCurrentVersion(v);
        setVersions((prev) => [v, ...prev]);
        setInitialLatexSource(latexSource);
        setIsDirty(false);
        versionId = v.id;
      } else if (isDirty) {
        // Editor has unsaved changes — save them so the compiled source matches.
        const saveRes = await fetch(
          `/api/v1/resumes/projects/${currentProject.id}/versions/${versionId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latex_source: latexSource, structured_content: null }),
          },
        );
        const saveData = await saveRes.json();
        if (!saveRes.ok) {
          setError(errorToMessage(saveData.error || "Failed to save before compiling"));
          setCompiling(false);
          return;
        }
        setInitialLatexSource(latexSource);
        setIsDirty(false);
      }

      const res = await fetch("/api/v1/resumes/compilations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: currentProject.id,
          source_version_id: versionId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(errorToMessage(data.error || "Compilation request failed"));
        setCompiling(false);
        return;
      }

      const d = data.data || data;
      const comp = d.compilation;
      const pdfUrl = comp.pdf_artifact_id
        ? `/api/v1/resumes/artifacts/[id]?id=${comp.pdf_artifact_id}`
        : null;

      setCompileResult({
        status: comp.status,
        log: d.log || comp.log || "",
        warnings: d.warnings || [],
        errors: d.errors || [],
        pdfUrl: comp.status === "success" ? pdfUrl : null,
        compilationId: comp.id,
        durationMs: d.durationMs || 0,
      });

      if (comp.status === "success" && pdfUrl) {
        setLastSuccessfulPdfUrl(pdfUrl);
      }

      setCompiling(false);
      loadCompilations(currentProject.id);
    } catch (err) {
      setError(errorToMessage(err));
      setCompiling(false);
    }
  };

  const handleDownloadPdf = async () => {
    const pdfUrl =
      (compileResult?.status === "success" && compileResult.pdfUrl) ||
      lastSuccessfulPdfUrl;
    if (!pdfUrl) return;
    try {
      const res = await fetch(pdfUrl);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${currentProject?.name || "resume"}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        setError("Failed to download PDF");
      }
    } catch {
      setError("Failed to download PDF");
    }
  };

  const handleSourceChange = (value: string) => {
    setLatexSource(value);
    setIsDirty(value !== initialLatexSource);
  };

  const handleSelectVersion = (v: ResumeSourceVersion) => {
    setCurrentVersion(v);
    setLatexSource(v.latex_source);
    setInitialLatexSource(v.latex_source);
    setCompileResult(null);
    setIsDirty(false);
    setError(null);
    if (currentProject) persistActiveVersion(currentProject.id, v.id);
  };

  const handleRestoreVersion = async (v: ResumeSourceVersion) => {
    if (!currentProject) return;
    if (window.confirm(`Restore version ${v.version_number} as the active source?`)) {
      setLatexSource(v.latex_source);
      setInitialLatexSource(v.latex_source);
      setIsDirty(false);
      setCurrentVersion(v);
      setError(null);
      persistActiveVersion(currentProject.id, v.id);
    }
  };

  const handleDeleteVersion = async (v: ResumeSourceVersion) => {
    if (versions.length <= 1) {
      setError("Cannot delete the only version");
      return;
    }
    if (!currentProject) return;
    if (!window.confirm(`Delete version ${v.version_number}? This cannot be undone.`)) return;
    try {
      const res = await fetch(
        `/api/v1/resumes/projects/${currentProject.id}/versions/${v.id}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(errorToMessage(data.error || "Failed to delete version"));
        return;
      }
      const remaining = versions.filter((x) => x.id !== v.id);
      setVersions(remaining);
      if (data.data?.project) setCurrentProject(data.data.project);
      if (currentVersion?.id === v.id) {
        const next = remaining[0];
        if (next) {
          setCurrentVersion(next);
          setLatexSource(next.latex_source);
          setInitialLatexSource(next.latex_source);
        } else {
          setCurrentVersion(null);
          setCompileResult(null);
        }
        setIsDirty(false);
      }
    } catch (err) {
      setError(errorToMessage(err));
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!validTypes.includes(file.type)) {
      setUploadError("Unsupported file type. Please upload a PDF or DOCX file.");
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError("File size must be under 5 MB.");
      return;
    }

    setUploadError(null);
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
        setUploadError(errorToMessage(result.error || "Upload failed. Please try again."));
        setUploading(false);
        return;
      }

      setUploading(false);

      // Navigate to the newly created project
      const projectId = result.resumeProjectId;
      if (projectId) {
        router.push(`/resume?projectId=${projectId}`);
      } else {
        setError("Upload succeeded but no project ID returned");
      }
    } catch (err) {
      setError(errorToMessage(err));
      setUploading(false);
    }
  };

  const isProjectSelected = !!currentProject;
  const hasVersion = !!currentVersion;
  const hasUnsavedChanges = isDirty;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Error banner */}
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

      {uploadError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="ml-1">{uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            className="ml-2 text-xs underline text-destructive hover:text-destructive/80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* New project dialog */}
      {showNewProjectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowNewProjectDialog(false)} />
          <Card className="w-full max-w-sm p-6">
            <CardHeader>
              <CardTitle>New Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name (e.g. Senior Engineer Resume)"
              />
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowNewProjectDialog(false);
                  setNewProjectName("");
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateProject} disabled={!newProjectName.trim()}>
                Create Project
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Top toolbar */}
      <Card className="card-shadow">
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-3">
          <div className="flex items-center gap-3">
            <Code className="size-5 text-primary" aria-hidden />
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold">
                {currentProject?.name || "Untitled Resume"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!currentProject && (
              <>
                <Button
                  onClick={() => {
                    const input = document.getElementById(
                      "file-upload-input",
                    ) as HTMLInputElement;
                    input?.click();
                  }}
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="size-4 mr-2" />
                  )}
                  {uploading ? "Uploading…" : "Upload Resume"}
                </Button>
                <Button
                  onClick={() => setShowNewProjectDialog(true)}
                  variant="outline"
                  size="sm"
                >
                  <Plus className="size-4 mr-2" />
                  New Project
                </Button>
                <input
                  id="file-upload-input"
                  type="file"
                  accept=".pdf, .docx"
                  onChange={handleUpload}
                  className="hidden"
                />
              </>
            )}
            {currentProject && (
              <>
                <Button
                  onClick={() => setShowNewProjectDialog(true)}
                  variant="outline"
                  size="sm"
                  disabled={showNewProjectDialog}
                >
                  <Plus className="size-4 mr-2" />
                  New Project
                </Button>
                <Button
                  onClick={handleCreateVersion}
                  variant="outline"
                  size="sm"
                  disabled={!isProjectSelected || !latexSource.trim()}
                >
                  <Save className="size-4 mr-2" />
                  Save Version
                </Button>
                <Button
                  onClick={handleSave}
                  variant="outline"
                  size="sm"
                  disabled={!hasVersion || !hasUnsavedChanges}
                >
                  <Save className="size-4 mr-2" />
                  Save
                </Button>
                <Button
                  onClick={handleCompile}
                  variant="default"
                  size="sm"
                  disabled={!latexSource.trim() || compiling}
                >
                  {compiling ? (
                    <span>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Compiling
                    </span>
                  ) : (
                    <span>
                      <Play className="size-4 mr-2" />
                      Compile
                    </span>
                  )}
                </Button>
                {(compileResult?.status === "success" && compileResult.pdfUrl) || lastSuccessfulPdfUrl ? (
                  <Button
                    onClick={handleDownloadPdf}
                    variant="outline"
                    size="sm"
                  >
                    <Download className="size-4 mr-2" />
                    Download PDF
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Main workspace - split pane */}
      {currentProject ? (
        <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-[calc(100vh-240px)]">
          {/* Left pane: LaTeX Editor */}
          <div className="flex-1 min-w-0 flex flex-col">
            <Card className="card-shadow flex-1">
              <CardHeader className="flex items-center justify-between pb-2">
                <span className="text-sm font-semibold">LaTeX Source</span>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={isDirty ? "destructive" : "secondary"}
                    className="text-[10px] px-2 py-1"
                  >
                    {isDirty ? "Modified" : "Saved"}
                  </Badge>
                  <div className="flex items-center gap-1">
                    {compileResult?.status === "failed" && (
                      <Badge variant="outline" className="text-[10px] px-2 py-1 text-destructive">
                        Source ahead of last compile
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (currentProject) {
                          handleCreateVersion();
                        }
                      }}
                      disabled={!isDirty || !currentProject}
                    >
                      <Save className="size-3 mr-1" />
                      Save Version
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                <div className="h-full w-full min-h-0">
                  <ScrollArea className="h-full w-full">
                    <CodeMirror
                      value={latexSource}
                      onChange={(value: string | undefined | null) => handleSourceChange(value || "")}
                      extensions={[basicSetup(), lightTheme]}
                      minHeight="auto"
                      maxHeight="auto"
                      className="h-full w-full text-sm font-mono leading-relaxed"
                    />
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator orientation="vertical" className="hidden lg:block" />

          {/* Right pane: PDF Preview */}
          <div className="flex-1 min-w-0 flex flex-col">
            <Card className="card-shadow flex-1">
              <CardHeader className="flex items-center justify-between pb-2">
                <span className="text-sm font-semibold">PDF Preview</span>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      compileResult?.status === "success"
                        ? "secondary"
                        : compileResult?.status === "failed"
                          ? "destructive"
                          : "outline"
                    }
                    className="text-[10px] px-2 py-1"
                  >
                    {compileResult?.status === "success"
                      ? "Ready"
                      : compileResult?.status === "failed"
                        ? "Failed"
                        : compiling
                          ? "Compiling..."
                          : "Not compiled"}
                  </Badge>
                  {compileResult?.status === "failed" && lastSuccessfulPdfUrl && (
                    <Badge variant="outline" className="text-[10px] px-2 py-1 text-muted-foreground">
                      Last success available
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                <div className="h-full w-full min-h-0 flex flex-col">
                  {compileResult?.status === "failed" && (
                    <div className="p-4 bg-destructive/5 text-destructive rounded-lg border border-destructive/20 flex-shrink-0">
                      <div className="flex items-start gap-2 mb-2">
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        <span className="text-sm font-medium">Compilation Failed</span>
                      </div>
                      {compileResult.errors.length > 0 && (
                        <div className="overflow-auto max-h-48 text-xs text-destructive/90 font-mono">
                          {compileResult.errors.map((e, i) => (
                            <div key={i} className="mb-1 whitespace-pre-wrap break-words">{e}</div>
                          ))}
                        </div>
                      )}
                      {compileResult.log && !compileResult.errors.includes(compileResult.log) && (
                        <div className="mt-2 overflow-auto max-h-32 text-xs font-mono text-muted-foreground">
                          {compileResult.log}
                        </div>
                      )}
                      {lastSuccessfulPdfUrl && (
                        <div className="mt-3 pt-3 border-t border-destructive/30">
                          <p className="text-xs font-semibold text-destructive mb-1">Previous successful PDF still available:</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownloadPdf}
                            className="w-full text-left"
                          >
                            <Download className="size-3 mr-2" />
                            Download Last Successful PDF
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {(compileResult?.status === "success" && compileResult.pdfUrl) || lastSuccessfulPdfUrl ? (
                    <div className="flex-1 h-full w-full overflow-auto bg-white/50 flex items-center justify-center p-4">
                      <iframe
                        src={
                          (compileResult?.status === "success" && compileResult.pdfUrl) ||
                          lastSuccessfulPdfUrl!
                        }
                        className="w-full h-full max-h-[calc(100vh-320px)]"
                        title="PDF Preview"
                      />
                    </div>
                  ) : (
                    <div className="flex-1 h-full w-full flex flex-col items-center justify-center text-muted-foreground">
                      <File className="size-32 opacity-20" />
                      <p className="mt-2 text-sm">No PDF compiled yet</p>
                      <p className="text-xs">Click &quot;Compile&quot; to generate a PDF from your LaTeX source.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted-foreground">
          <File className="size-32 opacity-20" />
          <p className="mt-4 text-lg font-medium">No project selected</p>
          <p className="text-sm">Upload a resume or create a new project to get started.</p>
          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={() => {
                const input = document.getElementById(
                  "file-upload-input-empty",
                ) as HTMLInputElement;
                input?.click();
              }}
              variant="outline"
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Upload className="size-4 mr-2" />
              )}
              {uploading ? "Uploading…" : "Upload Resume"}
            </Button>
            <Button
              onClick={() => setShowNewProjectDialog(true)}
              variant="outline"
            >
              <Plus className="size-4 mr-2" />
              New Project
            </Button>
            <input
              id="file-upload-input-empty"
              type="file"
              accept=".pdf, .docx"
              onChange={handleUpload}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* Versions panel */}
      {versions.length > 0 && (
        <Card className="card-shadow">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Version History ({versions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {versions.map((v) => (
                <Card
                  key={v.id}
                  className="p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleSelectVersion(v)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        Version {v.version_number}
                      </span>
                      <Badge
                        variant={currentVersion?.id === v.id ? "secondary" : "outline"}
                        className="text-[10px] px-2"
                      >
                        {currentVersion?.id === v.id ? "Active" : ""}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestoreVersion(v);
                      }}
                    >
                      <RotateCw className="size-3" /> Restore
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {v.latex_source.slice(0, 80)}...
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(v.created_at)}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteVersion(v);
                    }}
                    className="text-xs text-destructive hover:text-destructive/80 underline mt-1"
                  >
                    Delete
                  </button>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compilations panel */}
      {compilations.length > 0 && (
        <Card className="card-shadow">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Compilation History ({compilations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {compilations.map((c) => (
                <Card key={c.id} className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        Compilation {c.id.slice(0, 8)}
                      </span>
                      <Badge
                        variant={
                          c.status === "success"
                            ? "secondary"
                            : c.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                        className="text-[10px] px-2"
                      >
                        {c.status}
                      </Badge>
                    </div>
                    {c.pdf_artifact_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const url = `/api/v1/resumes/artifacts/[id]?id=${c.pdf_artifact_id}`;
                          window.open(url, "_blank");
                        }}
                      >
                        <Download className="size-3" /> View PDF
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {c.log.slice(0, 100)}...
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(c.created_at)}
                  </p>
                  {c.warnings.length > 0 && (
                    <p className="text-[10px] text-warning mt-1">
                      ⚠ {c.warnings.length} warning(s)
                    </p>
                  )}
                  {c.errors.length > 0 && (
                    <p className="text-[10px] text-destructive mt-1">
                      ✗ {c.errors.length} error(s)
                    </p>
                  )}
                  {c.durationMs !== undefined && c.durationMs > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {c.durationMs}ms
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
