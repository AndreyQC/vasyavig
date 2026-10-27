import {describe, expect, it} from "vitest";
import {buildUlidHref, isUlidHref, parseUlidHref} from "./harnessUlidLink";

const ULID = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ANCHOR = "01M5B8R7MQJZKD1NMQ7M9KZ1F0";

describe("parseUlidHref", () => {
  it("ссылка на документ", () => {
    expect(parseUlidHref(`ulid:${ULID}`)).toEqual({ulid: ULID});
  });

  it("ссылка на якорь внутри документа", () => {
    expect(parseUlidHref(`ulid:${ULID}#${ANCHOR}`)).toEqual({ulid: ULID, anchor: ANCHOR});
  });

  it("нижний регистр нормализуется к верхнему", () => {
    expect(parseUlidHref(`ulid:${ULID.toLowerCase()}`)).toEqual({ulid: ULID});
  });

  it("схема распознаётся без учёта регистра и пробелов", () => {
    expect(isUlidHref(` ULID:${ULID} `)).toBe(true);
    expect(parseUlidHref(` ULID:${ULID} `)).toEqual({ulid: ULID});
  });

  it("чужие схемы и пустые значения -> null", () => {
    expect(parseUlidHref("https://example.com")).toBeNull();
    expect(parseUlidHref("ulid:")).toBeNull();
    expect(parseUlidHref(null)).toBeNull();
    expect(parseUlidHref(undefined)).toBeNull();
  });

  it("невалидный ULID или якорь -> null", () => {
    expect(parseUlidHref("ulid:not-a-ulid")).toBeNull();
    expect(parseUlidHref(`ulid:${ULID}#bad`)).toBeNull();
    // 26 символов, но таймстемп вне окна 2020-2100
    expect(parseUlidHref("ulid:7ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBeNull();
  });
});

describe("buildUlidHref", () => {
  it("собирает ссылку и якорь", () => {
    expect(buildUlidHref(ULID)).toBe(`ulid:${ULID}`);
    expect(buildUlidHref(ULID, ANCHOR)).toBe(`ulid:${ULID}#${ANCHOR}`);
    expect(buildUlidHref(ULID.toLowerCase())).toBe(`ulid:${ULID}`);
  });
});
