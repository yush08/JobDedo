import { withErrorHandling } from "@/lib/api/responses";
import { randomUUID } from "node:crypto";

/**
 * POST /api/v1/outreach/extract — Email-based job extraction (M6).
 *
 * Contract when implemented:
 * - Accepts either a URL or pasted text describing an opportunity
 * - Extracts: job title, company, recipient email, CC, subject, instructions,
 *   required attachments, deadline, original posting URL, original platform,
 *   supporting evidence, extraction confidence
 * - Never guesses an email address
 * - Never bypasses LinkedIn login, CAPTCHA or anti-bot restrictions
 * - Distinguishes recruitment contacts from generic company addresses
 * - Returns a structured extraction result for draft generation
 * - Supports user-provided URLs and pasted text
 */
export const POST = withErrorHandling(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith("multipart/form-data") && !contentType.startsWith("application/json")) {
    return new Response(
      JSON.stringify({ error: "Expected multipart/form-data or application/json" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let data: any;

  if (contentType.startsWith("multipart/form-data")) {
    const formData = await request.formData();
    const input = formData.get("input") as string | null;
    const source = formData.get("source") as string | null; // "url" or "text"
    data = { input, source };
  } else {
    data = await request.json();
  }

  const { input, source } = data;

  if (!input || input.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: "No input provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Perform extraction based on source type
  let extraction: any;

  if (source === "url") {
    extraction = extractFromUrl(input);
  } else {
    extraction = extractFromText(input);
  }

  if (!extraction || extraction.confidence === 0) {
    return new Response(
      JSON.stringify({ error: "Could not extract job details from the provided input." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      extractionId: randomUUID(),
      extraction,
      // Frontend should display extracted fields for user confirmation
      // before proceeding to draft generation
      requiresConfirmation: true,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

/** Extract job details from a URL (public content only). */
function extractFromUrl(url: string): any {
  // In a production implementation, this would use authorized APIs only.
  // Never bypass login, CAPTCHA or anti-bot systems.
  // For now, return a structured result with low confidence
  // indicating that URL extraction is not yet fully implemented.
  return {
    jobTitle: "",
    company: "",
    recipientEmail: "",
    ccEmail: "",
    subject: "",
    instructions: "",
    requiredAttachments: [],
    deadline: null,
    originalUrl: url,
    originalPlatform: "unknown",
    supportingEvidence: "URL extraction not fully implemented — please paste job details instead.",
    confidence: 0.1,
  };
}

/** Extract job details from pasted text. */
function extractFromText(text: string): any {
  const lower = text.toLowerCase();

  // Try to identify basic fields from the text
  const jobTitle = identifyJobTitle(lower, text);
  const company = identifyCompany(lower, text);
  const recipientEmail = identifyRecipientEmail(text);
  const ccEmail = identifyCcEmail(text);
  const subject = identifySubject(lower, text);
  const instructions = identifyInstructions(lower, text);

  return {
    jobTitle,
    company,
    recipientEmail,
    ccEmail,
    subject,
    instructions,
    requiredAttachments: [],
    deadline: null,
    originalPlatform: "pasted_text",
    supportingEvidence: "Extracted from user-provided text.",
    confidence: recipientEmail ? 0.8 : 0.5,
  };
}

/** Identify job title from text. */
function identifyJobTitle(lower: string, text: string): string {
  // Look for common patterns
  const patterns = [
    /title:\s*([^\n\r]+)/i,
    /position:\s*([^\n\r]+)/i,
    /job:\s*([^\n\r]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  // Fallback: look for a line that looks like a title
  const lines = text.split("\n").filter((l) => l.length > 5 && l.length < 100);
  if (lines.length > 0) return lines[0].trim();
  return "";
}

/** Identify company from text. */
function identifyCompany(lower: string, text: string): string {
  const patterns = [
    /company:\s*([^\n\r]+)/i,
    /employer:\s*([^\n\r]+)/i,
    /at\s+([A-Z][A-Za-z0-9 .'-]+)(?:\n|$)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return "";
}

/** Identify recipient email from text. */
function identifyRecipientEmail(text: string): string {
  const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailMatch) {
    // Verify it looks like a recruitment contact, not a generic address
    const email = emailMatch[0];
    // Generic company addresses are not considered valid recruitment contacts
    const genericPatterns = ["info@", "hr@", "recruit@", "careers@", "jobs@"];
    for (const generic of genericPatterns) {
      if (email.startsWith(generic)) return ""; // Not a specific recruitment contact
    }
    return email;
  }
  return "";
}

/** Identify CC email from text. */
function identifyCcEmail(text: string): string {
  const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailMatch) {
    const email = emailMatch[0];
    const genericPatterns = ["info@", "hr@", "recruit@", "careers@", "jobs@"];
    for (const generic of genericPatterns) {
      if (email.startsWith(generic)) return "";
    }
    return email;
  }
  return "";
}

/** Identify subject from text. */
function identifySubject(lower: string, text: string): string {
  const patterns = [
    /subject:\s*([^\n\r]+)/i,
    /subject[:\s]+([^\n\r]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return "";
}

/** Identify instructions from text. */
function identifyInstructions(lower: string, text: string): string {
  const patterns = [
    /instructions:\s*([\s\S]+?)(?:\n\n|\n(?!.*instructions))/i,
    /instructions?[:\s]+([\s\S]+?)(?:\n\n|\n(?!.*instructions))/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim().substring(0, 500);
  }
  return "";
}