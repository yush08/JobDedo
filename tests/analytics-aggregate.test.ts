import { describe, expect, it } from "vitest";

import { aggregateAnalytics, type AnalyticsInput } from "@/features/analytics/aggregate";
import type { Application, JobSource, JobWithRelations } from "@/types";
import {
  DAY,
  isoAt,
  makeApplication,
  makeJobWithRelations,
  makeNotification,
} from "./helpers";

/**
 * Analytics must reflect rows that actually exist. Sample data is disclosed
 * separately and never counted as real activity (spec §17).
 */

const source: JobSource = {
  id: "00000000-0000-4000-8000-0000000000s1",
  key: "example_board",
  name: "Example Board",
  base_url: "https://jobs.example.com",
  kind: "job_board",
  enabled: false,
  last_run_at: null,
  last_status: "not_run",
  last_message: "",
};

function realJobs(): JobWithRelations[] {
  const a = makeJobWithRelations(
    {
      id: "real-a",
      title: "Data Analyst Intern",
      role_tags: ["Data Analyst"],
      employment_type: "internship",
      is_sample: false,
      verification_status: "VERIFIED",
      first_discovered_at: new Date(Date.now() - 2 * DAY).toISOString(),
    },
    { source, saved: true, match_score: 82 },
  );
  const b = makeJobWithRelations(
    {
      id: "real-b",
      title: "Data Scientist",
      role_tags: ["Data Scientist"],
      employment_type: "full_time",
      is_sample: false,
      verification_status: "UNVERIFIED",
      first_discovered_at: new Date(Date.now() - 40 * DAY).toISOString(), // outside the 30-day window
    },
    { source: null, saved: false, match_score: 40 },
  );
  return [a, b];
}

function sampleJobs(): JobWithRelations[] {
  const sample = (
    id: string,
    role_tags: string[],
    employment_type: "internship" | "full_time",
    match_score: number,
    daysAgo: number,
  ): JobWithRelations =>
    makeJobWithRelations(
      {
        id,
        role_tags,
        employment_type,
        is_sample: true,
        verification_status: "UNVERIFIED",
        first_discovered_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
      },
      { source: null, saved: false, match_score },
    );

  return [
    sample("sample-1", ["Data Analyst"], "internship", 99, 1),
    sample("sample-2", ["Data Analyst"], "internship", 90, 3),
    sample("sample-3", ["Data Scientist"], "internship", 76, 4),
  ];
}

function input(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    jobs: [...realJobs(), ...sampleJobs()],
    applications: [],
    resumeVersions: [],
    recruiters: [],
    notifications: [],
    includeSample: true,
    ...overrides,
  };
}

const sum = (rows: { count: number }[]) => rows.reduce((acc, r) => acc + r.count, 0);

describe("aggregateAnalytics — sample disclosure", () => {
  it("counts sample and real jobs separately when sample rows are visible", () => {
    const s = aggregateAnalytics(input({ includeSample: true }));
    expect(s.totals.jobs_discovered).toBe(5);
    expect(s.totals.sample_jobs).toBe(3);
    expect(s.totals.real_jobs).toBe(2);
  });

  it("keeps real_jobs non-negative when sample rows are hidden", () => {
    const s = aggregateAnalytics(input({ includeSample: false }));
    expect(s.totals.jobs_discovered).toBe(2); // only real rows are in view
    expect(s.totals.sample_jobs).toBe(3); // disclosure metric still reports them
    expect(s.totals.real_jobs).toBe(2); // regression: used to compute 2 - 3 = -1
    expect(s.totals.real_jobs).toBeGreaterThanOrEqual(0);
    expect(s.totals.real_jobs + s.totals.sample_jobs).toBe(5);
  });

  it("never lets hidden sample rows inflate activity metrics", () => {
    const hidden = aggregateAnalytics(input({ includeSample: false }));
    const shown = aggregateAnalytics(input({ includeSample: true }));

    // Sample jobs all score >= 75, so only the one real strong match counts.
    expect(hidden.totals.strong_matches).toBe(1);
    expect(shown.totals.strong_matches).toBe(4);

    expect(hidden.totals.verified).toBe(1);
    expect(hidden.totals.saved).toBe(1);

    expect(sum(hidden.by_role)).toBe(2);
    expect(sum(shown.by_role)).toBe(5);
    expect(sum(hidden.verification_distribution)).toBe(2);
    expect(sum(shown.verification_distribution)).toBe(5);
  });

  it("labels hidden sample rows as sample data in the source breakdown", () => {
    const s = aggregateAnalytics(input({ includeSample: true }));
    expect(s.by_source).toContainEqual({ label: "Sample data", count: 3 });
    expect(s.by_source).toContainEqual({ label: "Example Board", count: 1 });
  });

  it("groups roles, locations and employment types from real rows only", () => {
    const s = aggregateAnalytics(input({ includeSample: false }));
    expect(s.by_role).toEqual(
      expect.arrayContaining([
        { label: "Data Analyst", count: 1 },
        { label: "Data Scientist", count: 1 },
      ]),
    );
    expect(sum(s.by_location)).toBe(2);
    expect(sum(s.by_employment)).toBe(2);
    expect(s.by_employment).toContainEqual({ label: "full_time", count: 1 });
  });
});

