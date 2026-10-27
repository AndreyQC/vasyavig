import {describe, expect, it} from "vitest";
import {buildUlidHref, isUlidHref, parseUlidHref} from "./harnessUlidLink";

const ULID = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ANCHOR = "01M5B8R7MQJZKD1NMQ7M9KZ1F0";

describe("parseUlidHref", () => {
  it("ссылка на документ", () => {
    expect(parseUlidHref(`harness-ulid:${ULID}`)).toEqual({ulid: ULID});
  });

  it("ссылка на якорь внутри документа", () => {
    expect(parseUlidHref(`harness-ulid:${ULID}#${ANCHOR}`)).toEqual({ulid: ULID, anchor: ANCHOR});
  });

  it("legacy `harness_ulid:` и `ulid:` читаются", () => {
    for (const scheme of ["harness_ulid:", "ulid:"]) {
      expect(parseUlidHref(`${scheme}${ULID}`)).toEqual({ulid: ULID});
      expect(parseUlidHref(`${scheme}${ULID}#${ANCHOR}`)).toEqual({ulid: ULID, anchor: ANCHOR});
    }
  });

  it("нижний регистр нормализуется к верхнему", () => {
    expect(parseUlidHref(`harness-ulid:${ULID.toLowerCase()}`)).toEqual({ulid: ULID});
  });

  it("схема распознаётся без учёта регистра и пробелов", () => {
    expect(isUlidHref(` HARNESS-ULID:${ULID} `)).toBe(true);
    expect(parseUlidHref(` HARNESS-ULID:${ULID} `)).toEqual({ulid: ULID});
  });

  it("чужие схемы и пустые значения -> null", () => {
    expect(parseUlidHref("https://example.com")).toBeNull();
    expect(parseUlidHref("harness-ulid:")).toBeNull();
    expect(parseUlidHref(null)).toBeNull();
    expect(parseUlidHref(undefined)).toBeNull();
  });

  it("невалидный ULID или якорь -> null", () => {
    expect(parseUlidHref("harness-ulid:not-a-ulid")).toBeNull();
    expect(parseUlidHref(`harness-ulid:${ULID}#bad`)).toBeNull();
    // 26 символов, но таймстемп вне окна 2020-2100
    expect(parseUlidHref("harness-ulid:7ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBeNull();
  });
});

describe("buildUlidHref", () => {
  it("пишет валидную схему harness-ulid:, а не legacy", () => {
    expect(buildUlidHref(ULID)).toBe(`harness-ulid:${ULID}`);
    expect(buildUlidHref(ULID, ANCHOR)).toBe(`harness-ulid:${ULID}#${ANCHOR}`);
    expect(buildUlidHref(ULID.toLowerCase())).toBe(`harness-ulid:${ULID}`);
  });
});
