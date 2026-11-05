import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "pgsql-parser";

import {
  APPLICATION_STAGES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  JOB_STATUSES,
  VERIFICATION_STATUSES,
  WORK_MODELS,
} from "@/types";

/**
 * Migration contract tests.
 *
 * There is no local Postgres in CI, so these tests parse both migration files
 * with libpg-query (the actual PostgreSQL parser, compiled to WASM) and then
 * cross-check the resulting statements against `src/lib/db/supabase-store.ts`,
 * the code that has to run against this schema.
 */

const ROOT = process.cwd();
const INIT_SQL_PATH = path.join(ROOT, "supabase", "migrations", "20261103120000_init_schema.sql");
const RLS_SQL_PATH = path.join(ROOT, "supabase", "migrations", "20261103120001_rls.sql");
const DISCOVERY_SQL_PATH = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261104120000_discovery_ingestion.sql",
);
const STORE_PATH = path.join(ROOT, "src", "lib", "db", "supabase-store.ts");

/* ---------------- minimal libpg-query AST shapes ---------------- */

interface PgConstraint {
  Constraint?: {
    contype?: string;
    raw_expr?: unknown;
    pktable?: { relname?: string };
    keys?: Array<{ String?: { sval?: string } }>;
  };
}
interface PgElement {
  ColumnDef?: { colname?: string; typeName?: { names?: Array<{ String?: { sval?: string } }> }; constraints?: PgConstraint[] };
  Constraint?: PgConstraint["Constraint"];
}
interface PgStatement {
  stmt: {
    CreateStmt?: { relation?: { relname?: string }; tableElts?: PgElement[] };
    IndexStmt?: { idxname?: string | null; relation?: { relname?: string }; unique?: boolean; whereClause?: unknown };
    InsertStmt?: { relation?: { relname?: string } };
    DoStmt?: { args?: Array<{ DefElem?: { arg?: { String?: { sval?: string } } } }> };
    [key: string]: unknown;
  };
}
interface PgParseResult {
  stmts: PgStatement[];
}

interface ColumnInfo {
  name: string;
  type: string | null;
  notNull: boolean;
  hasDefault: boolean;
  unique: boolean;
  references: string | null;
  checkExpr: unknown;
}
interface TableInfo {
  name: string;
  columns: Map<string, ColumnInfo>;
  tablePrimaryKey: string[];
}
interface IndexInfo {
  name: string;
  table: string;
  unique: boolean;
  partial: boolean;
}

/* ---------------- extraction helpers ---------------- */

async function parseFile(file: string): Promise<PgParseResult> {
  const sql = await readFile(file, "utf8");
  // The parser throws with a byte offset on any syntax error — that failure
  // mode is exactly what these tests exist to surface.
  return (await parse(sql)) as unknown as PgParseResult;
}

function typeNameOf(def: NonNullable<PgElement["ColumnDef"]>): string | null {
  return def.typeName?.names?.[0]?.String?.sval ?? null;
}

function buildTables(result: PgParseResult): Map<string, TableInfo> {
  const tables = new Map<string, TableInfo>();
  for (const { stmt } of result.stmts) {
    const create = stmt.CreateStmt;
    if (!create?.relation?.relname) continue;
    const info: TableInfo = { name: create.relation.relname, columns: new Map(), tablePrimaryKey: [] };
    for (const el of create.tableElts ?? []) {
      if (el.ColumnDef) {
        const def = el.ColumnDef;
        const colname = def.colname;
        if (!colname) continue;
        const col: ColumnInfo = {
          name: colname,
          type: typeNameOf(def),
          notNull: false,
          hasDefault: false,
          unique: false,
          references: null,
          checkExpr: null,
        };
        for (const c of def.constraints ?? []) {
          const k = c.Constraint?.contype;
          if (k === "CONSTR_NOTNULL") col.notNull = true;
          if (k === "CONSTR_DEFAULT") col.hasDefault = true;
          if (k === "CONSTR_UNIQUE") col.unique = true;
          // Column-level `id uuid primary key` — same contract as a table-level PK.
          if (k === "CONSTR_PRIMARY") info.tablePrimaryKey = [colname];
          if (k === "CONSTR_FOREIGN") col.references = c.Constraint?.pktable?.relname ?? null;
          if (k === "CONSTR_CHECK") col.checkExpr = c.Constraint?.raw_expr;
        }
        info.columns.set(colname, col);
      } else if (el.Constraint?.contype === "CONSTR_PRIMARY") {
        info.tablePrimaryKey = (el.Constraint.keys ?? []).map((k) => k.String?.sval ?? "").filter(Boolean);
      }
    }
    tables.set(info.name, info);
  }
  return tables;
}

