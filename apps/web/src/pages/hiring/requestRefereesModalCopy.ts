/**
 * Static copy for the guided “Request referees” modal — no generation, no persistence.
 */

export const REQUEST_REFEREES_GUIDANCE = `Ask for two referees where you can — that usually gives a balanced view. One recent manager or senior stakeholder is especially helpful. Prioritise people who can speak to experience relevant to this role and how the candidate actually delivered work, not only tenure.`;

export const REQUEST_REFEREES_SUGGESTED_MESSAGE = `Thanks again for your time in our process.

As a next step, could you please share two referees who can speak to your recent work and experience that is most relevant to this role? Ideally, one would be a recent manager or senior stakeholder you’ve worked with directly.

We’ll follow up separately if we proceed to reference conversations.

Thanks,
[Your name]`;

export function requestRefereesCopyAllText(): string {
  return `Guidance\n${REQUEST_REFEREES_GUIDANCE}\n\nSuggested message\n${REQUEST_REFEREES_SUGGESTED_MESSAGE}`;
}
