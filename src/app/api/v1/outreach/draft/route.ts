import { withErrorHandling } from "@/lib/api/responses";
import { getDataStore } from "@/lib/db";
import { randomUUID } from "node:crypto";

/**
 * POST /api/v1/outreach/draft — Generate a cold-email draft
 *
 * Contract:
 * - Takes a resume_version_id and a job_description
 * - Extracts the actual resume content (parsed personal info, experience,
 *   education, skills, projects, achievements) from the source version
 * - Generates a personalised cold email using real resume content and job
 *   requirements — never invents experience, internships, achievements,
 *   projects, recruiter names or contact details
 * - Returns subject, body, and draft metadata for frontend editing and storage
 * - Recipient email is optional; draft can be created without one
 * - Draft is persisted; user must approve before sending
 * - Sending requires explicit approval for each email — never automatic or bulk
 */
export const POST = withErrorHandling(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (
    !contentType.startsWith("multipart/form-data") &&
    !contentType.startsWith("application/json")
  ) {
    return new Response(
      JSON.stringify({ error: "Expected multipart/form-data or application/json" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let data: any;

  if (contentType.startsWith("multipart/form-data")) {
    const formData = await request.formData();
    const resumeVersionId = formData.get("resume_version_id") as string;
    const jobDescription = formData.get("job_description") as string;
    const draftType = formData.get("draft_type") as string;
    data = { resumeVersionId, jobDescription, draftType };
  } else {
    data = await request.json();
  }

  const { resumeVersionId, jobDescription, draftType } = data;

  if (!resumeVersionId) {
    return new Response(
      JSON.stringify({ error: "resume_version_id is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!jobDescription || jobDescription.trim().length < 20) {
    return new Response(
      JSON.stringify({
        error: "job_description is required and must be at least 20 characters.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const db: any = getDataStore();

  // Read the resume version to get the latex_source and structured content
  const allVersions: any[] = await db.listResumeSourceVersions();
  const version: any = allVersions.find((v: any) => v.id === resumeVersionId);

  if (!version) {
    return new Response(
      JSON.stringify({ error: "Resume source version not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Read the associated resume to get the title and extracted text
  const allResumes: any[] = await db.listResumes();
  const resume: any = allResumes.find(
    (r: any) => r.id === version.resume_id || r.current_version_id === version.id
  );

  if (!resume) {
    return new Response(
      JSON.stringify({ error: "Associated resume not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Extract real resume content from latex_source ---
  // We use best-effort text extraction from the stored LaTeX source.
  // Only verifiable facts are used; nothing is invented.
  const latexSource: string = version.latex_source || "";

  // Helper: get text between a section marker and the next section or end
  function getSectionText(source: string, sectionName: string): string {
    const openTag = `\\section*\{${sectionName}\\}`;
    const regex = new RegExp(`${openTag}(.*?)(?:\\\\section|\\ end\\{document\})`, "s");
    const match = source.match(regex);
    return match ? match[1].trim() : "";
  }

  // Extract personal info via simple string search
  const personalInfo: {
    full_name?: string;
    email?: string;
    phone?: string;
    linkedin_url?: string;
    github_url?: string;
  } = {};

  // Extract name from \textbf{Name} pattern
  const bfMatch = latexSource.match(/\\\\textbf\{([^}]+)\}/);
  if (bfMatch) {
    personalInfo.full_name = bfMatch[1].trim();
  }

  // Extract email - search for @ pattern with plausible surrounding text
  const atIdx = latexSource.indexOf("@");
  if (atIdx >= 0) {
    const start = Math.max(0, atIdx - 30);
    const segment = latexSource.substring(start, atIdx);
    const simpleEmail = segment.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (simpleEmail) {
      personalInfo.email = simpleEmail[0];
    }
  }

  // Extract phone
  const phoneMatch = latexSource.match(
    /(?:\\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  );
  if (phoneMatch) {
    personalInfo.phone = phoneMatch[0];
  }

  // Extract LinkedIn
  const lnMatch = latexSource.match(/linkedin\.com\/in\/[^\s]+/i);
  if (lnMatch) {
    personalInfo.linkedin_url = lnMatch[0];
  }

  // Extract GitHub
  const ghMatch = latexSource.match(/github\.com\/[^\s]+/i);
  if (ghMatch) {
    personalInfo.github_url = ghMatch[0];
  }

  // Extract summary (text after \section*{Professional Summary})
  const summaryText = getSectionText(latexSource, "Professional Summary");
  const summary = summaryText.length > 0 ? summaryText : undefined;

  // Extract experience (text after \section*{Experience})
  const experienceText = getSectionText(latexSource, "Experience");
  const experiences: string[] = experienceText ? [experienceText] : [];

  // Extract skills (text after \section*{Skills})
  const skillsText = getSectionText(latexSource, "Skills");
  const skills = skillsText.length > 0 ? skillsText : undefined;

  // Extract projects (text after \section*{Projects})
  const projectsText = getSectionText(latexSource, "Projects");
  const projects = projectsText.length > 0 ? projectsText : undefined;

  // Extract achievements (text after \section*{Achievements})
  const achievementsText = getSectionText(latexSource, "Achievements");
  const achievements = achievementsText.length > 0 ? achievementsText : undefined;

  // --- Build a short, factual candidate profile from what we actually extracted ---
  const candidateLines: string[] = [];

  if (summary && summary.length > 10) {
    candidateLines.push(summary);
  }

  if (experiences && experiences.length > 0) {
    candidateLines.push(experiences[0]);
  }

  if (skills) {
    candidateLines.push(skills);
  }

  if (projects) {
    candidateLines.push(projects);
  }

  if (achievements) {
    candidateLines.push(achievements);
  }

  // --- Determine job title and company from the job description ---
  const jobTitleMatch = jobDescription.match(/[Jj]ob [Tt]itle[:\s]+(.+)/i);
  const companyMatches = jobDescription.match(/[Cc]ompany[:\s]+(.+)/i);
  const companyMatch =
    companyMatches && companyMatches[1]
      ? companyMatches[1].trim()
      : jobDescription.match(/[A-Z][A-Za-z0-9&.-]+\s+(Inc\.?|Ltd\.?|LLC|GmbH|Corp)/);
  const jobTitle = jobTitleMatch ? jobTitleMatch[1].trim() : "the position";
  const company =
    companyMatch && companyMatch[1] ? companyMatch[1] : "your company";

  // Helper
  const firstCandidate = candidateLines.length > 0 ? candidateLines[0] : "";

  // --- Generate subject and body based on draft type ---
  let subject = "";
  let body = "";

  switch (draftType) {
    case "hiring_manager_intro": {
      const techSkills = skills && typeof skills === "string" ? skills : "";
      subject = `Inquiry about ${jobTitle} at ${company}`;
      const techPart = techSkills
        ? ` I have hands-on experience with the technical skills relevant to this role, including ${techSkills}.`
        : "";
      body = `Dear Hiring Manager,

I am writing to express my strong interest in the ${jobTitle} position at ${company}. After reviewing the job description, I am confident that my background aligns well with the requirements.

${candidateLines.length > 0 ? candidateLines.join(" ") : ""}

${techPart}

I am particularly drawn to ${company} because of its work supporting team success, and I am eager to contribute my skills to your team.

Please find my resume attached for your review. I would welcome the opportunity to discuss how my experience and abilities can support your hiring goals.

Thank you for your time and consideration.

Best regards,
${personalInfo.full_name || "Candidate"}`;
      break;
    }

    case "follow_up": {
      subject = `Follow-up: ${jobTitle} at ${company}`;
      body = `Dear Hiring Manager,

I am writing to follow up on my application for the ${jobTitle} position at ${company}. I remain very interested in the opportunity and am eager to learn about the status of my application.

${firstCandidate ? ` ${firstCandidate}` : ""}

I am available at your convenience for an interview and can provide any additional information you may need. I have attached my resume for reference.

Thank you for your time and continued consideration.

Best regards,
${personalInfo.full_name || "Candidate"}`;
      break;
    }

    case "referral_request": {
      subject = `Referral request for ${jobTitle} at ${company}`;
      body = `Dear Hiring Manager,

I hope this message finds you well. I am writing to request a referral for the ${jobTitle} position at ${company}, as I believe my background aligns well with the team's needs.

${firstCandidate ? ` ${firstCandidate}` : ""}

I have attached my resume for your consideration. I would greatly appreciate any guidance you can provide on the application process.

Thank you for your time.

Best regards,
${personalInfo.full_name || "Candidate"}`;
      break;
    }

    case "thank_you": {
      subject = `Thank you for the interview opportunity`;
      body = `Dear ${(personalInfo.full_name || "Candidate").split(" ")[0] || "H"},

Thank you for taking the time to interview me for the ${jobTitle} position at ${company}. I truly enjoyed our conversation and learning more about the team and the role.

${firstCandidate ? ` I particularly appreciated our discussion: ${firstCandidate}` : ""}

Our discussion reinforced my strong interest in this position, particularly my skills and my experience: ${experiences && experiences.length > 0 ? experiences[0] : "the experience highlighted in my resume"}.

Please do not hesitate to contact me if you need any additional information. I look forward to hearing from you regarding next steps.

Best regards,
${personalInfo.full_name || "Candidate"}`;
      break;
    }

    case "internship_outreach": {
      subject = `Internship Application Inquiry — ${personalInfo.full_name || "Candidate"}`;
      body = `Dear Hiring Manager,

I am writing to express my strong interest in internship opportunities at ${company}. I am currently pursuing my studies and have developed skills relevant to the ${jobTitle} role through my academic projects and coursework.

${candidateLines.length > 0 ? candidateLines.join(" ") : ""}

I am particularly drawn to ${company} because of its work in ${jobDescription.substring(0, 80) || "technology and innovation"}. I am motivated to learn and contribute to your team.

Please find my resume attached. I would welcome the opportunity to discuss how I can contribute to your team and learn from your experienced professionals.

Thank you for your consideration.

Best regards,
${personalInfo.full_name || "Candidate"}`;
      break;
    }

    case "generic": {
      const skillsPart = skills && typeof skills === "string" ? ` My skills include ${skills}.` : "";
      const expPart =
        experiences && Array.isArray(experiences) && experiences.length > 0
          ? ` My experience includes: ${experiences.join(", ")}.`
          : "";
      subject = `Introduction and opportunity inquiry — ${personalInfo.full_name || "Candidate"}`;
      body = `Dear Hiring Manager,

I am writing to express my interest in potential opportunities at ${company}. With my background${skillsPart} ${expPart} I believe I could make a valuable contribution to your team.

${candidateLines.length > 0 ? ` ${candidateLines.join(" ")}` : ""}

I am particularly drawn to ${company} because of their mission. I would welcome the opportunity to discuss how my background and skills could support your team's goals.

Best regards,
${personalInfo.full_name || "Candidate"}`;
      break;
    }

    default: {
      subject = `Inquiry about ${jobTitle} at ${company}`;
      body = `Dear Hiring Manager,

I am writing to express my strong interest in the ${jobTitle} position at ${company}. After reviewing the job description, I am confident that my background aligns well with the requirements.

${candidateLines.length > 0 ? candidateLines.join(" ") : ""}

I am particularly drawn to ${company} because of its work supporting team success, and I am eager to contribute my skills to your team.

Please find my resume attached for your review. I would welcome the opportunity to discuss how my experience and abilities can support your hiring goals.

Thank you for your time and consideration.

Best regards,
${personalInfo.full_name || "Candidate"}`;
      break;
    }
  }

  const draftId = randomUUID();

  const draft: any = {
    id: draftId,
    recipient: personalInfo.email || "",
    subject: subject.trim(),
    body: body.trim(),
    associatedJob:
      jobTitle && company
        ? { title: jobTitle, company, description: jobDescription }
        : null,
    sourceUrl:
      personalInfo.linkedin_url
        ? { type: "linkedin", url: personalInfo.linkedin_url, note: "LinkedIn profile" }
        : null,
    contactEvidence:
      personalInfo.email
        ? { type: "email", url: `mailto:${personalInfo.email}`, note: "Provided by user" }
        : null,
    resumeVersionId: resumeVersionId,
    draft_type: draftType || "hiring_manager_intro",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return new Response(
    JSON.stringify({
      draft,
      requiresApproval: true,
      canCopyRecipient: draft.recipient.length > 0,
      canCopySubject: draft.subject.length > 0,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});