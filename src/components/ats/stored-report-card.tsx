import { ReactNode } from "react";

interface StoredReportCardProps {
  report: {
    id: string;
    resume_version_id: string;
    document_quality: number;
    job_coverage: number;
    evidence_alignment: number;
    created_at: string;
  };
}

export function StoredReportCard({ report }: StoredReportCardProps): ReactNode {
  return (
    <div key={report.id} className="p-3 rounded-lg border bg-card/50">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{report.id}</p>
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
}