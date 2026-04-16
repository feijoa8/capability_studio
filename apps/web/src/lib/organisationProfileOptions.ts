/** Canonical option labels for structured company profile fields (must match DB / AI prompts). */

export const KEY_DRIVER_OPTIONS = [
  "Growth",
  "Cost optimisation",
  "Innovation",
  "Compliance",
  "Customer experience",
  "Operational efficiency",
] as const;

export const DELIVERY_MODEL_OPTIONS = [
  "Agile Scrum",
  "Agile SAFe",
  "Waterfall",
  "Hybrid",
  "Product-led",
  "Project-led",
] as const;

export const ORGANISATION_STRUCTURE_OPTIONS = [
  "Functional",
  "Matrix",
  "Product-aligned",
  "Platform-based",
  "Project-based",
  "Hybrid",
] as const;

export const PRIMARY_CAPABILITY_AREA_OPTIONS = [
  "Product",
  "Technology",
  "Marketing",
  "Sales",
  "Service",
  "Operations",
  "Finance",
  "Legal / Risk",
  "People / HR",
  "Data / Analytics",
  "All",
] as const;

export const REGULATORY_INTENSITY_OPTIONS = [
  "Low",
  "Medium",
  "High",
  "Critical",
] as const;

export const ROLE_MODEL_BIAS_OPTIONS = [
  "Product-led",
  "Delivery-led",
  "Project-led",
  "Mixed",
] as const;
