import {
  BOT_AVATAR_MAX_BYTES,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type BotAvatarImage,
} from "@t3tools/contracts";

import { estimateBase64ByteSize } from "../../lib/base64";
import { pickComposerImages } from "../../lib/composerImages";

const AVATAR_PHOTO_SIZE = 256;

/**
 * Picks one photo through the composer's picker, which already handles permissions, iCloud
 * downloads and HEIC, then crops it to a centered square small enough to stay far under the cap.
 * Resolves null when the user cancels.
 */
export async function pickBotAvatarPhoto(): Promise<BotAvatarImage | null> {
  const picked = await pickComposerImages({
    existingCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1,
  });
  const image = picked.images[0];
  if (!image) {
    if (picked.error) throw new Error(picked.error);
    return null;
  }
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
  const source = await ImageManipulator.manipulate(image.previewUri).renderAsync();
  try {
    const side = Math.min(source.width, source.height);
    const size = Math.min(AVATAR_PHOTO_SIZE, side);
    const squared = await ImageManipulator.manipulate(source)
      .crop({
        originX: Math.floor((source.width - side) / 2),
        originY: Math.floor((source.height - side) / 2),
        width: side,
        height: side,
      })
      .resize({ width: size, height: size })
      .renderAsync();
    try {
      const saved = await squared.saveAsync({ format: SaveFormat.PNG, base64: true });
      if (!saved.base64) throw new Error("That photo couldn’t be read.");
      if (estimateBase64ByteSize(saved.base64) > BOT_AVATAR_MAX_BYTES) {
        throw new Error("That photo is too large. Use one up to 2 MB.");
      }
      return { mimeType: "image/png", dataUrl: `data:image/png;base64,${saved.base64}` };
    } finally {
      squared.release();
    }
  } finally {
    source.release();
  }
}
