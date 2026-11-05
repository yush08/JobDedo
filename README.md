# JobDedo

### Find jobs. Get noticed. Get hired.

**JobDedo** is an AI-powered job discovery and application assistant designed to simplify the job search journey. It brings job discovery, eligibility verification, resume analysis, application assistance, and application tracking into one unified platform.

Instead of switching between multiple job portals, spreadsheets, resume tools, and email drafts, JobDedo aims to help candidates manage their entire job search from a single place.

Built with an **India-first approach**, JobDedo focuses on helping students, fresh graduates, and job seekers discover relevant opportunities, understand their fit, and apply with confidence.

---

## What is JobDedo?

Finding a job is more than just searching for openings. Candidates need to identify relevant opportunities, verify whether they are eligible, tailor their resumes, communicate with recruiters, and keep track of applications.

JobDedo brings these activities together through an integrated workflow powered by automation, intelligent matching, and AI-assisted tools.

The goal is simple: make job searching more organized, transparent, and effective.

## Key Features

### 1. Smart Job Discovery

Discover job and internship opportunities from supported recruitment platforms and company career pages.

- Discover internships and full-time opportunities.
- Explore remote, hybrid, and on-site roles.
- Filter opportunities by location, role, experience, and other criteria.
- View job descriptions and application details.
- Save interesting opportunities for later.
- Reduce irrelevant listings through profile-based matching.

### 2. Job Verification and Eligibility

JobDedo aims to help users distinguish relevant opportunities from unsuitable or unverifiable listings.

- Identify the original job posting and its source.
- Preserve official company and application links separately.
- Evaluate location and applicant eligibility.
- Distinguish eligible, ineligible, and unknown opportunities.
- Surface relevant company and listing information.
- Help users make more informed application decisions.

### 3. Intelligent Job Matching

Understand how closely a job aligns with your skills, experience, education, and preferences.

- Compare job requirements with your profile.
- Identify matching skills and qualifications.
- Highlight missing or insufficiently supported requirements.
- Provide explanations behind job-match results.
- Help prioritize opportunities based on relevance.

### 4. Resume Studio

Create and manage resumes with a dedicated resume workspace.

- Upload existing PDF and DOCX resumes.
- Extract resume content into editable source material.
- Work with LaTeX-based resume content.
- Compile and preview PDF resumes.
- Maintain resume versions and compilation history.
- Restore previous versions when needed.

### 5. AI-Powered ATS Analyzer

Evaluate your resume against a specific job description.

The analyzer focuses on:

- **Document Quality:** Resume structure, readability, and formatting.
- **Job Coverage:** How well the resume covers the job requirements.
- **Evidence Alignment:** Whether the resume demonstrates the required skills through actual evidence.
- **Missing Keywords:** Important requirements not represented in the resume.
- **Improvement Suggestions:** Actionable recommendations to improve your resume.

The objective is not simply to insert keywords, but to help candidates communicate their actual qualifications more effectively.

### 6. Cold Email Assistant

Make professional recruiter outreach easier with AI-assisted email drafting.

- Extract relevant recruiter contact information when explicitly available.
- Analyze job descriptions and relevant resume details.
- Generate personalized outreach drafts.
- Suggest suitable email subjects and message content.
- Edit, regenerate, copy, and save drafts.
- Keep outreach grounded in the candidate's actual experience.

JobDedo is designed to assist with communication while keeping users in control of sending messages.

### 7. Application Tracking

Keep your job search organized with a centralized application tracker.

- Track saved and applied opportunities.
- Maintain application statuses.
- Record important application details.
- Monitor progress throughout the recruitment process.
- Keep your job search history organized.

### 8. Analytics and Insights

Get a clearer picture of your job search activity.

- Monitor application activity.
- Understand application trends.
- Track progress across opportunities.
- Review job search performance through a centralized dashboard.

---

## How JobDedo Works

```text
        YOUR PROFILE
             |
             v
      SMART JOB DISCOVERY
             |
             v
     JOB VERIFICATION
             |
             v
       JOB MATCHING
             |
       +-----+------+
       |            |
       v            v
  RESUME STUDIO  SAVE JOB
       |
       v
    ATS ANALYSIS
       |
       v
  COLD EMAIL ASSISTANT
       |
       v
 APPLICATION TRACKER
       |
       v
    ANALYTICS
```

JobDedo aims to connect every stage of the job search into one continuous workflow.

---

## Built for an India-First Job Market

JobDedo is designed with Indian students, fresh graduates, and job seekers in mind.

Its approach prioritizes:

- Internship and entry-level opportunities.
- Indian on-site and hybrid opportunities.
- Remote opportunities that explicitly accept applicants from India.
- Clear applicant eligibility information.
- Salary presentation with INR as the default currency.
- Access to opportunities from supported company career pages and recruitment platforms.

International remote opportunities can also be considered when applicants based in India are eligible.

---

## Technology Stack

| Category | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Backend | Next.js API Routes |
| Validation | Zod |
| Database | Supabase / PostgreSQL |
| Local Data | JSON-based local storage |
| AI & Analysis | AI-assisted workflows and deterministic analysis |
| Job Discovery | Greenhouse, Lever, Ashby integrations |
| Resume Processing | PDF, DOCX, LaTeX, Tectonic |
| Testing | Vitest, automated test suites |
| Development | Node.js, npm, Git, GitHub |

---

## Platform Architecture

JobDedo uses a modular architecture to organize its major capabilities.

- **Discovery:** Job sourcing, filtering, and opportunity management.
- **Verification:** Source information and eligibility evaluation.
- **Matching:** Profile-based job relevance and requirement analysis.
- **Resume Management:** Resume projects, versions, source content, and PDF compilation.
- **ATS Analysis:** Resume-to-job-description evaluation.
- **Outreach:** Recruiter information extraction and email drafting.
- **Application Management:** Application status and activity tracking.
- **Analytics:** Job search insights and performance metrics.

The platform is designed around a data-store abstraction that supports local development and Supabase-backed persistence.

---

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Node.js 20 or later
- npm
- Git

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/yush08/JobDedo.git
```

**2. Navigate to the project directory**

```bash
cd JobDedo
```

**3. Install dependencies**

```bash
npm install
```

**4. Configure environment variables**

Create a local environment file using the example configuration:

```bash
cp .env.example .env.local
```

Configure the required values for the services you intend to use.

**5. Start the development server**

```bash
npm run dev
```

**6. Open JobDedo**

Visit:

```text
http://localhost:3000
```

---

## Project Vision

JobDedo aims to evolve beyond a conventional job portal.

The long-term vision is to build a personal job-search assistant that understands a candidate's profile, discovers relevant opportunities, verifies eligibility, helps improve application materials, assists with recruiter communication, and organizes the entire application journey.

Rather than simply showing users hundreds of job listings, JobDedo aims to help them focus on opportunities that genuinely make sense for them.

**One platform. One organized workflow. A smarter way to get hired.**

---

## Contributing

Contributions, suggestions, and ideas are welcome.

If you are interested in improving job discovery, resume intelligence, application workflows, or the overall candidate experience, feel free to explore the project and contribute.

---

## License

See the repository for license information.
