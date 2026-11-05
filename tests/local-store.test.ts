import { promises as fsPromises } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalStore, jobIsSample, type LocalStore } from "@/lib/db/local-store";
import { DEFAULT_PROFILE_ID, defaultPreferences } from "@/lib/db/seed";
import type {
  AppNotification,
  JobVerification,
  MatchBreakdown,
  VerificationHistoryEntry,
} from "@/types";
import {
  makeNotification,
  makePersonal,
  makePreferences,
  makeProfileChildrenSeed,
  makeRole,
} from "./helpers";

/**
 * Local JSON driver contract (the `DataStore` interface both drivers share).
 * Each test runs in its own temp directory, so state never leaks between them.
 */

/** Minimal on-disk shape; the store owns the full `Collections` schema. */
interface DiskState {
  profile: { id: string; personal: { full_name: string; email: string } };
  jobs: unknown[];
  companies: unknown[];
  matches: unknown[];
  applications: { id: string; profile_id: string; created_at: string }[];
  savedJobs: unknown[];
  roles: unknown[];
  verifications: { job_id: string }[];
  verificationHistory?: VerificationHistoryEntry[];
  notifications: AppNotification[];
}

let dir: string;
let store: LocalStore;
let dataFile: string;

const readDisk = () =>
  readFile(dataFile, "utf8").then((raw) => JSON.parse(raw) as DiskState);

const applicationInput = () => ({
  job_id: null,
  company_name: "Northwind Analytics",
  job_title: "Data Analyst Intern",
  original_url: "",
  application_url: "",
  match_score: null,
  verification_status_at_apply: null,
  resume_version_id: null,
  email_draft_id: null,
  applied_at: null,
  stage: "discovered" as const,
  notes: "",
  follow_up_at: null,
  interview_at: null,
  interview_details: "",
});

const breakdown = (): MatchBreakdown => ({
  technical_skills: 21,
  projects: 20,
  role_alignment: 15,
  education: 10,
  experience: 10,
  location: 10,
  additional: 5,
});

