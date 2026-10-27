import type { BotAvatarClipKind } from "@t3tools/contracts";

const STYLE =
  "Polished 3D render in a soft, rounded, toy-like style with smooth matte materials, subtle subsurface lighting and clean edges. Square composition, a close, straight-on portrait at eye level, with the face or main identifying feature centred in the upper half and filling most of the frame. Show the head and upper body rather than the whole body; for a character without a head, frame its identifying silhouette closely. Keep identifying features inside a circular crop with a small margin. The subject faces the camera, on a plain flat light-gray studio background with no text, no logo, no extra props beyond the requested description and no ground shadow beyond a soft contact shadow.";

const CANDIDATE_VARIANTS = [
  "Neutral friendly expression, balanced warm palette; preserve any colours explicitly requested.",
  "Slightly playful expression, cooler palette with one accent colour; preserve any colours explicitly requested.",
  "Compact and chunky proportions, soft pastel palette; preserve any colours explicitly requested.",
  "Calm and composed expression, richer palette; preserve any colours explicitly requested.",
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
  "Keep the exact same character from <IMAGE_1>: same identity, anatomy, proportions, materials, colours and style. Do not add limbs, eyes, ears, a mouth or text. Only add the props explicitly requested for this state; keep all other features unchanged. Adapt the action to the existing anatomy without inventing body parts. Use the composition specified for this state, even when it differs from the reference. Keep the camera completely fixed throughout the clip: no zoom, pan or orbit. Same soft studio lighting and plain flat light-gray background. The face or main identifying feature must stay large and readable in a 100-pixel circular avatar. Keep important features and props inside that circular crop. Restrained, physically plausible motion only. Start and end on the same active pose so the clip loops. Keep any state props present throughout; do not put them on or take them off during the clip. No sound, no speech.";

const CLIP_ACTIONS: Record<BotAvatarClipKind, string> = {
  idle: "Close, straight-on eye-level portrait matching the reference: head and upper body, or the equivalent identifying silhouette for a non-humanoid character. No full-body long shot. The character stays almost still in the reference pose: a slow breath-sized rise and settle, and one unhurried blink only if it has eyes. No gestures, no looking around, no swaying.",
  working:
    "A close three-quarter portrait of the character turned about 35 degrees toward the viewer’s right, seated at a small desk. The camera is at face height, with the character’s face in the upper centre-left, still large and visible. A small open laptop occupies the lower right, its screen facing the character; the desk edge crosses the bottom of the frame. Show only enough upper body and desk to make the action clear, never a distant full-body view. The character wears silver over-ear headphones in the style of AirPods Max and quietly types on the laptop keyboard with small alternating movements. If it has hands or paws they press keys; if it has no limbs the laptop sits in front of it and keys press as if by its attention. Any existing head stays mostly still; any existing eyes look toward the keys. Fit the headphones to the silhouette without adding ears or a head.",
  call: "Close, straight-on eye-level portrait with the same camera, scale and upper-body framing as idle. The character is already listening on a phone call: a generic smartphone is held vertically against the side of its existing head, touching an existing ear if it has one. Keep the phone there for the whole clip, never in front of the face and never looking at its screen. If the character cannot hold a phone, support it beside the character at an equivalent listening position without adding body parts. Mostly still, one small attentive movement suited to its existing anatomy at most. Nothing moves like speaking.",
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
