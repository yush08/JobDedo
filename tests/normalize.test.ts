import { describe, expect, it } from "vitest";

import {
  canonicalizeUrl,
  decodeEntities,
  domainFromUrl,
  employmentTypeFromText,
  experienceLevelFromText,
  extractRoleTags,
  extractSkills,
  parseCompensation,
  parseDescriptionSections,
  parseDurationDays,
  slug,
  splitLocation,
  squash,
  stripHtml,
  toIsoDate,
  toIsoInstant,
  workModelFromText,
} from "@/features/discovery/normalize";

/**
 * Normalisation contract (Milestone 2).
 *
 * Two properties are asserted everywhere here:
 *  1. extraction only ever reports what the source text actually says;
 *  2. anything unsupported becomes `unknown` / null / "" — never a guess.
 */

describe("URL canonicalisation", () => {
  it("lowercases the host, drops www, fragment, tracking params and trailing slash", () => {
    expect(
      canonicalizeUrl(
        "HTTPS://WWW.Example.com/jobs/1/?utm_source=nl&b=2&a=1#apply",
      ),
    ).toBe("https://example.com/jobs/1?a=1&b=2");
  });

  it("keeps parameters that change identity and sorts them", () => {
    expect(canonicalizeUrl("https://x.dev/j?b=2&a=1")).toBe("https://x.dev/j?a=1&b=2");
    expect(canonicalizeUrl("https://x.dev/j?gh_src=abc")).toBe("https://x.dev/j?gh_src=abc");
  });

  it("never canonicalises non-http(s) or relative values", () => {
    expect(canonicalizeUrl("/jobs/1")).toBe("");
    expect(canonicalizeUrl("ftp://example.com/x")).toBe("");
    expect(canonicalizeUrl("")).toBe("");
  });

  it("derives the registrable-looking domain only from absolute URLs", () => {
    expect(domainFromUrl("https://www.example.com/jobs")).toBe("example.com");
    expect(domainFromUrl("not a url")).toBe("");
  });
});

describe("HTML stripping (Greenhouse publishes escaped HTML)", () => {
  it("decodes escaped markup into readable text with bullets", () => {
    const escaped =
      "&lt;p&gt;Build reports.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;";
    const text = stripHtml(escaped);
    expect(text).toContain("Build reports.");
    expect(text).toContain("• Python");
    expect(text).toContain("• SQL");
    expect(text).not.toContain("<");
  });

  it("decodes named and numeric entities exactly once", () => {
    expect(decodeEntities("A&amp;B &#8212; C")).toBe("A&B — C");
    expect(stripHtml("salary &amp;amp; equity")).toContain("salary & equity");
  });
});

describe("field inference from source-published text", () => {
  it("reads the work model from the published location only", () => {
    expect(workModelFromText("Remote, India")).toBe("remote");
    expect(workModelFromText("Work from home")).toBe("remote");
    expect(workModelFromText("Bengaluru (Hybrid)")).toBe("hybrid");
    // No signal at all is NOT automatically "remote" — but the documented
    // policy for a plain office location is onsite.
    expect(workModelFromText("Bengaluru, India")).toBe("onsite");
  });

  it("returns unknown for employment type when the text carries no signal", () => {
    expect(employmentTypeFromText("Software Engineer")).toBe("unknown");
    expect(employmentTypeFromText("Software Engineer Intern")).toBe("internship");
    expect(employmentTypeFromText("Full-time product role")).toBe("full_time");
    expect(employmentTypeFromText("6 month contract")).toBe("contract");
    // "Internal" must not be mistaken for "intern".
    expect(employmentTypeFromText("Internal tooling team")).toBe("unknown");
  });

  it("derives experience level only from what the posting states", () => {
    expect(experienceLevelFromText("Data Analyst Intern", "")).toBe("student");
    expect(experienceLevelFromText("Software Engineer", "Recent graduates welcome")).toBe(
      "fresher",
    );
    expect(experienceLevelFromText("Backend Developer", "1-2 years of experience")).toBe(
      "1_2_years",
    );
    expect(experienceLevelFromText("Staff Engineer", "Own the platform end to end")).toBe(
      "unknown",
    );
    expect(experienceLevelFromText("Designer", "5-7 years of experience")).toBe("unknown");
  });
});