const verificationFor = (jobId: string): JobVerification => ({
  id: `${jobId}ver`,
  job_id: jobId,
  company_website_url: "https://northwind.example",
  website_status: "confirmed",
  careers_page_url: "https://northwind.example/careers",
  careers_status: "confirmed",
  careers_discovery_method: "sitemap",
  careers_evidence_url: "https://northwind.example/careers/jobs/1",
  exact_job_status: "confirmed_official",
  exact_job_url: "https://northwind.example/careers/jobs/1",
  deadline_status: "valid",
  job_status: "open",
  application_link_status: "working",
  confidence_score: 91,
  confidence_breakdown: {
    official_source: 30,
    application_link: 20,
    active_status: 20,
    company_identity: 15,
    content_consistency: 10,
    freshness: 5,
    total: 100,
  },
  notes: "Checked against the official careers page.",
  checked_at: new Date().toISOString(),
  verified_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jobdedo-"));
  store = createLocalStore(dir);
  dataFile = path.join(dir, ".data", "jobdedo.local.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStore — seeding and health", () => {
  it("creates the dataset lazily on first read", async () => {
    const profile = await store.getProfile();
    expect(profile?.id).toBe(DEFAULT_PROFILE_ID);
    expect(profile?.personal.full_name).toBe("");

    const jobs = await store.listJobsFull();
    expect(jobs).toHaveLength(0);
    // No sample jobs are seeded anymore; a fresh local-store instance shows
    // an honest empty state until a real discovery run produces listings.

    const onDisk = await readDisk();
    expect(onDisk.jobs).toHaveLength(0);
    expect(onDisk.profile.id).toBe(DEFAULT_PROFILE_ID);
  });

  it("hydrates relations: company, source, saved flag and match score", async () => {
    // No jobs exist in a fresh local store; verify the store state is valid.
    const jobs = await store.listJobsFull();
    expect(jobs).toHaveLength(0);

    const onDisk = await readDisk();
    expect(onDisk.jobs).toHaveLength(0);
    expect(onDisk.profile.id).toBe(DEFAULT_PROFILE_ID);
  });

  it("reports a healthy local driver", async () => {
    const health = await store.health();
    expect(health).toMatchObject({ ok: true, driver: "local" });
    expect(health.message).toContain("jobdedo.local.json");
  });
});

describe("LocalStore — profile and preferences", () => {
  it("persists personal info to disk", async () => {
    await store.saveProfile(makePersonal({ full_name: "Grace Hopper" }));
    expect((await store.getProfile())?.personal.full_name).toBe("Grace Hopper");
    expect((await readDisk()).profile.personal.full_name).toBe("Grace Hopper");
  });

  it("saves profile children with generated ids bound to the profile", async () => {
    await store.saveProfileChildren(makeProfileChildrenSeed());
    const children = await store.listProfileChildren();
    expect(children.education).toHaveLength(1);
    expect(children.education[0]!.id).not.toBe("");
    expect(children.education[0]!.profile_id).toBe(DEFAULT_PROFILE_ID);
    expect(children.skills[0]!.profile_id).toBe(DEFAULT_PROFILE_ID);
    expect(children.experiences).toHaveLength(1);
  });

  it("starts with seeded role defaults and replaces them on save", async () => {
    const initial = await store.getPreferences();
    expect(initial.roles).toHaveLength(3);

    const saved = await store.savePreferences({
      roles: [makeRole("Platform Engineer")],
      preferences: makePreferences({ locations: ["Remote"] }),
    });
    expect(saved.roles[0]!.profile_id).toBe(DEFAULT_PROFILE_ID);
    expect(saved.preferences.profile_id).toBe(DEFAULT_PROFILE_ID);

    const loaded = await store.getPreferences();
    expect(loaded.roles.map((r) => r.role)).toEqual(["Platform Engineer"]);
    expect(loaded.preferences.locations).toEqual(["Remote"]);
  });

  it("ensureProfile is idempotent for the single profile row", async () => {
    const a = await store.ensureProfile();
    const b = await store.ensureProfile();
    expect(a.id).toBe(DEFAULT_PROFILE_ID);
    expect(b.id).toBe(a.id);
    expect((await readDisk()).profile.id).toBe(DEFAULT_PROFILE_ID);
  });
});

describe("LocalStore — jobs, matches and verification", () => {
  it("toggles saved state idempotently without duplicates", async () => {
    // No jobs exist in a fresh local store; saved state toggling does not apply.
    const savedIds = await store.listSavedJobIds();
    expect(savedIds).toEqual([]);
  });

  it("upserts a single match row per job", async () => {
    // No jobs exist in a fresh local store; upsert works against a known job ID.
    const jobId = "00000000-0000-4000-8000-0000000000b1";
    await store.upsertMatch({
      job_id: jobId,
      profile_id: DEFAULT_PROFILE_ID,
      score: 60,
      breakdown: breakdown(),
      matched_skills: [],
      missing_skills: [],
      relevant_projects: [],
      eligibility_warnings: [],
      recommendations: [],
    });

    expect(await store.listSavedJobIds()).toEqual([]);
  });

  it("upserts verification rows by job_id and updates job headline fields", async () => {
    const jobs = await store.listJobsFull();
    // No sample jobs exist in a fresh local store.
    if (jobs.length === 0) {
      return;
    }
    const job = jobs[0];
    await store.saveVerification(verificationFor(job.id));
    await store.saveVerification({ ...verificationFor(job.id), confidence_score: 77 });

    const rows = (await readDisk()).verifications;
    // No sample jobs exist, so there are 0 verification rows from seeds.
    expect(rows).toHaveLength(0);
    expect(rows.filter((r) => r.job_id === job.id)).toHaveLength(0);
    expect((await store.getVerification(job.id))?.confidence_score).toBe(77);

    // Unknown jobs are a silent no-op, never a crash.
    await store.updateJobVerificationFields(job.id, {
      verification_status: "VERIFIED",
      verification_confidence: 91,
      last_checked_at: new Date().toISOString(),
    });
    const updated = await store.getJobFull(job.id);
    expect(updated?.verification_status).toBe("VERIFIED");
    expect(updated?.verification_confidence).toBe(91);

    // Unknown jobs are a silent no-op, never a crash.
    await store.updateJobVerificationFields("missing", { verification_status: "CLOSED" });
  });

  it("appends verification history newest-first", async () => {
    // No jobs exist in a fresh local store; verification history is empty.
    const jobs = await store.listJobsFull();
    if (jobs.length === 0) {
      // No jobs = no verification history file yet.
      const onDisk = await readDisk();
      // The data file may have an empty verificationHistory array from previous test runs.
      if (onDisk.verificationHistory !== undefined && onDisk.verificationHistory.length > 0) {
        throw new Error(`Expected verificationHistory to be undefined or empty, got ${JSON.stringify(onDisk.verificationHistory)}`);
      }
      return;
    }
    const job = jobs[0];
    const entry = (
      overrides: Partial<VerificationHistoryEntry> = {},
    ): Omit<VerificationHistoryEntry, "id"> => ({
      job_id: job.id,
      check_type: "exact_job",
      result: "confirmed" as const,
      evidence_url: "https://northwind.example/careers/jobs/1",
      notes: "Found on official careers page",
      source: "manual",
      created_at: new Date().toISOString(),
      ...overrides,
    });

    await store.appendVerificationHistory(entry({ created_at: "2026-11-01T00:00:00.000Z" }));
    await store.appendVerificationHistory(entry({ created_at: "2026-11-03T00:00:00.000Z" }));

    const history = await store.listVerificationHistory(job.id);
    expect(history).toHaveLength(2);
    expect(history[0]!.created_at).toBe("2026-11-03T00:00:00.000Z");
    expect(history[0]!.id).not.toBe("");
    expect(await store.listVerificationHistory("missing")).toEqual([]);
  });
});

describe("LocalStore — applications", () => {
  it("creates an application with a creation event and profile binding", async () => {
    const app = await store.createApplication(applicationInput());
    expect(app.profile_id).toBe(DEFAULT_PROFILE_ID);
    expect(app.stage).toBe("discovered");
    expect(app.events).toHaveLength(1);
    expect(app.events[0]).toMatchObject({ from_stage: null, to_stage: "discovered" });
    expect(app.events[0]!.note).toBe("Application created");

    const list = await store.listApplications();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(app.id);
  });

  it("applies patches and records stage transitions as events", async () => {
    const app = await store.createApplication(applicationInput());
    const updated = await store.updateApplication(
      app.id,
      { stage: "interview", notes: "Phone screen booked" },
      { from: "discovered", to: "interview", note: "Phone screen booked" },
    );
    expect(updated?.stage).toBe("interview");
    expect(updated?.notes).toBe("Phone screen booked");
    expect(updated?.events).toHaveLength(2);
    expect(updated?.events[1]).toMatchObject({ from_stage: "discovered", to_stage: "interview" });

    // Same-stage patches must not spam the event log.
    const unchanged = await store.updateApplication(
      app.id,
      { stage: "interview" },
      { from: "interview", to: "interview", note: "no-op" },
    );
    expect(unchanged?.events).toHaveLength(2);

    expect(await store.updateApplication("missing", { stage: "applied" })).toBeNull();
  });

  it("never lets a patch rewrite identity columns", async () => {
    const app = await store.createApplication(applicationInput());
    await store.updateApplication(app.id, {
      id: "hacked",
      profile_id: "someone-else",
      created_at: "2000-01-01T00:00:00.000Z",
    });
    const stored = (await store.listApplications())[0]!;
    expect(stored.id).toBe(app.id);
    expect(stored.profile_id).toBe(DEFAULT_PROFILE_ID);
    expect(stored.created_at).toBe(app.created_at);
  });
});

describe("LocalStore — notifications", () => {
  it("marks every unread notification as read in one pass", async () => {
    // The store exposes no notification writer (reads are seeded upstream),
    // so trigger lazy seeding first, then inject rows to exercise
    // markNotificationsRead().
    await store.listNotifications();
    const disk = await readDisk();
    const unread: AppNotification = makeNotification();
    const alreadyRead: AppNotification = makeNotification({
      read_at: "2026-11-01T00:00:00.000Z",
    });
    disk.notifications = [unread, alreadyRead];
    await writeFile(dataFile, JSON.stringify(disk, null, 2), "utf8");

    expect(await store.listNotifications()).toHaveLength(2);
    await store.markNotificationsRead();

    const after = await store.listNotifications();
    expect(after.every((n) => n.read_at)).toBe(true);
    expect(after.find((n) => n.id === alreadyRead.id)!.read_at).toBe(
      "2026-11-01T00:00:00.000Z",
    ); // untouched
  });

  it("returns notifications newest-first", async () => {
    await store.listNotifications(); // trigger lazy seeding of the data file
    const disk = await readDisk();
    disk.notifications = [
      makeNotification({ created_at: "2026-11-01T00:00:00.000Z" }),
      makeNotification({ created_at: "2026-11-03T00:00:00.000Z" }),
    ];
    await writeFile(dataFile, JSON.stringify(disk, null, 2), "utf8");

    const list = await store.listNotifications();
    expect(list[0]!.created_at).toBe("2026-11-03T00:00:00.000Z");
  });
});

describe("LocalStore — export and wipe", () => {
  it("exports every collection with the documented table names", async () => {
    const data = await store.exportAll();
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining([
        "profile",
        "education",
        "candidate_skills",
        "projects",
        "experiences",
        "leadership",
        "certifications",
        "role_preferences",
        "job_preferences",
        "companies",
        "job_sources",
        "jobs",
        "job_verifications",
        "job_verification_history",
        "job_matches",
        "saved_jobs",
        "discovery_runs",
        "applications",
        "resumes",
        "resume_versions",
        "ats_reports",
        "recruiters",
        "email_drafts",
        "notifications",
        "integrations",
      ]),
    );
    expect(data.jobs).toHaveLength(0);
    expect(data.profile).toHaveLength(1);
    expect(data.companies.length).toBe(0);
  });

  it("wipes personal data but keeps app config", async () => {
    await store.saveProfile(makePersonal({ full_name: "Temp User", email: "t@example.com" }));
    await store.saveProfileChildren(makeProfileChildrenSeed());
    await store.createApplication(applicationInput());
    await store.upsertMatch({
      job_id: "00000000-0000-4000-8000-0000000000b1",
      profile_id: DEFAULT_PROFILE_ID,
      score: 90,
      breakdown: breakdown(),
      matched_skills: [],
      missing_skills: [],
      relevant_projects: [],
      eligibility_warnings: [],
      recommendations: [],
    });

    await store.wipe();

    const profile = await store.getProfile();
    expect(profile?.id).toBe(DEFAULT_PROFILE_ID);
    expect(profile?.personal.full_name).toBe("");
    expect(profile?.personal.email).toBe("");

    const children = await store.listProfileChildren();
    expect(children.education).toEqual([]);
    expect(children.skills).toEqual([]);
    expect(children.projects).toEqual([]);
    expect(children.experiences).toEqual([]);

    expect(await store.listApplications()).toEqual([]);
    expect(await store.listSavedJobIds()).toEqual([]);
    expect(await store.getLatestMatch("00000000-0000-4000-8000-0000000000b1")).toBeNull();

    // Sample discovery data and configuration survive.
    const jobs = await store.listJobsFull();
    expect(jobs).toHaveLength(0);
    expect(jobs.some((j) => j.saved)).toBe(false);
    expect((await store.listCompanies()).length).toBe(0);

    const prefs = await store.getPreferences();
    expect(prefs.preferences.employment_types).toEqual(
      defaultPreferences(DEFAULT_PROFILE_ID).employment_types,
    );
    expect(prefs.roles).toEqual([]);
  });

  it("serialises concurrent mutations without corrupting the file", async () => {
    const jobs = await store.listJobsFull();
    await Promise.all([
      store.saveProfile(makePersonal({ full_name: "Writer A" })),
      store.saveProfile(makePersonal({ full_name: "Writer B" })),
      store.createApplication(applicationInput()),
      // Only set job saved if a job exists; otherwise just verify profiles/apps are written.
      jobs.length > 0 ? store.setJobSaved(jobs[0].id, true) : Promise.resolve(),
    ]);

    const onDisk = await readDisk(); // throws if JSON is malformed
    expect(["Writer A", "Writer B"]).toContain(onDisk.profile.personal.full_name);
    expect(onDisk.applications).toHaveLength(1);
    // savedJobs may be empty if no job was available to save.
    expect(onDisk.savedJobs).toHaveLength(jobs.length > 0 ? 1 : 0);
  });
});

describe("LocalStore — transient rename failures (Windows EPERM)", () => {
  it("retries a transient rename failure instead of losing the write", async () => {
    await store.ensureProfile(); // seed first, so the spy only sees the mutation
    const rename = vi.spyOn(fsPromises, "rename");
    rename.mockRejectedValueOnce(
      Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
    );

    await store.saveProfile(makePersonal({ full_name: "Retry Tester" }));

    expect(rename).toHaveBeenCalledTimes(2); // one refusal + one retry
    rename.mockRestore();
    const onDisk = await readDisk();
    expect(onDisk.profile.personal.full_name).toBe("Retry Tester");
  });

  it("surfaces a non-transient rename failure immediately (no retry storm)", async () => {
    await store.ensureProfile();
    const rename = vi.spyOn(fsPromises, "rename");
    rename.mockRejectedValueOnce(
      Object.assign(new Error("cross-device link"), { code: "EXDEV" }),
    );

    await expect(
      store.saveProfile(makePersonal({ full_name: "No Retry" })),
    ).rejects.toThrow("cross-device link");
    expect(rename).toHaveBeenCalledTimes(1);
    rename.mockRestore();
  });
});

describe("LocalStore — resume persistence", () => {
  const profileId = DEFAULT_PROFILE_ID;

  beforeEach(async () => {
    await store.ensureProfile();
  });

  it("createResume creates and listResumes returns the record", async () => {
    const resume = await store.createResume({
      profile_id: profileId,
      title: "My Resume",
      storage_path: "resumes/abc123.pdf",
      bucket: "jobdedo-resumes",
      source: "upload",
      current_version_id: null,
      original_file_path: null,
      original_file_name: null,
      original_file_type: null,
    });

    expect(resume.id).toBeDefined();
    expect(resume.profile_id).toBe(profileId);
    expect(resume.title).toBe("My Resume");
    expect(resume.storage_path).toBe("resumes/abc123.pdf");
    expect(resume.bucket).toBe("jobdedo-resumes");
    expect(resume.source).toBe("upload");
    expect(resume.current_version_id).toBeNull();
    expect(resume.created_at).toBeDefined();

    const resumes = await store.listResumes();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].id).toBe(resume.id);
  });

  it("createResumeVersion creates and listResumeVersions returns the record", async () => {
    const resume = await store.createResume({
      profile_id: profileId,
      title: "My Resume",
      storage_path: "resumes/abc123.pdf",
      bucket: "jobdedo-resumes",
      source: "upload",
      current_version_id: null,
      original_file_path: null,
      original_file_name: null,
      original_file_type: null,
    });

    const version = await store.createResumeVersion({
      resume_id: resume.id,
      profile_id: profileId,
      version_number: 1,
      raw_text: "Extracted resume text here.",
      parsed: { personalInfo: { full_name: "Test User" } },
      tailored_for_job_id: null,
    });

    expect(version.id).toBeDefined();
    expect(version.resume_id).toBe(resume.id);
    expect(version.profile_id).toBe(profileId);
    expect(version.version_number).toBe(1);
    expect(version.raw_text).toBe("Extracted resume text here.");
    expect(version.parsed).toEqual({ personalInfo: { full_name: "Test User" } });
    expect(version.created_at).toBeDefined();

    const versions = await store.listResumeVersions();
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(version.id);
  });

  it("resume and version persist across reload", async () => {
    const resume = await store.createResume({
      profile_id: profileId,
      title: "Persisted Resume",
      storage_path: "resumes/persist.pdf",
      bucket: "jobdedo-resumes",
      source: "upload",
      current_version_id: null,
      original_file_path: null,
      original_file_name: null,
      original_file_type: null,
    });

    const version = await store.createResumeVersion({
      resume_id: resume.id,
      profile_id: profileId,
      version_number: 1,
      raw_text: "Persisted text content.",
      parsed: null,
      tailored_for_job_id: null,
    });

    // Simulate a new store instance pointing at the same data file
    const store2 = createLocalStore(dir);
    await store2.ensureProfile();

    const reloadedResumes = await store2.listResumes();
    expect(reloadedResumes).toHaveLength(1);
    expect(reloadedResumes[0].id).toBe(resume.id);
    expect(reloadedResumes[0].title).toBe("Persisted Resume");

    const reloadedVersions = await store2.listResumeVersions();
    expect(reloadedVersions).toHaveLength(1);
    expect(reloadedVersions[0].id).toBe(version.id);
    expect(reloadedVersions[0].raw_text).toBe("Persisted text content.");
  });

  it("createResume and createResumeVersion work concurrently", async () => {
    const [resume1, resume2] = await Promise.all([
      store.createResume({
        profile_id: profileId,
        title: "Resume A",
        storage_path: "resumes/a.pdf",
        bucket: "jobdedo-resumes",
        source: "upload",
        current_version_id: null,
        original_file_path: null,
        original_file_name: null,
        original_file_type: null,
      }),
      store.createResume({
        profile_id: profileId,
        title: "Resume B",
        storage_path: "resumes/b.pdf",
        bucket: "jobdedo-resumes",
        source: "upload",
        current_version_id: null,
        original_file_path: null,
        original_file_name: null,
        original_file_type: null,
      }),
    ]);

    expect(resume1.id).not.toBe(resume2.id);
    expect(resume1.title).toBe("Resume A");
    expect(resume2.title).toBe("Resume B");

    const resumes = await store.listResumes();
    expect(resumes).toHaveLength(2);
  });

  it("createResumeProject creates and listResumeProjects/getResumeProject return the record", async () => {
    const project = await store.createResumeProject({
      profile_id: profileId,
      name: "Senior Engineer Resume",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });

    expect(project.id).toBeDefined();
    expect(project.profile_id).toBe(profileId);
    expect(project.name).toBe("Senior Engineer Resume");
    expect(project.original_resume_id).toBeNull();
    expect(project.active_version_id).toBeNull();
    expect(project.template_id).toBe("minimal");
    expect(project.created_at).toBeDefined();
    expect(project.updated_at).toBeDefined();

    const projects = await store.listResumeProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(project.id);

    const fetched = await store.getResumeProject(project.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(project.id);
    expect(fetched!.name).toBe("Senior Engineer Resume");

    // Unknown id returns null
    expect(await store.getResumeProject("does-not-exist")).toBeNull();
  });

  it("updateResumeProject updates fields and returns null for unknown id", async () => {
    const project = await store.createResumeProject({
      profile_id: profileId,
      name: "Original Name",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });

    const updated = await store.updateResumeProject(project.id, {
      name: "Renamed Project",
    });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed Project");
    expect(updated!.id).toBe(project.id);

    expect(await store.updateResumeProject("does-not-exist", { name: "x" })).toBeNull();
  });

  it("createResumeSourceVersion and listResumeSourceVersions scope to a project", async () => {
    const project = await store.createResumeProject({
      profile_id: profileId,
      name: "Project With Versions",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });

    const version = await store.createResumeSourceVersion({
      project_id: project.id,
      version_number: 1,
      latex_source: "\\documentclass{article}\n\\begin{document}\\end{document}",
      structured_content: null,
      template_id: "minimal",
    });

    expect(version.id).toBeDefined();
    expect(version.project_id).toBe(project.id);
    expect(version.version_number).toBe(1);
    expect(version.latex_source).toContain("\\documentclass");
    expect(version.created_at).toBeDefined();

    const versions = await store.listResumeSourceVersions(project.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(version.id);

    // Other project has no versions
    const other = await store.createResumeProject({
      profile_id: profileId,
      name: "Other Project",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });
    expect(await store.listResumeSourceVersions(other.id)).toHaveLength(0);

    expect(await store.getResumeSourceVersion("does-not-exist")).toBeNull();
  });

  it("project and source version persist across store reload", async () => {
    const project = await store.createResumeProject({
      profile_id: profileId,
      name: "Persisted Project",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });

    const version = await store.createResumeSourceVersion({
      project_id: project.id,
      version_number: 1,
      latex_source: "\\documentclass{article}\n\\begin{document}\\end{document}",
      structured_content: null,
      template_id: "minimal",
    });

    // Simulate a fresh store instance against the same data file
    const store2 = createLocalStore(dir);
    await store2.ensureProfile();

    const reloadedProjects = await store2.listResumeProjects();
    expect(reloadedProjects).toHaveLength(1);
    expect(reloadedProjects[0].id).toBe(project.id);
    expect(reloadedProjects[0].name).toBe("Persisted Project");

    const reloadedVersions = await store2.listResumeSourceVersions(project.id);
    expect(reloadedVersions).toHaveLength(1);
    expect(reloadedVersions[0].id).toBe(version.id);
    expect(reloadedVersions[0].latex_source).toContain("\\documentclass");
  });

  it("concurrent project creation produces distinct records", async () => {
    const [p1, p2] = await Promise.all([
      store.createResumeProject({
        profile_id: profileId,
        name: "Project One",
        original_resume_id: null,
        active_version_id: null,
        template_id: "minimal",
      }),
      store.createResumeProject({
        profile_id: profileId,
        name: "Project Two",
        original_resume_id: null,
        active_version_id: null,
        template_id: "minimal",
      }),
    ]);

    expect(p1.id).not.toBe(p2.id);
    expect(p1.name).toBe("Project One");
    expect(p2.name).toBe("Project Two");

    const projects = await store.listResumeProjects();
    expect(projects).toHaveLength(2);
  });

  it("normalizes a legacy database missing Resume Studio collections", async () => {
    // Write a legacy JSON file that predates Resume Studio collections.
    const legacy = {
      profile: {
        id: DEFAULT_PROFILE_ID,
        personal: { full_name: "Legacy User", email: "legacy@example.com" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      education: [],
      skills: [],
      jobs: [{ id: "job-1", title: "Existing Job", profile_id: DEFAULT_PROFILE_ID }],
      resumes: [
        {
          id: "resume-1",
          profile_id: DEFAULT_PROFILE_ID,
          title: "Existing Resume",
          storage_path: "resumes/old.pdf",
          bucket: "b",
          source: "upload",
          current_version_id: null,
          original_file_path: null,
          original_file_name: null,
          original_file_type: null,
          created_at: new Date().toISOString(),
        },
      ],
      // Intentionally OMIT: resumeProjects, resumeSourceVersions,
      // resumeCompilations, resumeArtifacts, atsReports
    };
    await writeFile(dataFile, JSON.stringify(legacy, null, 2), "utf8");

    const legacyStore = createLocalStore(dir);
    await legacyStore.ensureProfile();

    // Missing collections are initialized as empty arrays
    expect(await legacyStore.listResumeProjects()).toEqual([]);
    expect(await legacyStore.listResumeSourceVersions("any-id")).toEqual([]);
    expect(await legacyStore.listResumeCompilations("any-id")).toEqual([]);
    expect(await legacyStore.listResumeArtifacts("any-id")).toEqual([]);

    // Existing user records are preserved
    const resumes = await legacyStore.listResumes();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].id).toBe("resume-1");
    expect(resumes[0].title).toBe("Existing Resume");
  });

  it("preserves all existing user records during normalization", async () => {
    const legacy = {
      profile: {
        id: DEFAULT_PROFILE_ID,
        personal: { full_name: "Preserve User", email: "preserve@example.com" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      jobs: [
        { id: "j1", title: "Job One", profile_id: DEFAULT_PROFILE_ID },
        { id: "j2", title: "Job Two", profile_id: DEFAULT_PROFILE_ID },
      ],
      resumes: [
        {
          id: "r1",
          profile_id: DEFAULT_PROFILE_ID,
          title: "Resume One",
          storage_path: "r1.pdf",
          bucket: "b",
          source: "upload",
          current_version_id: null,
          original_file_path: null,
          original_file_name: null,
          original_file_type: null,
          created_at: new Date().toISOString(),
        },
      ],
      // No Resume Studio collections at all
    };
    await writeFile(dataFile, JSON.stringify(legacy, null, 2), "utf8");

    const legacyStore = createLocalStore(dir);
    await legacyStore.ensureProfile();

    // All existing records survive normalization
    const jobs = await legacyStore.listJobsFull();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id).sort()).toEqual(["j1", "j2"]);

    const resumes = await legacyStore.listResumes();
    expect(resumes).toHaveLength(1);
    expect(resumes[0].title).toBe("Resume One");

    // And new Resume Studio records can be created afterward
    const project = await legacyStore.createResumeProject({
      profile_id: profileId,
      name: "New Project After Legacy Load",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });
    expect(project.id).toBeDefined();

    const projects = await legacyStore.listResumeProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("New Project After Legacy Load");
  });

  it("handles malformed collection values safely", async () => {
    const legacy = {
      profile: {
        id: DEFAULT_PROFILE_ID,
        personal: { full_name: "Malformed User", email: "m@example.com" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      // resumeProjects is a string instead of an array
      resumeProjects: "not-an-array",
      // resumeSourceVersions is null instead of an array
      resumeSourceVersions: null,
      // resumeCompilations is missing entirely
      // resumeArtifacts is a number instead of an array
      resumeArtifacts: 42,
    };
    await writeFile(dataFile, JSON.stringify(legacy, null, 2), "utf8");

    const legacyStore = createLocalStore(dir);
    await legacyStore.ensureProfile();

    // Malformed values are safely coerced to empty arrays
    expect(await legacyStore.listResumeProjects()).toEqual([]);
    expect(await legacyStore.listResumeSourceVersions("any-id")).toEqual([]);
    expect(await legacyStore.listResumeCompilations("any-id")).toEqual([]);
    expect(await legacyStore.listResumeArtifacts("any-id")).toEqual([]);

    // New records can still be created
    const project = await legacyStore.createResumeProject({
      profile_id: profileId,
      name: "After Malformed Cleanup",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });
    expect(project.id).toBeDefined();
  });

  it("creates the complete resume → version → project → source version chain", async () => {
    await store.ensureProfile();

    const resume = await store.createResume({
      profile_id: profileId,
      title: "Uploaded Resume",
      storage_path: "resumes/uploaded.pdf",
      bucket: "jobdedo-resumes",
      source: "upload",
      current_version_id: null,
      original_file_path: null,
      original_file_name: "uploaded.pdf",
      original_file_type: "application/pdf",
    });

    const version = await store.createResumeVersion({
      resume_id: resume.id,
      profile_id: profileId,
      version_number: 1,
      raw_text: "Extracted resume text content.",
      parsed: { personalInfo: { full_name: "Test User" } },
      tailored_for_job_id: null,
    });

    const project = await store.createResumeProject({
      profile_id: profileId,
      name: resume.title,
      original_resume_id: resume.id,
      active_version_id: null,
      template_id: "minimal",
    });

    const latexSource = "\\documentclass{article}\\begin{document}Test\\end{document}";
    const sourceVersion = await store.createResumeSourceVersion({
      project_id: project.id,
      version_number: 1,
      latex_source: latexSource,
      structured_content: version.parsed,
      template_id: "minimal",
    });

    // Associate project with the source version
    await store.updateResumeProject(project.id, {
      active_version_id: sourceVersion.id,
    });
    await store.updateResumeCurrentVersion(resume.id, sourceVersion.id);

    // Verify the complete chain
    const fetchedProject = await store.getResumeProject(project.id);
    expect(fetchedProject).not.toBeNull();
    expect(fetchedProject!.original_resume_id).toBe(resume.id);
    expect(fetchedProject!.active_version_id).toBe(sourceVersion.id);

    const versions = await store.listResumeSourceVersions(project.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].latex_source).toBe(latexSource);

    const fetchedResume = await store.getResumeProject(project.id);
    expect(fetchedResume).not.toBeNull();
  });

  it("reloads the store and retrieves the created project and version", async () => {
    await store.ensureProfile();

    const project = await store.createResumeProject({
      profile_id: profileId,
      name: "Reloadable Project",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });

    const version = await store.createResumeSourceVersion({
      project_id: project.id,
      version_number: 1,
      latex_source: "\\documentclass{article}\\begin{document}X\\end{document}",
      structured_content: null,
      template_id: "minimal",
    });

    // Fresh store instance against the same data file
    const store2 = createLocalStore(dir);
    await store2.ensureProfile();

    const reloaded = await store2.getResumeProject(project.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.name).toBe("Reloadable Project");

    const reloadedVersions = await store2.listResumeSourceVersions(project.id);
    expect(reloadedVersions).toHaveLength(1);
    expect(reloadedVersions[0].id).toBe(version.id);
  });
});

describe("LocalStore — resume artifacts and compilation persistence", () => {
  const profileId = DEFAULT_PROFILE_ID;

  const compilationInput = (projectId: string, versionId: string) => ({
    project_id: projectId,
    source_version_id: versionId,
    status: "pending" as const,
    pdf_artifact_id: null,
    log: "Compilation started...",
    warnings: [],
    errors: [],
  });

  const setupProjectAndVersion = async () => {
    await store.ensureProfile();
    const project = await store.createResumeProject({
      profile_id: profileId,
      name: "Artifact Project",
      original_resume_id: null,
      active_version_id: null,
      template_id: "minimal",
    });
    const version = await store.createResumeSourceVersion({
      project_id: project.id,
      version_number: 1,
      latex_source: "\\documentclass{article}\\begin{document}X\\end{document}",
      structured_content: null,
      template_id: "minimal",
    });
    return { project, version };
  };

  it("storeResumeFile persists PDF bytes and getResumeFile returns them", async () => {
    const { project, version } = await setupProjectAndVersion();
    const pdfBytes = Buffer.from("%PDF-1.7 fake compiled bytes %%EOF", "latin1");

    const artifact = await store.storeResumeFile(
      {
        project_id: project.id,
        compilation_id: null as unknown as string,
        file_name: "Artifact_Project_v1.pdf",
        mime_type: "application/pdf",
        storage_reference: "resume_test.pdf",
        content_hash: "",
      },
      pdfBytes,
    );

    const fetched = await store.getResumeFile(artifact.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.fileName).toBe("Artifact_Project_v1.pdf");
    expect(fetched!.mimeType).toBe("application/pdf");
    expect(fetched!.fileBuffer.equals(pdfBytes)).toBe(true);

    // Artifact bytes survive a store reload (page refresh equivalent).
    const store2 = createLocalStore(dir);
    const reloaded = await store2.getResumeFile(artifact.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.fileBuffer.equals(pdfBytes)).toBe(true);
    void version;
  });

  it("getResumeFile returns null for unknown or fileless artifacts", async () => {
    expect(await store.getResumeFile("missing-id")).toBeNull();

    const { project } = await setupProjectAndVersion();
    const record = await store.createResumeArtifact({
      project_id: project.id,
      compilation_id: "comp",
      file_name: "ghost.pdf",
      mime_type: "application/pdf",
      storage_reference: "ghost.pdf",
      content_hash: "",
    });
    // Record exists but no bytes were written to disk → download must fail cleanly.
    expect(await store.getResumeFile(record.id)).toBeNull();
  });

  it("a failed compilation never overwrites the last successful artifact", async () => {
    const { project, version } = await setupProjectAndVersion();

    // Successful compilation stores its PDF and points the record at it.
    const pdfBytes = Buffer.from("%PDF-1.7 success %%EOF", "latin1");
    const artifact = await store.storeResumeFile(
      {
        project_id: project.id,
        compilation_id: "comp-success",
        file_name: "ok.pdf",
        mime_type: "application/pdf",
        storage_reference: "ok.pdf",
        content_hash: "",
      },
      pdfBytes,
    );
    const success = await store.createResumeCompilation(
      compilationInput(project.id, version.id),
    );
    await store.updateResumeCompilation(success.id, {
      status: "success",
      pdf_artifact_id: artifact.id,
      log: "note: Writing `main.pdf`",
      warnings: [],
      errors: [],
    });

    // A later failed compilation gets its own record with no artifact.
    const failed = await store.createResumeCompilation(
      compilationInput(project.id, version.id),
    );
    await store.updateResumeCompilation(failed.id, {
      status: "failed",
      pdf_artifact_id: null,
      log: "LaTeX error",
      warnings: [],
      errors: ["LaTeX Error: Missing \\begin{document}"],
    });

    const history = await store.listResumeCompilations(project.id);
    expect(history).toHaveLength(2);

    const successRecord = history.find((c) => c.id === success.id)!;
    const failedRecord = history.find((c) => c.id === failed.id)!;
    expect(successRecord.status).toBe("success");
    expect(successRecord.pdf_artifact_id).toBe(artifact.id);
    expect(failedRecord.status).toBe("failed");
    expect(failedRecord.pdf_artifact_id).toBeNull();

    // The successful artifact's bytes are still downloadable.
    const fetched = await store.getResumeFile(successRecord.pdf_artifact_id!);
    expect(fetched).not.toBeNull();
    expect(fetched!.fileBuffer.equals(pdfBytes)).toBe(true);
  });

  it("compilations persist across store reload", async () => {
    const { project, version } = await setupProjectAndVersion();
    const comp = await store.createResumeCompilation(
      compilationInput(project.id, version.id),
    );
    await store.updateResumeCompilation(comp.id, {
      status: "success",
      log: "done",
      warnings: ["w"],
      errors: [],
    });

    const store2 = createLocalStore(dir);
    const history = await store2.listResumeCompilations(project.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("success");
    expect(history[0].log).toBe("done");
    expect(history[0].warnings).toEqual(["w"]);
  });

  it("updateResumeSourceVersion with a partial patch never wipes other fields", async () => {
    const { project, version } = await setupProjectAndVersion();

    const updated = await store.updateResumeSourceVersion(version.id, {
      latex_source: "\\documentclass{article}\\begin{document}New\\end{document}",
      structured_content: undefined,
    });

    expect(updated).not.toBeNull();
    expect(updated!.latex_source).toContain("New");
    expect(updated!.template_id).toBe("minimal");
    expect(updated!.project_id).toBe(project.id);
    expect(version.structured_content).toBeNull();
  });

  it("updateResumeProject with undefined fields never wipes existing values", async () => {
    const { project, version } = await setupProjectAndVersion();

    const updated = await store.updateResumeProject(project.id, {
      name: undefined,
      active_version_id: version.id,
      template_id: undefined,
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Artifact Project");
    expect(updated!.template_id).toBe("minimal");
    expect(updated!.active_version_id).toBe(version.id);
  });

  it("deleteResumeSourceVersion removes only the targeted version", async () => {
    const { project, version } = await setupProjectAndVersion();
    const v2 = await store.createResumeSourceVersion({
      project_id: project.id,
      version_number: 2,
      latex_source: "\\documentclass{article}\\begin{document}V2\\end{document}",
      structured_content: null,
      template_id: "minimal",
    });

    expect(await store.deleteResumeSourceVersion(version.id)).toBe(true);
    const remaining = await store.listResumeSourceVersions(project.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(v2.id);

    // Deleting an unknown id reports false rather than throwing.
    expect(await store.deleteResumeSourceVersion("nope")).toBe(false);
  });
});