function buildIndexes(result: PgParseResult): IndexInfo[] {
  const out: IndexInfo[] = [];
  for (const { stmt } of result.stmts) {
    const idx = stmt.IndexStmt;
    if (!idx?.idxname) continue;
    out.push({
      name: idx.idxname,
      table: idx.relation?.relname ?? "",
      unique: idx.unique === true,
      partial: idx.whereClause !== undefined && idx.whereClause !== null,
    });
  }
  return out;
}

function insertTargets(result: PgParseResult): string[] {
  return result.stmts
    .map((s) => s.stmt.InsertStmt?.relation?.relname)
    .filter((n): n is string => Boolean(n));
}

/** Every string literal inside a check expression (enum membership lists). */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "sval" && typeof value === "string") out.push(value);
    else collectStrings(value, out);
  }
  return out;
}

/**
 * String literals of `add constraint <name> check (<col> in (…))` as written
 * in raw SQL — used to prove a re-declared list matches the TS enum EXACTLY.
 */
function literalsInConstraint(sql: string, name: string): string[] {
  const match = sql.match(
    new RegExp(`add constraint ${name}\\s+check\\s*\\(\\s*\\w+\\s+in\\s*\\(([^)]*)\\)`, "i"),
  );
  if (!match) throw new Error(`constraint ${name} not found in migration`);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** Tables the driver wipes by profile_id (mirrors wipe() in supabase-store.ts). */
const WIPE_TABLES = [
  "education",
  "candidate_skills",
  "projects",
  "experiences",
  "leadership",
  "certifications",
  "role_preferences",
  "job_preferences",
  "saved_jobs",
  "job_matches",
  "applications",
  "application_events",
  "resumes",
  "resume_versions",
  "ats_reports",
  "recruiters",
  "email_drafts",
  "notifications",
  // resume_projects is wiped directly (cascades to source versions,
  // compilations, and artifacts via foreign key on delete cascade)
];

const FIXED_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

/* ---------------- test state ---------------- */

let initSql!: string;
let rlsSql!: string;
let discoverySql!: string;
let storeSource!: string;
let initResult!: PgParseResult;
let rlsResult!: PgParseResult;
let discoveryResult!: PgParseResult;
let tables!: Map<string, TableInfo>;
let indexes!: IndexInfo[];

beforeAll(async () => {
  [initSql, rlsSql, discoverySql, storeSource] = await Promise.all([
    readFile(INIT_SQL_PATH, "utf8"),
    readFile(RLS_SQL_PATH, "utf8"),
    readFile(DISCOVERY_SQL_PATH, "utf8"),
    readFile(STORE_PATH, "utf8"),
  ]);
  [initResult, rlsResult, discoveryResult] = await Promise.all([
    parseFile(INIT_SQL_PATH),
    parseFile(RLS_SQL_PATH),
    parseFile(DISCOVERY_SQL_PATH),
  ]);
  tables = buildTables(initResult);
  indexes = buildIndexes(initResult);
});

describe("migrations parse with the real PostgreSQL grammar", () => {
  it("parses the init schema into statements", () => {
    expect(initResult.stmts.length).toBeGreaterThan(50);
  });

  it("parses the RLS migration into a single DO block", () => {
    expect(rlsResult.stmts).toHaveLength(1);
    expect(rlsResult.stmts[0]!.stmt.DoStmt).toBeDefined();
  });
});

describe("schema inventory", () => {
  it("creates exactly the 33 documented tables", () => {
    expect([...tables.keys()].sort()).toEqual(
      [
        "profiles",
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
        "resumes",
        "resume_versions",
        "resume_projects",
        "resume_source_versions",
        "resume_compilations",
        "resume_artifacts",
        "ats_reports",
        "recruiters",
        "email_drafts",
        "applications",
        "application_events",
        "notifications",
        "integration_accounts",
        "search_schedules",
        "ai_usage_events",
        "discovery_locks",
      ].sort(),
    );
  });

  it("covers every table the Supabase driver queries", async () => {
    const queried = [...storeSource.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]!);
    expect(queried.length).toBeGreaterThan(20);
    for (const table of queried) {
      expect(tables.has(table), `driver queries missing table: ${table}`).toBe(true);
    }
  });

  it("covers every table listed in exportAll()", () => {
    const list = storeSource.match(/const tables = \[([\s\S]*?)\];/)?.[1] ?? "";
    const exported = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(exported).toHaveLength(30);
    for (const table of exported) {
      expect(tables.has(table), `exportAll lists missing table: ${table}`).toBe(true);
    }
  });
});

