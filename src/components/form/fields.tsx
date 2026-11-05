"use client";

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Labelled form field with error slot. Every input in JobDedo's forms goes
 * through this so spacing, labels and error messaging stay consistent.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && !error && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Editable string list (skills, coursework, technologies…).
 * Values are stored as `string[]`; the input splits on commas/Enter.
 */
export function StringListEditor({
  id,
  value,
  onChange,
  placeholder,
  label,
  error,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  label?: string;
  error?: string;
}) {
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange([...value, ...parts.filter((p) => !value.includes(p))]);
  };

  const input = (
    <Input
      id={id}
      type="text"
      placeholder={placeholder ?? "Type and press Enter"}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const target = event.currentTarget;
          add(target.value);
          target.value = "";
        }
      }}
      onBlur={(event) => {
        if (event.currentTarget.value.trim()) {
          add(event.currentTarget.value);
          event.currentTarget.value = "";
        }
      }}
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
      )}
      {input}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