describe("compensation parsing (amount AND explicit period required)", () => {
  it("parses a monthly INR figure the source published", () => {
    const pay = parseCompensation("₹1,00,000 per month plus equity");
    expect(pay).toEqual({ min: 100_000, max: null, currency: "INR", period: "month" });
  });

  it("parses the Indian LPA convention as a yearly figure", () => {
    const pay = parseCompensation("CTC 8 LPA");
    expect(pay).toEqual({ min: 800_000, max: null, currency: "INR", period: "year" });
  });

  it("parses a published range", () => {
    const pay = parseCompensation("$120,000 - $150,000 per year");
    expect(pay).toEqual({ min: 120_000, max: 150_000, currency: "USD", period: "year" });
  });

  it("takes the currency from the figure's own label (live GBP case)", () => {
    // Regression: a Dropbox posting that mentions "years of experience"
    // BEFORE the pay range. An unanchored `rs` alternative used to match
    // inside "years" and mislabel the whole range as INR.
    const pay = parseCompensation(
      "Requirements: 8+ years of experience building distributed systems. " +
        "Compensation: United Kingdom Pay Range £91,400 — £123,600 GBP annual.",
    );
    expect(pay).toEqual({ min: 91_400, max: 123_600, currency: "GBP", period: "year" });
  });

  it("does not treat letters inside words as a currency token", () => {
    // "partners"/"years" contain "rs" but publish no currency label for the
    // amount → nothing honest to record.
    expect(
      parseCompensation("Shared with partners over years of service: 50000 annually"),
    ).toBeNull();
    // A genuine Rs. prefix still works (word boundary at the start only).
    expect(parseCompensation("Rs. 60,000 per month")).toEqual({
      min: 60_000,
      max: null,
      currency: "INR",
      period: "month",
    });
  });

  it("returns null without a period, without a currency, or without an amount", () => {
    expect(parseCompensation("Salary: 50000")).toBeNull();
    expect(parseCompensation("1000 per month")).toBeNull(); // no currency published
    expect(parseCompensation("Competitive salary per month")).toBeNull();
    expect(parseCompensation("")).toBeNull();
  });
});

describe("duration parsing (internship/contract only, explicit unit only)", () => {
  it("converts published units to days", () => {
    expect(parseDurationDays("6 month internship")).toBe(180);
    expect(parseDurationDays("3-month contract")).toBe(90);
    expect(parseDurationDays("6 week internship")).toBe(42);
    expect(parseDurationDays("duration: 10 days")).toBe(10);
  });

  it("returns null when no duration is published", () => {
    expect(parseDurationDays("Flexible hours, no fixed duration stated")).toBeNull();
    expect(parseDurationDays("This role lasts 2 weeks")).toBeNull(); // no trigger word
    expect(parseDurationDays("Data Analyst Intern")).toBeNull();
  });
});

describe("skill and role extraction", () => {
  it("extracts only exact word-boundary matches", () => {
    expect(extractSkills("Python and SQL required; Golang a plus")).toEqual([
      "Python",
      "SQL",
    ]);
    // Single-letter skills must not match ordinary prose.
    expect(extractSkills("We report weekly")).toEqual([]);
  });

  it("caps the skill list so huge descriptions stay bounded", () => {
    const text = Array.from({ length: 40 }, (_, i) => `skill${i}`).join(" ");
    const skills = extractSkills(
      `${text} Python Java SQL React AWS Docker Kubernetes Terraform Redis MongoDB GraphQL`,
    );
    expect(skills.length).toBeLessThanOrEqual(14);
  });

  it("derives role tags from the title", () => {
    expect(extractRoleTags("Senior Data Analyst")).toEqual(["Data Analyst"]);
    expect(extractRoleTags("Product Manager")).toEqual(["Product Manager"]);
    expect(extractRoleTags("Mystery Role")).toEqual([]);
  });
});