describe("driver contracts encoded in the schema", () => {
  it("satisfies every upsert onConflict target", () => {
    // job_verifications / job_matches upsert onConflict "job_id".
    expect(tables.get("job_verifications")!.columns.get("job_id")!.unique).toBe(true);
    expect(tables.get("job_matches")!.columns.get("job_id")!.unique).toBe(true);
    // saved_jobs upsert onConflict "profile_id,job_id".
    expect(tables.get("saved_jobs")!.tablePrimaryKey).toEqual(["profile_id", "job_id"]);
    // profiles / job_preferences upsert onConflict "id"; one preferences row per profile.
    expect(tables.get("profiles")!.tablePrimaryKey).toEqual(["id"]);
    expect(tables.get("job_preferences")!.tablePrimaryKey).toEqual(["id"]);
    expect(tables.get("job_preferences")!.columns.get("profile_id")!.unique).toBe(true);
  });

  it("wires the foreign keys the PostgREST embeds depend on", () => {
    // select("*, company:companies(*), source:job_sources(*)")
    expect(tables.get("jobs")!.columns.get("company_id")!.references).toBe("companies");
    expect(tables.get("jobs")!.columns.get("source_id")!.references).toBe("job_sources");
    // select("*, events:application_events(*)")
    expect(tables.get("application_events")!.columns.get("application_id")!.references).toBe(
      "applications",
    );
    // Saved rows and matches must die with their job/profile.
    expect(tables.get("saved_jobs")!.columns.get("job_id")!.references).toBe("jobs");
    expect(tables.get("job_matches")!.columns.get("job_id")!.references).toBe("jobs");
  });

  it("gives wipe() a profile_id column on every table it deletes by profile", () => {
    for (const table of WIPE_TABLES) {
      const info = tables.get(table);
      expect(info, `missing table: ${table}`).toBeDefined();
      const col = info!.columns.get("profile_id");
      expect(col, `${table} has no profile_id column for wipe()`).toBeDefined();
      expect(col!.notNull, `${table}.profile_id must be NOT NULL`).toBe(true);
      expect(col!.references, `${table}.profile_id must reference profiles`).toBe("profiles");
    }
  });

  it("keeps date-only fields as text so \"\" (Zod empty date) is storable", () => {
    for (const [table, column] of [
      ["jobs", "closing_date"],
      ["education", "start_date"],
      ["education", "graduation_date"],
      ["experiences", "end_date"],
      ["certifications", "issued_date"],
    ] as const) {
      expect(tables.get(table)!.columns.get(column)!.type, `${table}.${column}`).toBe("text");
    }
    // Real instants stay timestamptz.
    expect(tables.get("jobs")!.columns.get("posted_at")!.type).toBe("timestamptz");
    expect(tables.get("profiles")!.columns.get("created_at")!.type).toBe("timestamptz");
  });

  it("indexes the hot driver queries", () => {
    const byName = new Map(indexes.map((i) => [i.name, i]));
    const dedupe = byName.get("uq_jobs_dedupe_key");
    expect(dedupe, "partial dedupe index missing").toBeDefined();
    expect(dedupe!.unique).toBe(true);
    expect(dedupe!.partial).toBe(true); // where dedupe_key is not null and <> ''
    expect(byName.has("idx_jobs_first_discovered")).toBe(true); // listJobsFull order by
    expect(byName.has("idx_application_events_app")).toBe(true); // events embed order by
    expect(byName.has("idx_notifications_unread")).toBe(true); // unread badge filter
  });
});

