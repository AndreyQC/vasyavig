import {describe, expect, it} from "vitest";
import {
  bytesToBase64,
  detectImageMime,
  embedImage,
  EMAIL_IMAGE_LIMIT_BYTES,
} from "./images";

function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0x89;
  bytes[1] = 0x50; // P
  bytes[2] = 0x4e; // N
  bytes[3] = 0x47; // G
  return bytes;
}

describe("detectImageMime", () => {
  it("определяет png/jpeg/gif/webp по сигнатуре, а не по расширению", () => {
    expect(detectImageMime(pngBytes(16))).toBe("image/png");

    const jpeg = new Uint8Array(16);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    expect(detectImageMime(jpeg)).toBe("image/jpeg");

    const gif = new Uint8Array(16);
    gif.set(Uint8Array.from("GIF89a".split("").map((c) => c.charCodeAt(0))), 0);
    expect(detectImageMime(gif)).toBe("image/gif");

    const webp = new Uint8Array(16);
    webp.set(Uint8Array.from("RIFF".split("").map((c) => c.charCodeAt(0))), 0);
    webp.set(Uint8Array.from("WEBP".split("").map((c) => c.charCodeAt(0))), 8);
    expect(detectImageMime(webp)).toBe("image/webp");
  });

  it("неизвестный формат и слишком короткие данные — null", () => {
    expect(detectImageMime(Uint8Array.from("hello world!!!!".split("").map((c) => c.charCodeAt(0))))).toBeNull();
    expect(detectImageMime(new Uint8Array(4))).toBeNull();
  });
});

describe("bytesToBase64", () => {
  it("кодирует побайтово, в том числе длинные массивы", () => {
    expect(bytesToBase64(Uint8Array.from([104, 105]))).toBe(btoa("hi"));
    const big = new Uint8Array(70000).fill(7);
    const encoded = bytesToBase64(big);
    expect(encoded.length % 4).toBe(0);
    const decoded = atob(encoded);
    expect(decoded.length).toBe(big.length);
    expect(decoded.charCodeAt(0)).toBe(7);
    expect(decoded.charCodeAt(69999)).toBe(7);
  });
});

describe("embedImage", () => {
  const read = async (path: string) => (path === "missing.png" ? null : pngBytes(100));

  it("встраивает в рамках бюджета и возвращает data URI", async () => {
    const result = await embedImage("a.png", EMAIL_IMAGE_LIMIT_BYTES, read);
    expect(result.reason).toBe("embedded");
    expect(result.dataUri).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...pngBytes(100)))}`);
    expect(result.bytes).toBe(100);
  });

  it("исчерпанный бюджет — reason limit без чтения файла", async () => {
    const result = await embedImage("a.png", 0, read);
    expect(result.reason).toBe("limit");
    expect(result.dataUri).toBeNull();
  });

  it("файл больше оставшегося бюджета — reason limit", async () => {
    const result = await embedImage("a.png", 50, read);
    expect(result.reason).toBe("limit");
    expect(result.bytes).toBe(100);
  });

  it("нет файла — reason read", async () => {
    const result = await embedImage("missing.png", 1000, read);
    expect(result.reason).toBe("read");
  });
});
