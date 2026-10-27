/**
 * Avatar clips must be silent, and Imagine muxes an AAC track even with no voice requested.
 * Rewriting the container would move `mdat` and break every `stco`/`co64` offset, so each audio
 * `trak` is renamed to `free` in place: same bytes, same offsets, and players see video only.
 */

const BOX_HEADER = 8;
const textDecoder = new TextDecoder("latin1");

interface Box {
  readonly type: string;
  readonly start: number;
  readonly headerSize: number;
  readonly end: number;
}

function readBoxes(bytes: Uint8Array, start: number, end: number): Array<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Array<Box> = [];
  let offset = start;
  while (offset + BOX_HEADER <= end) {
    let size = view.getUint32(offset);
    const type = textDecoder.decode(bytes.subarray(offset + 4, offset + 8));
    let headerSize = BOX_HEADER;
    if (size === 1) {
      if (offset + 16 > end) break;
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function trackHandler(bytes: Uint8Array, trak: Box): string | null {
  const mdia = readBoxes(bytes, trak.start + trak.headerSize, trak.end).find(
    (box) => box.type === "mdia",
  );
  if (!mdia) return null;
  const hdlr = readBoxes(bytes, mdia.start + mdia.headerSize, mdia.end).find(
    (box) => box.type === "hdlr",
  );
  if (!hdlr) return null;
  // hdlr: version/flags (4) + pre_defined (4) + handler_type (4)
  const handlerOffset = hdlr.start + hdlr.headerSize + 8;
  if (handlerOffset + 4 > hdlr.end) return null;
  return textDecoder.decode(bytes.subarray(handlerOffset, handlerOffset + 4));
}

export interface StrippedMp4 {
  readonly bytes: Uint8Array;
  readonly removedTracks: number;
  readonly videoTracks: number;
}

/** Returns a copy with every `soun` track neutralised, or the input unchanged when it has none. */
export function stripMp4AudioTracks(input: Uint8Array): StrippedMp4 {
  const bytes = new Uint8Array(input);
  let removedTracks = 0;
  let videoTracks = 0;
  for (const moov of readBoxes(bytes, 0, bytes.length).filter((box) => box.type === "moov")) {
    for (const trak of readBoxes(bytes, moov.start + moov.headerSize, moov.end)) {
      if (trak.type !== "trak") continue;
      const handler = trackHandler(bytes, trak);
      if (handler === "vide") videoTracks += 1;
      if (handler !== "soun") continue;
      bytes.set([0x66, 0x72, 0x65, 0x65], trak.start + 4); // "free"
      removedTracks += 1;
    }
  }
  return { bytes, removedTracks, videoTracks };
}

export function isMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && textDecoder.decode(bytes.subarray(4, 8)) === "ftyp";
}
