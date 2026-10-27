import { describe, expect, it } from "vite-plus/test";

import { isMp4, stripMp4AudioTracks } from "./BotAvatarMedia.ts";

const encoder = new TextEncoder();

function box(type: string, ...children: Array<Uint8Array>): Uint8Array {
  const size = children.reduce((total, child) => total + child.length, 8);
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(encoder.encode(type), 4);
  let offset = 8;
  for (const child of children) {
    bytes.set(child, offset);
    offset += child.length;
  }
  return bytes;
}

function hdlr(handler: string): Uint8Array {
  const body = new Uint8Array(8 + 4 + 12 + 1);
  body.set(encoder.encode(handler), 8);
  return box("hdlr", body);
}

function trak(handler: string): Uint8Array {
  return box(
    "trak",
    box("tkhd", new Uint8Array(84)),
    box("mdia", box("mdhd", new Uint8Array(24)), hdlr(handler)),
  );
}

function types(bytes: Uint8Array, start: number, end: number): Array<string> {
  const found: Array<string> = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = start; offset + 8 <= end;) {
    const size = view.getUint32(offset);
    if (size < 8) throw new Error(`bad box size at ${offset}`);
    found.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)));
    offset += size;
  }
  return found;
}

describe("stripMp4AudioTracks", () => {
  const ftyp = box("ftyp", encoder.encode("isom"));
  const moov = box("moov", box("mvhd", new Uint8Array(100)), trak("vide"), trak("soun"));
  const mdat = box("mdat", encoder.encode("samples-go-here"));
  const file = new Uint8Array([...ftyp, ...moov, ...mdat]);

  it("renames audio tracks to free boxes without moving any other byte", () => {
    const stripped = stripMp4AudioTracks(file);
    expect(stripped.removedTracks).toBe(1);
    expect(stripped.videoTracks).toBe(1);
    expect(stripped.bytes.length).toBe(file.length);
    const moovStart = ftyp.length;
    const moovEnd = ftyp.length + moov.length;
    expect(types(file, moovStart + 8, moovEnd)).toEqual(["mvhd", "trak", "trak"]);
    expect(types(stripped.bytes, moovStart + 8, moovEnd)).toEqual(["mvhd", "trak", "free"]);
    // mdat is untouched, so sample offsets stay valid.
    expect(stripped.bytes.subarray(moovEnd)).toEqual(mdat);
    // Only the type bytes of the audio track changed ("trak" and "free" share one letter).
    const diffs = [...file].flatMap((byte, index) =>
      byte === stripped.bytes[index] ? [] : [index],
    );
    expect(diffs.length).toBe(3);
  });

  it("leaves a video-only file as it is and reports no removal", () => {
    const silent = new Uint8Array([...ftyp, ...box("moov", trak("vide")), ...mdat]);
    const stripped = stripMp4AudioTracks(silent);
    expect(stripped.removedTracks).toBe(0);
    expect(stripped.bytes).toEqual(silent);
  });

  it("does not run past a truncated box", () => {
    const truncated = file.subarray(0, 40);
    expect(() => stripMp4AudioTracks(truncated)).not.toThrow();
    expect(isMp4(truncated)).toBe(true);
    expect(isMp4(encoder.encode("not a video"))).toBe(false);
  });
});
