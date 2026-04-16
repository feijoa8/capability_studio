/**
 * Contextual AI refiner — bounded context in, structured suggestions out.
 * No chat history; no auto-apply from this package alone.
 */

export {
  REFINEMENT_MODES,
  type CategoryConfidence,
  type RefinementAccountContext,
  type RefinementConfidence,
  type RefinementContext,
  type RefinementContextBase,
  type RefinementEntityType,
  type RefinementFollowUpQuestion,
  type RefinementMode,
  type RefinementSuggestionPayload,
  type WorkExperienceRefinementPayload,
} from "./types";

export { buildWorkExperienceRefinementContext } from "./buildWorkExperienceContext";

export { ContextualRefinerShell } from "./ContextualRefinerShell";
export type { ContextualRefinerShellProps } from "./ContextualRefinerShell";

export { RefinementSuggestionPreview } from "./RefinementSuggestionPreview";
export { RefinementDeltaPreview } from "./RefinementDeltaPreview";
export {
  compareIndustry,
  compareTagArrays,
  descriptionsEffectivelyEqual,
  type IndustryDelta,
  type TagDelta,
} from "./refinementDelta";

export { WorkExperienceRefinerModal } from "./WorkExperienceRefinerModal";
export type { WorkExperienceRefinerModalProps } from "./WorkExperienceRefinerModal";

export { requestRefineEvidence } from "./refineEvidenceApi";
