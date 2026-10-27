import type { BotAvatarClipKind } from "@t3tools/contracts";

/**
 * The still candidates share one house style so a bot's avatar looks like it belongs beside the
 * others, whatever the user asked for. Four variants differ in pose and palette so there is a
 * real choice, not four near-copies.
 */
const STYLE =
  "Polished 3D render in a soft, rounded, toy-like style with smooth matte materials, subtle subsurface lighting and clean edges. Square composition, the subject centred and fully in frame with a little room around it, facing the camera, on a plain flat light-gray studio background with no text, no logo, no extra props beyond the requested description and no ground shadow beyond a soft contact shadow.";

const CANDIDATE_VARIANTS = [
  "Front-on, neutral friendly pose, balanced warm palette.",
  "Three-quarter view, slightly playful tilt, cooler palette with one accent colour.",
  "Front-on, compact and chunky proportions, pastel palette.",
  "Three-quarter view, calm and composed pose, richer saturated palette.",
] as const;

export function botAvatarCandidatePrompts(subject: string): ReadonlyArray<string> {
  const cleaned = subject
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。!]+$/, "");
  return CANDIDATE_VARIANTS.map(
    (variant) => `A character avatar of ${cleaned}. ${STYLE} ${variant}`,
  );
}

const SHARED_RULES =
  "Keep the exact same character from <IMAGE_1>: same identity, anatomy, proportions, materials, colours and style. Do not add limbs, eyes, ears, a mouth or text. Only add the props explicitly requested for this state; keep all other features unchanged. Adapt the action to the existing anatomy without inventing body parts. Locked-off camera, same framing, same lighting, same plain light-gray background. Restrained, physically plausible motion only. Start and end on the same active pose so the clip loops. Keep any state props present throughout; do not put them on or take them off during the clip. No sound, no speech.";

const CLIP_ACTIONS: Record<BotAvatarClipKind, string> = {
  idle: "The character stays almost still in the reference pose: a slow breath-sized rise and settle, and one unhurried blink only if it has eyes. No gestures, no looking around, no swaying.",
  working:
    "The character wears silver over-ear headphones in the style of AirPods Max and quietly types on a small keyboard resting in front of it, with small focused movements. If it has hands or paws they press keys; if it has no limbs the keyboard sits in front of it and keys press as if by its attention. Any existing head stays mostly still; any existing eyes look toward the keys. Fit the headphones to the silhouette without adding ears or a head.",
  call: "The character is already listening on a phone call: a generic smartphone is held vertically against the side of its existing head, touching an existing ear if it has one. Keep the phone there for the whole clip, never in front of the face and never looking at its screen. If the character cannot hold a phone, support it beside the character at an equivalent listening position without adding body parts. Mostly still, one small attentive movement suited to its existing anatomy at most. Nothing moves like speaking.",
};

export function botAvatarClipPrompt(kind: BotAvatarClipKind): string {
  return `${CLIP_ACTIONS[kind]} ${SHARED_RULES}`;
}

export function botAvatarImagePrompt(subject: string): string {
  const cleaned = subject
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。!]+$/, "");
  return `A character avatar of ${cleaned}. ${STYLE}`;
}