describe("aggregateAnalytics — jobs over time", () => {
  it("emits one bucket per day for the last 30 days (31 points incl. today)", () => {
    const s = aggregateAnalytics(input());
    expect(s.jobs_over_time).toHaveLength(31);
    expect(s.jobs_over_time[0]!.date).toBe(
      new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10),
    );
    expect(s.jobs_over_time[30]!.date).toBe(new Date(Date.now()).toISOString().slice(0, 10));
  });

  it("only buckets jobs discovered inside the window, without dropping them from totals", () => {
    const s = aggregateAnalytics(input({ includeSample: false }));
    // real-a (2 days ago) + sample rows excluded; real-b (40 days ago) is out of window.
    expect(s.jobs_over_time.reduce((acc, d) => acc + d.count, 0)).toBe(1);
    expect(s.totals.jobs_discovered).toBe(2);
  });

  it("tolerates rows with an unparseable discovery date", () => {
    const broken = makeJobWithRelations({
      id: "broken",
      is_sample: false,
      first_discovered_at: "not-a-date",
    });
    const s = aggregateAnalytics(input({ jobs: [broken], includeSample: false }));
    expect(s.totals.jobs_discovered).toBe(1);
    expect(s.jobs_over_time.reduce((acc, d) => acc + d.count, 0)).toBe(0);
  });
});

describe("aggregateAnalytics — application outcomes", () => {
  const pipelineApps = (): Application[] => [
    makeApplication({ stage: "applied", applied_at: isoAt(-6 * DAY) }),
    makeApplication({ stage: "interview", applied_at: isoAt(-5 * DAY) }),
    makeApplication({ stage: "offer", applied_at: isoAt(-4 * DAY) }),
    makeApplication({ stage: "rejected", applied_at: isoAt(-3 * DAY) }),
    makeApplication({ stage: "withdrawn", applied_at: isoAt(-2 * DAY) }),
    makeApplication({ stage: "discovered", applied_at: null }), // never applied
  ];

  it("counts stages, outcomes and conversions from real rows only", () => {
    const s = aggregateAnalytics(input({ applications: pipelineApps() }));

    expect(s.totals.applications_submitted).toBe(5);
    expect(s.outcomes).toEqual({
      applied: 5,
      interview: 2, // interview + offer
      offer: 1,
      rejected: 1,
      withdrawn: 1,
    });
    expect(s.totals.interviews).toBe(2);
    expect(s.totals.offers).toBe(1);
    expect(s.totals.rejections).toBe(1);
    expect(s.interview_conversion).toBe(40); // 2 / 5
    expect(s.offer_conversion).toBe(20); // 1 / 5
    expect(sum(s.applications_by_stage)).toBe(6);
    expect(s.applications_by_stage).toContainEqual({ label: "discovered", count: 1 });
  });

  it("treats an applied_at timestamp as applied even for early stages", () => {
    const s = aggregateAnalytics(
      input({ applications: [makeApplication({ stage: "shortlisted", applied_at: isoAt() })] }),
    );
    expect(s.totals.applications_submitted).toBe(1);
  });

  it("returns zeroed conversions when nothing has been applied", () => {
    const s = aggregateAnalytics(input({ applications: [] }));
    expect(s.interview_conversion).toBe(0);
    expect(s.offer_conversion).toBe(0);
    expect(s.totals.applications_submitted).toBe(0);
  });

  it("counts follow-ups due within 7 days, skipping terminal stages", () => {
    const in2Days = new Date(Date.now() + 2 * DAY).toISOString();
    const in30Days = new Date(Date.now() + 30 * DAY).toISOString();
    const apps = [
      makeApplication({ stage: "discovered", follow_up_at: in2Days }),
      makeApplication({ stage: "shortlisted", follow_up_at: in30Days }), // too far out
      makeApplication({ stage: "offer", follow_up_at: in2Days }), // terminal stage
      makeApplication({ stage: "rejected", follow_up_at: in2Days }), // terminal stage
    ];
    const s = aggregateAnalytics(input({ applications: apps }));
    expect(s.totals.follow_ups_due).toBe(1);
  });
});

describe("aggregateAnalytics — notifications and empty datasets", () => {
  it("counts only unread notifications", () => {
    const s = aggregateAnalytics(
      input({
        notifications: [
          makeNotification(),
          makeNotification(),
          makeNotification({ read_at: isoAt() }),
        ],
      }),
    );
    expect(s.totals.unread_notifications).toBe(2);
  });

  it("produces a fully zeroed summary for an empty dataset", () => {
    const s = aggregateAnalytics(
      input({
        jobs: [],
        applications: [],
        notifications: [],
        includeSample: false,
      }),
    );
    expect(s.totals).toMatchObject({
      jobs_discovered: 0,
      sample_jobs: 0,
      real_jobs: 0,
      strong_matches: 0,
      verified: 0,
      saved: 0,
      applications_submitted: 0,
      interviews: 0,
      offers: 0,
      unread_notifications: 0,
    });
    expect(s.by_role).toEqual([]);
    expect(s.by_source).toEqual([]);
    expect(s.verification_distribution).toEqual([]);
    expect(s.interview_conversion).toBe(0);
  });
});
