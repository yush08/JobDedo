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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PREFERRED_EMPLOYMENT_TYPES,
  PREFERRED_EXPERIENCE_LEVELS,
  WORK_MODELS,
} from "@/types";
import {
  preferencesPayloadSchema,
  type PreferencesPayload,
} from "@/lib/validation/schemas";
import { titleCase } from "@/lib/utils/format";
import type { ApiErrorBody } from "@/types";

type FormValues = z.input<typeof preferencesPayloadSchema>;

const EMPTY_ROLE = { role: "", is_custom: true, priority: 0 };

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

/** Toggle group for enum multi-selects (employment types, work models…). */
function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? value.filter((v) => v !== option)
                    : [...value, option],
                )
              }
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground hover:border-primary/40"
              }`}
            >
              {titleCase(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  min,
  max,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (next: number | null) => void;
  placeholder?: string;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  return (
    <Field label={suffix ? `${label} (${suffix})` : label}>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
    </Field>
  );
}

export function PreferencesForm({ initial }: { initial: FormValues }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues, unknown, PreferencesPayload>({
    resolver: zodResolver(preferencesPayloadSchema),
    defaultValues: initial,
    mode: "onBlur",
  });

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = form;

  const roles = useFieldArray({ control, name: "roles" });

  const prefs = watch("preferences");
  const setPref = <K extends keyof NonNullable<FormValues["preferences"]>>(
    key: K,
    value: NonNullable<FormValues["preferences"]>[K],
  ) =>
    setValue(`preferences.${key}` as never, value as never, {
      shouldDirty: true,
    });

  const listPref = (
    key:
      | "required_skills"
      | "preferred_technologies"
      | "industries"
      | "locations"
      | "excluded_companies"
      | "excluded_roles",
    label: string,
    placeholder: string,
    hint?: string,
  ) => {
    const value = (watch(`preferences.${key}`) ?? []) as string[];
    return (
      <Field label={label} hint={hint} error={errAt(errors as Record<string, unknown>, `preferences.${key}`)}>
        <StringListEditor
          value={value}
          onChange={(next) => setValue(`preferences.${key}`, next, { shouldDirty: true })}
          placeholder={placeholder}
        />
      </Field>
    );
  };

  const onSubmit = async (values: PreferencesPayload) => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as { ok: true } | ApiErrorBody;
      if (!res.ok || !("ok" in json)) {
        toast.error(
          "error" in json ? json.error.message : "Preferences could not be saved.",
        );
        return;
      }
      toast.success("Preferences saved", {
        description: "Discover rankings now use these preferences.",
      });
      router.refresh();
    } catch {
      toast.error("Could not reach the preferences endpoint.");
    } finally {
      setSaving(false);
    }
  };

  const renderError = (path: string) =>
    errAt(errors as Record<string, unknown>, path);

  return (
    <div>
      <PageHeader
        title="Preferences"
        description="Target roles, locations, work models and compensation used by the matching engine. Changes apply to future scoring — re-run a match to see them take effect."
        actions={
          <Button onClick={handleSubmit(onSubmit)} disabled={saving}>
            {saving ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            {saving ? "Saving…" : "Save preferences"}
          </Button>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Roles */}
        <Card className="card-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-sm font-semibold">
              <span>Target roles</span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {roles.fields.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Ordered by priority — the first role contributes most to your
              role-alignment score.
            </p>
            {roles.fields.length === 0 && (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                No target roles yet. Add at least one to improve matching.
              </p>
            )}
            {roles.fields.map((row, index) => (
              <div key={row.id} className="flex items-end gap-2">
                <Field
                  label={index === 0 ? "Role" : ""}
                  htmlFor={`role-${index}`}
                  error={renderError(`roles.${index}.role`)}
                  className="flex-1"
                >
                  <Input
                    id={`role-${index}`}
                    placeholder="Data Analyst"
                    {...register(`roles.${index}.role`)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mb-0.5 text-destructive"
                  aria-label={`Remove role ${index + 1}`}
                  onClick={() => roles.remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={roles.fields.length >= 30}
              onClick={() => roles.append({ ...EMPTY_ROLE, priority: roles.fields.length })}
            >
              <Plus aria-hidden />
              Add role
            </Button>
          </CardContent>
        </Card>

        {/* Opportunity type */}
        <Card className="card-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Opportunity type</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <ToggleGroup
              label="Employment types"
              options={PREFERRED_EMPLOYMENT_TYPES}
              value={prefs.employment_types ?? []}
              onChange={(next) => setPref("employment_types", next)}
            />
            <ToggleGroup
              label="Experience levels"
              options={PREFERRED_EXPERIENCE_LEVELS}
              value={prefs.experience_levels ?? []}
              onChange={(next) => setPref("experience_levels", next)}
            />
            <ToggleGroup
              label="Work models"
              options={WORK_MODELS}
              value={prefs.work_models ?? []}
              onChange={(next) => setPref("work_models", next)}
            />
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-3">
                <Label htmlFor="paid-only" className="text-sm">
                  Paid internships only
                </Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Hide listings without a published stipend.
                </p>
              </div>
              <Switch
                id="paid-only"
                checked={prefs.paid_internship_only}
                onCheckedChange={(checked) =>
                  setPref("paid_internship_only", checked === true)
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-3">
                <Label htmlFor="comp-flex" className="text-sm">
                  Compensation flexible
                </Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Don&apos;t penalise matches below your expected compensation.
                </p>
              </div>
              <Switch
                id="comp-flex"
                checked={prefs.compensation_flexible}
                onCheckedChange={(checked) =>
                  setPref("compensation_flexible", checked === true)
                }
              />
            </div>
            <NumberField
              label="Preferred internship duration"
              suffix="days"
              min={0}
              max={730}
              value={prefs.prefer_internship_duration_days ?? 60}
              onChange={(next) =>
                setPref("prefer_internship_duration_days", next ?? 60)
              }
            />
            <NumberField
              label="Search frequency"
              suffix="hours (1–168)"
              min={1}
              max={168}
              value={prefs.search_frequency_hours ?? 24}
              onChange={(next) => setPref("search_frequency_hours", next ?? 24)}
            />
          </CardContent>
        </Card>

        {/* Compensation */}
        <Card className="card-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Compensation & deadlines</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Minimum stipend"
              suffix="₹/month"
              min={0}
              value={prefs.min_stipend}
              onChange={(next) => setPref("min_stipend", next)}
            />
            <NumberField
              label="Minimum salary"
              suffix="₹/year"
              min={0}
              value={prefs.min_salary}
              onChange={(next) => setPref("min_salary", next)}
            />
            <NumberField
              label="Deadline within"
              suffix="days"
              min={1}
              max={365}
              value={prefs.application_deadline_within_days}
              onChange={(next) => setPref("application_deadline_within_days", next)}
            />
            <Field
              label="Company size"
              hint="Filter by headcount bucket."
              error={renderError("preferences.company_size")}
            >
              <Select
                value={prefs.company_size}
                onValueChange={(value) => value && setPref("company_size", value)}
              >
                <SelectTrigger className="w-full" aria-label="Company size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any size</SelectItem>
                  <SelectItem value="1-10">1–10</SelectItem>
                  <SelectItem value="11-50">11–50</SelectItem>
                  <SelectItem value="51-200">51–200</SelectItem>
                  <SelectItem value="201-500">201–500</SelectItem>
                  <SelectItem value="500+">500+</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* Skills & locations */}
        <Card className="card-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Skills, locations & exclusions
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {listPref("locations", "Preferred locations", "Bengaluru, Remote…")}
            {listPref("required_skills", "Must-have skills", "SQL, Python…", "Jobs missing these are flagged in the explanation.")}
            {listPref("preferred_technologies", "Preferred technologies", "Power BI, Tableau…")}
            {listPref("industries", "Industries", "FinTech, EdTech…")}
            {listPref("excluded_companies", "Excluded companies", "Company name…", "Never show jobs from these employers.")}
            {listPref("excluded_roles", "Excluded roles", "Role title…")}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            {saving ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </form>
    </div>
  );
}
