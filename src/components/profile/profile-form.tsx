"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { Field, StringListEditor } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { profileSchema, type ProfileInput } from "@/lib/validation/schemas";
import { SKILL_CATEGORIES } from "@/types";
import { titleCase } from "@/lib/utils/format";
import type { ApiErrorBody } from "@/types";

type FormValues = z.input<typeof profileSchema>;

/**
 * Minimal structural view of `useFieldArray`'s return so six arrays with
 * different item shapes can live in one record.
 */
type ListSection = {
  fields: { id: string }[];
  append: (value: never) => void;
  remove: (index: number) => void;
};

type SectionKey =
  | "education"
  | "skills"
  | "projects"
  | "experiences"
  | "leadership"
  | "certifications";

/** Pull a nested error message out of RHF's error tree by dotted path. */
function errAt(
  errors: Record<string, unknown>,
  path: string,
): string | undefined {
  let node: unknown = errors;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (node && typeof node === "object" && "message" in node) {
    const message = (node as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

const EMPTY_EDUCATION = {
  id: "",
  profile_id: "",
  institution: "",
  degree: "",
  branch: "",
  start_date: "",
  graduation_date: "",
  cgpa: "",
  coursework: [] as string[],
  sort_order: 0,
};

const EMPTY_SKILL = {
  id: "",
  profile_id: "",
  category: "programming_languages" as const,
  name: "",
  level: "intermediate" as const,
  years: null,
};

const EMPTY_PROJECT = {
  id: "",
  profile_id: "",
  title: "",
  description: "",
  technologies: [] as string[],
  responsibilities: [] as string[],
  achievements: [] as string[],
  metrics: "",
  github_url: "",
  live_demo_url: "",
  sort_order: 0,
};

const EMPTY_EXPERIENCE = {
  id: "",
  profile_id: "",
  organization: "",
  role: "",
  start_date: "",
  end_date: "",
  responsibilities: [] as string[],
  achievements: [] as string[],
  sort_order: 0,
};

const EMPTY_LEADERSHIP = {
  id: "",
  profile_id: "",
  organization: "",
  position: "",
  start_date: "",
  end_date: "",
  contributions: [] as string[],
  sort_order: 0,
};

const EMPTY_CERTIFICATION = {
  id: "",
  profile_id: "",
  name: "",
  issuer: "",
  issued_date: "",
  credential_url: "",
  sort_order: 0,
};

const SECTION_META: Record<
  SectionKey,
  { title: string; empty: string; addLabel: string }
> = {
  education: {
    title: "Education",
    empty: "No education entries yet.",
    addLabel: "Add education",
  },
  skills: {
    title: "Skills",
    empty: "No skills yet — add the ones you can evidence in projects.",
    addLabel: "Add skill",
  },
  projects: {
    title: "Projects",
    empty: "No projects yet. Projects drive your match score.",
    addLabel: "Add project",
  },
  experiences: {
    title: "Work experience",
    empty: "No work experience yet — internships and freelance count.",
    addLabel: "Add experience",
  },
  leadership: {
    title: "Leadership & achievements",
    empty: "No leadership or achievement entries yet.",
    addLabel: "Add entry",
  },
  certifications: {
    title: "Certifications",
    empty: "No certifications yet.",
    addLabel: "Add certification",
  },
};

export function ProfileForm({ initial }: { initial: FormValues }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues, unknown, ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: initial,
    mode: "onBlur",
  });

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty },
    watch,
    setValue,
  } = form;

  const education = useFieldArray({ control, name: "education" });
  const skills = useFieldArray({ control, name: "skills" });
  const projects = useFieldArray({ control, name: "projects" });
  const experiences = useFieldArray({ control, name: "experiences" });
  const leadership = useFieldArray({ control, name: "leadership" });
  const certifications = useFieldArray({ control, name: "certifications" });

  const arrays: Record<SectionKey, ListSection> = {
    education,
    skills,
    projects,
    experiences,
    leadership,
    certifications,
  };

  const onSubmit = async (values: ProfileInput) => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as { ok: true } | ApiErrorBody;
      if (!res.ok || !("ok" in json)) {
        const message =
          "error" in json
            ? json.error.message
            : "Profile could not be saved.";
        toast.error(message);
        return;
      }
      toast.success("Profile saved", {
        description: "Matching and verification now use this data.",
      });
      router.refresh();
    } catch {
      toast.error("Could not reach the profile endpoint.");
    } finally {
      setSaving(false);
    }
  };

  const renderError = (path: string) => errAt(errors as Record<string, unknown>, path);

  const listSection = (key: SectionKey) => {
    const meta = SECTION_META[key];
    const field = arrays[key];
    return (
      <TabsContent key={key} value={key} className="mt-4">
        <Card className="card-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-sm font-semibold">
              <span>{meta.title}</span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {field.fields.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {field.fields.length === 0 && (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                {meta.empty}
              </p>
            )}

            {field.fields.map((row, index) => (
              <div
                key={row.id}
                className="space-y-3 rounded-lg border p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    #{index + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => field.remove(index)}
                    aria-label={`Remove entry ${index + 1}`}
                  >
                    <Trash2 aria-hidden />
                    Remove
                  </Button>
                </div>
                <SectionFields
                  section={key}
                  index={index}
                  register={register}
                  errors={errors as Record<string, unknown>}
                  watch={watch}
                  setValue={setValue}
                />
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => field.append(emptyRowFor(key) as never)}
            >
              <Plus aria-hidden />
              {meta.addLabel}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    );
  };

  return (
    <div>
      <PageHeader
        title="My Profile"
        description="The single source of truth for matching, resume tailoring and outreach. JobDedo never invents profile data — it only uses what you enter here."
        actions={
          <form onSubmit={handleSubmit(onSubmit)} className="flex items-center gap-2">
            {isDirty && (
              <span className="text-xs text-warning">Unsaved changes</span>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Save aria-hidden />
              )}
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </form>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Tabs defaultValue="personal">
          <TabsList className="flex-wrap">
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="education">Education</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="experiences">Experience</TabsTrigger>
            <TabsTrigger value="leadership">Leadership</TabsTrigger>
            <TabsTrigger value="certifications">Certifications</TabsTrigger>
          </TabsList>

          {/* ---------------- Personal ---------------- */}
          <TabsContent value="personal" className="mt-4">
            <Card className="card-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  Personal details
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="pf-full-name" error={renderError("personal.full_name")}>
                  <Input id="pf-full-name" {...register("personal.full_name")} />
                </Field>
                <Field label="Email" htmlFor="pf-email" error={renderError("personal.email")}>
                  <Input id="pf-email" type="email" {...register("personal.email")} />
                </Field>
                <Field label="Phone" htmlFor="pf-phone" error={renderError("personal.phone")}>
                  <Input id="pf-phone" {...register("personal.phone")} />
                </Field>
                <Field label="City" htmlFor="pf-city" error={renderError("personal.city")}>
                  <Input id="pf-city" {...register("personal.city")} />
                </Field>
                <Field label="Country" htmlFor="pf-country" error={renderError("personal.country")}>
                  <Input id="pf-country" {...register("personal.country")} />
                </Field>
                <Field
                  label="Headline"
                  htmlFor="pf-headline"
                  hint="One line shown at the top of your profile."
                  error={renderError("personal.headline")}
                  className="sm:col-span-2"
                >
                  <Input
                    id="pf-headline"
                    placeholder="Data Analyst · SQL, Python, dashboards"
                    {...register("personal.headline")}
                  />
                </Field>
                <Field
                  label="Summary"
                  htmlFor="pf-summary"
                  hint="Used for matching. Keep it factual — AI may later shorten it, never embellish it."
                  error={renderError("personal.summary")}
                  className="sm:col-span-2"
                >
                  <Textarea id="pf-summary" rows={4} {...register("personal.summary")} />
                </Field>
                <Field label="LinkedIn URL" htmlFor="pf-linkedin" error={renderError("personal.linkedin_url")}>
                  <Input id="pf-linkedin" placeholder="https://linkedin.com/in/…" {...register("personal.linkedin_url")} />
                </Field>
                <Field label="GitHub URL" htmlFor="pf-github" error={renderError("personal.github_url")}>
                  <Input id="pf-github" placeholder="https://github.com/…" {...register("personal.github_url")} />
                </Field>
                <Field label="Portfolio URL" htmlFor="pf-portfolio" error={renderError("personal.portfolio_url")}>
                  <Input id="pf-portfolio" placeholder="https://…" {...register("personal.portfolio_url")} />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          {listSection("education")}
          {listSection("skills")}
          {listSection("projects")}
          {listSection("experiences")}
          {listSection("leadership")}
          {listSection("certifications")}

          <div className="mt-6 flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Save aria-hidden />
              )}
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </Tabs>
      </form>
    </div>
  );
}

function emptyRowFor(section: SectionKey): Record<string, unknown> {
  switch (section) {
    case "education":
      return { ...EMPTY_EDUCATION };
    case "skills":
      return { ...EMPTY_SKILL };
    case "projects":
      return { ...EMPTY_PROJECT };
    case "experiences":
      return { ...EMPTY_EXPERIENCE };
    case "leadership":
      return { ...EMPTY_LEADERSHIP };
    case "certifications":
      return { ...EMPTY_CERTIFICATION };
  }
}

/** Field grid for one repeatable-section row. */
function SectionFields({
  section,
  index,
  register,
  errors,
  watch,
  setValue,
}: {
  section: SectionKey;
  index: number;
  register: ReturnType<typeof useForm<FormValues, unknown, ProfileInput>>["register"];
  errors: Record<string, unknown>;
  watch: ReturnType<typeof useForm<FormValues, unknown, ProfileInput>>["watch"];
  setValue: ReturnType<typeof useForm<FormValues, unknown, ProfileInput>>["setValue"];
}) {
  const at = (field: string) => errAt(errors, `${section}.${index}.${field}`);
  const base = `${section}.${index}` as const;

  const listField = (
    name: "coursework" | "technologies" | "responsibilities" | "achievements" | "contributions",
    label: string,
    placeholder: string,
  ) => {
    const path = `${base}.${name}`;
    const value = (watch(path as never) ?? []) as string[];
    return (
      <Field label={label} error={at(name)} className="sm:col-span-2">
        <StringListEditor
          value={value}
          onChange={(next) => setValue(path as never, next as never, { shouldDirty: true })}
          placeholder={placeholder}
        />
      </Field>
    );
  };

  const text = (
    name: string,
    label: string,
    props: { type?: string; placeholder?: string } = {},
  ) => (
    <Field label={label} htmlFor={`${base}-${name}`} error={at(name)}>
      <Input
        id={`${base}-${name}`}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        {...register(`${base}.${name}` as never)}
      />
    </Field>
  );

  switch (section) {
    case "education":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("institution", "Institution")}
          {text("degree", "Degree")}
          {text("branch", "Specialization / branch")}
          {text("cgpa", "CGPA / GPA", { placeholder: "8.4" })}
          {text("start_date", "Start date", { type: "date" })}
          {text("graduation_date", "Graduation date", { type: "date" })}
          {listField("coursework", "Relevant coursework", "SQL, Statistics…")}
        </div>
      );
    case "skills":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Skill" htmlFor={`${base}-name`} error={at("name")}>
            <Input id={`${base}-name`} placeholder="Python" {...register(`${base}.name` as never)} />
          </Field>
          <Field label="Category" error={at("category")}>
            <Select
              value={String(watch(`${base}.category` as never) ?? "")}
              onValueChange={(value) => {
                if (value) setValue(`${base}.category` as never, value as never, { shouldDirty: true });
              }}
            >
              <SelectTrigger className="w-full" aria-label="Skill category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SKILL_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {titleCase(category)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Level" error={at("level")}>
            <Select
              value={String(watch(`${base}.level` as never) ?? "")}
              onValueChange={(value) => {
                if (value) setValue(`${base}.level` as never, value as never, { shouldDirty: true });
              }}
            >
              <SelectTrigger className="w-full" aria-label="Skill level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Years (optional)" htmlFor={`${base}-years`} error={at("years")}>
            <Input
              id={`${base}-years`}
              type="number"
              min={0}
              max={60}
              step="0.5"
              {...register(`${base}.years` as never, { valueAsNumber: true })}
            />
          </Field>
        </div>
      );
    case "projects":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("title", "Project title")}
          {text("metrics", "Metrics", { placeholder: "Reduced load time by 40%" })}
          <Field label="Description" htmlFor={`${base}-description`} error={at("description")} className="sm:col-span-2">
            <Textarea id={`${base}-description`} rows={3} {...register(`${base}.description` as never)} />
          </Field>
          {listField("technologies", "Technologies", "React, Node.js…")}
          {listField("responsibilities", "Responsibilities", "Built the API layer…")}
          {listField("achievements", "Achievements", "Won college hackathon…")}
          {text("github_url", "GitHub URL", { placeholder: "https://github.com/…" })}
          {text("live_demo_url", "Live demo URL", { placeholder: "https://…" })}
        </div>
      );
    case "experiences":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("organization", "Organization")}
          {text("role", "Role")}
          {text("start_date", "Start date", { type: "date" })}
          {text("end_date", "End date (blank = current)", { type: "date" })}
          {listField("responsibilities", "Responsibilities", "Automated weekly reports…")}
          {listField("achievements", "Achievements", "Cut manual work by 5 hours/week…")}
        </div>
      );
    case "leadership":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("organization", "Organization / event")}
          {text("position", "Position")}
          {text("start_date", "Start date", { type: "date" })}
          {text("end_date", "End date", { type: "date" })}
          {listField("contributions", "Contributions", "Led a team of 8…")}
        </div>
      );
    case "certifications":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("name", "Certification name")}
          {text("issuer", "Issuer")}
          {text("issued_date", "Issued date", { type: "date" })}
          {text("credential_url", "Credential URL", { placeholder: "https://…" })}
        </div>
      );
  }
}
