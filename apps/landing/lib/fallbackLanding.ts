import type { LandingContent } from "./types";

export const FALLBACK_LANDING: LandingContent = {
  hero: {
    headline: "Capability intelligence for your organisation",
    subhead:
      "Align roles, competencies, and development in one place — from job profiles to starter packs and team insight.",
    ctaPrimary: "Get started",
    ctaSecondary: "Login",
  },
  value: {
    columns: [
      {
        title: "Role-grounded",
        body: "Competencies tie to job profiles so development stays relevant to real work.",
      },
      {
        title: "Shared taxonomy",
        body: "One org model for subjects, practices, and governance — with traceability you can trust.",
      },
      {
        title: "Faster adoption",
        body: "Reference starter packs help teams bootstrap without rebuilding everything from scratch.",
      },
    ],
  },
  howItWorks: {
    steps: [
      {
        title: "Define the model",
        body: "Set capability areas, subjects, and competencies aligned to your strategy.",
      },
      {
        title: "Assign & assess",
        body: "Map people to roles, track proficiency, and spot gaps with clarity.",
      },
      {
        title: "Develop & measure",
        body: "Run development goals and see progress across teams and time.",
      },
    ],
  },
  features: {
    items: [
      { title: "Job profiles & levels", body: "Structured roles with HR-aligned narratives." },
      { title: "Competency management", body: "Full lifecycle from draft to archive." },
      { title: "Starter packs", body: "Adopt curated reference content into your org." },
      { title: "Teams & reporting", body: "Organise membership and reporting lines." },
      { title: "Insights", body: "Team and industry signals to steer focus." },
      { title: "Reference library", body: "Platform-managed frameworks for admins." },
    ],
  },
  useCases: {
    items: [
      {
        title: "People leaders",
        body: "See capability coverage and prioritise development where it matters.",
      },
      {
        title: "Capability & HR",
        body: "Maintain a governed taxonomy without losing day-to-day agility.",
      },
      {
        title: "Individuals",
        body: "Understand expectations, close gaps, and grow toward the next role.",
      },
    ],
  },
  cta: {
    headline: "Ready to bring clarity to capability?",
    subhead: "Start with your workspace and invite your team when you are ready.",
  },
};
