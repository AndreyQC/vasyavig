import {describe, expect, it} from "vitest";
import {buildUlidHref, isUlidHref, parseUlidHref} from "./harnessUlidLink";

const ULID = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ANCHOR = "01M5B8R7MQJZKD1NMQ7M9KZ1F0";

describe("parseUlidHref", () => {
  it("ссылка на документ", () => {
    expect(parseUlidHref(`harness_ulid:${ULID}`)).toEqual({ulid: ULID});
  });

  it("ссылка на якорь внутри документа", () => {
    expect(parseUlidHref(`harness_ulid:${ULID}#${ANCHOR}`)).toEqual({ulid: ULID, anchor: ANCHOR});
  });

  it("legacy `ulid:` читается", () => {
    expect(parseUlidHref(`ulid:${ULID}`)).toEqual({ulid: ULID});
    expect(parseUlidHref(`ulid:${ULID}#${ANCHOR}`)).toEqual({ulid: ULID, anchor: ANCHOR});
  });

  it("нижний регистр нормализуется к верхнему", () => {
    expect(parseUlidHref(`harness_ulid:${ULID.toLowerCase()}`)).toEqual({ulid: ULID});
  });

  it("схема распознаётся без учёта регистра и пробелов", () => {
    expect(isUlidHref(` HARNESS_ULID:${ULID} `)).toBe(true);
    expect(parseUlidHref(` HARNESS_ULID:${ULID} `)).toEqual({ulid: ULID});
  });

  it("чужие схемы и пустые значения -> null", () => {
    expect(parseUlidHref("https://example.com")).toBeNull();
    expect(parseUlidHref("harness_ulid:")).toBeNull();
    expect(parseUlidHref(null)).toBeNull();
    expect(parseUlidHref(undefined)).toBeNull();
  });

  it("невалидный ULID или якорь -> null", () => {
    expect(parseUlidHref("harness_ulid:not-a-ulid")).toBeNull();
    expect(parseUlidHref(`harness_ulid:${ULID}#bad`)).toBeNull();
    // 26 символов, но таймстемп вне окна 2020-2100
    expect(parseUlidHref("harness_ulid:7ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBeNull();
  });
});

describe("buildUlidHref", () => {
  it("пишет новую схему harness_ulid:, а не legacy ulid:", () => {
    expect(buildUlidHref(ULID)).toBe(`harness_ulid:${ULID}`);
    expect(buildUlidHref(ULID, ANCHOR)).toBe(`harness_ulid:${ULID}#${ANCHOR}`);
    expect(buildUlidHref(ULID.toLowerCase())).toBe(`harness_ulid:${ULID}`);
  });
});