describe("description section parsing (only source-written headings count)", () => {
  const description = [
    "What you'll do",
    "- Build dashboards for the analytics team every week",
    "- Own the ETL pipelines from source to warehouse",
    "",
    "Qualifications",
    "- Python and SQL",
    "- 1-2 years of experience in a similar role",
    "",
    "Nice to have",
    "- Tableau",
    "",
    "Benefits",
    "- Health insurance",
  ].join("\n");

  it("collects each section under the heading the source wrote", () => {
    const sections = parseDescriptionSections(description);
    expect(sections.responsibilities).toHaveLength(2);
    expect(sections.responsibilities[0]).toContain("Build dashboards");
    expect(sections.required_skills).toEqual(expect.arrayContaining(["Python", "SQL"]));
    expect(sections.preferred_skills).toEqual(["Tableau"]);
    expect(sections.benefits).toEqual(["Health insurance"]);
    expect(sections.experience_text).toContain("1-2 years of experience");
  });

  it("does not attribute anything when the source wrote no headings", () => {
    const sections = parseDescriptionSections(
      "We build great products for ambitious teams. Come join us and ship.",
    );
    expect(sections.responsibilities).toEqual([]);
    expect(sections.required_skills).toEqual([]);
    expect(sections.preferred_skills).toEqual([]);
    expect(sections.benefits).toEqual([]);
    expect(sections.eligibility).toBe("");
  });

  it("never lists the same skill as both required and preferred", () => {
    const sections = parseDescriptionSections(
      ["Qualifications", "- Python", "", "Nice to have", "- Python and SQL"].join("\n"),
    );
    expect(sections.required_skills).toContain("Python");
    expect(sections.preferred_skills).not.toContain("Python");
    expect(sections.preferred_skills).toContain("SQL");
  });
});

describe("location splitting", () => {
  it("recognises an explicitly remote location", () => {
    const loc = splitLocation("Remote, United States");
    expect(loc.city).toBe("Remote");
    expect(loc.country).toBe("United States");
    expect(loc.work_model).toBe("remote");
  });

  it("keeps subdivision codes out of the country field", () => {
    const loc = splitLocation("New York, NY, USA");
    expect(loc.city).toBe("New York");
    expect(loc.country).toBe("USA");
    expect(loc.location_text).toBe("New York, NY, USA"); // verbatim, nothing lost
  });

  it("falls back to the source-provided country when only codes are published", () => {
    const loc = splitLocation("Bengaluru, KA", { country: "India" });
    expect(loc.city).toBe("Bengaluru");
    expect(loc.country).toBe("India");
  });

  it("never invents fields for an empty location", () => {
    const loc = splitLocation("");
    expect(loc).toEqual({ city: "", country: "", location_text: "", work_model: "onsite" });
  });
});

describe("date conversion", () => {
  it("accepts ISO strings and epoch millis", () => {
    expect(toIsoInstant("2026-11-01T10:00:00Z")).toBe("2026-11-01T10:00:00.000Z");
    expect(toIsoInstant(1_730_000_000_000)).toBe(new Date(1_730_000_000_000).toISOString());
    expect(toIsoDate("2026-11-01T10:00:00Z")).toBe("2026-11-01");
  });

  it("returns null for anything unparseable", () => {
    expect(toIsoInstant("not a date")).toBeNull();
    expect(toIsoInstant("")).toBeNull();
    expect(toIsoInstant(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });
});

describe("text helpers", () => {
  it("squashes whitespace for comparisons", () => {
    expect(squash("  a\n\tb  ")).toBe("a b");
  });

  it("produces stable, comparison-safe slugs", () => {
    expect(slug("Senior / Staff Engineer")).toBe("senior-staff-engineer");
    expect(slug("Café Analyst")).toBe("cafe-analyst");
    expect(slug("  ")).toBe("");
  });
});