describe("seed data", () => {
  it("inserts the single fixed profile row plus default preferences", () => {
    expect(insertTargets(initResult)).toEqual(["profiles", "role_preferences", "job_preferences"]);
    expect(initSql).toContain(FIXED_PROFILE_ID);
    expect(initSql).toMatch(/on conflict \(id\) do nothing/i);
    // Preference seeds must not clobber user-edited rows on re-run.
    expect(initSql).toMatch(/where not exists \(\s*select 1 from job_preferences/i);
    expect(initSql).toMatch(/where not exists \(\s*select 1 from role_preferences/i);
  });

  it("seeds an empty personal object matching emptyPersonal()", () => {
    const profilesInsert = initResult.stmts.find((s) => s.stmt.InsertStmt?.relation?.relname === "profiles");
    expect(profilesInsert).toBeDefined();
    const raw = JSON.stringify(profilesInsert);
    for (const field of [
      "full_name",
      "email",
      "phone",
      "city",
      "country",
      "headline",
      "summary",
      "linkedin_url",
      "github_url",
      "portfolio_url",
      "other_links",
    ]) {
      expect(raw, `profiles seed missing ${field}`).toContain(field);
    }
  });

  it("does not seed sample jobs into Supabase (documented M1 limitation)", () => {
    expect(insertTargets(initResult)).not.toContain("jobs");
    expect(insertTargets(initResult)).not.toContain("companies");
  });
});

describe("check constraints stay aligned with the TypeScript enums", () => {
  const enumColumns: Array<[table: string, column: string, expected: string[]]> = [
    ["applications", "stage", [...APPLICATION_STAGES]],
    ["jobs", "work_model", [...WORK_MODELS]],
    ["jobs", "employment_type", [...EMPLOYMENT_TYPES]],
    ["jobs", "experience_level", [...EXPERIENCE_LEVELS]],
    ["jobs", "verification_status", [...VERIFICATION_STATUSES]],
    ["jobs", "job_status", [...JOB_STATUSES]],
  ];

  for (const [table, column, expected] of enumColumns) {
    it(`${table}.${column} accepts exactly the TS enum values`, () => {
      const col = tables.get(table)!.columns.get(column)!;
      expect(col.checkExpr, `${table}.${column} has no check constraint`).not.toBeNull();
      const literals = collectStrings(col.checkExpr);
      for (const value of expected) {
        expect(literals, `${table}.${column} check is missing '${value}'`).toContain(value);
      }
    });
  }
});

describe("RLS migration", () => {
  function rlsTableNames(): string[] {
    const body = rlsResult.stmts[0]!.stmt.DoStmt!.args?.[0]?.DefElem?.arg?.String?.sval ?? "";
    expect(body, "DO block body not found").toContain("enable row level security");
    return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  }

  it("enables RLS on every table the schema creates", () => {
    const covered = rlsTableNames();
    expect(covered).toHaveLength(33);
    expect(new Set(covered).size).toBe(33); // no duplicates
    expect([...covered].sort()).toEqual([...tables.keys()].sort()); // same inventory
  });

  it("grants no policies to anyone (service-role only)", () => {
    // Strip `--` comments first: the file intentionally documents that no
    // policies exist, and that documentation must not read as a statement.
    const executable = rlsSql.replace(/--[^\n]*/g, "");
    expect(executable).not.toMatch(/create\s+policy/i);
    expect(executable).toMatch(/enable row level security/i);
  });

  it("is idempotent", () => {
    // `alter table ... enable row level security` re-runs safely; there is
    // nothing else executable outside the DO block.
    expect(rlsResult.stmts).toHaveLength(1);
    expect(initSql).not.toMatch(/drop\s+(table|index)/i);
  });
});

describe("discovery ingestion migration (Milestone 2)", () => {
  it("parses with the real PostgreSQL grammar", () => {
    expect(discoveryResult.stmts.length).toBeGreaterThan(0);
    // Every statement is an ALTER/CREATE INDEX — no table rewrites.
    const kinds = discoveryResult.stmts.map((s) => Object.keys(s.stmt)[0]);
    expect(kinds.every((k) => k === "AlterTableStmt" || k === "IndexStmt")).toBe(true);
  });

  it("adds the four ingestion columns, each guarded by IF NOT EXISTS", () => {
    expect(discoverySql).toMatch(/add column if not exists canonical_url text/i);
    expect(discoverySql).toMatch(/add column if not exists last_discovered_at timestamptz/i);
    // TEXT, not a foreign key: a wiped/pruned run must never cascade into rows.
    expect(discoverySql).toMatch(/add column if not exists last_discovery_run_id text/i);
    expect(discoverySql).toMatch(
      /add column if not exists source_links jsonb not null default '\[\]'::jsonb/i,
    );
    expect(discoverySql).not.toMatch(/alter table\s+\w+\s+drop\s+column/i);
  });

  it("indexes canonical_url lookups idempotently", () => {
    expect(discoverySql).toMatch(
      /create index if not exists idx_jobs_canonical_url on jobs \(canonical_url\)/i,
    );
  });

  it("widens employment_type / experience_level to include 'unknown'", () => {
    expect(discoverySql).toMatch(/drop constraint if exists jobs_employment_type_check/i);
    expect(discoverySql).toMatch(/drop constraint if exists jobs_experience_level_check/i);
    // The re-declared lists must match the TS enums EXACTLY (no extras, no gaps).
    expect(literalsInConstraint(discoverySql, "jobs_employment_type_check").sort()).toEqual(
      [...EMPLOYMENT_TYPES].sort(),
    );
    expect(literalsInConstraint(discoverySql, "jobs_experience_level_check").sort()).toEqual(
      [...EXPERIENCE_LEVELS].sort(),
    );
  });

  it("never drops tables or indexes", () => {
    expect(discoverySql).not.toMatch(/drop\s+(table|index)/i);
  });
});
