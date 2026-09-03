import {describe, expect, it} from "vitest";
import {
  isExternalSrc,
  resolveImageDisplayUrl,
  resolveLocalImagePath,
  toAssetUrl,
} from "./resolveImageSrc";

const BASE = "C:\\docs\\project";
const ROOT = "C:\\docs\\project";

describe("isExternalSrc", () => {
  it("внешние схемы и якоря", () => {
    expect(isExternalSrc("https://example.com/a.png")).toBe(true);
    expect(isExternalSrc("http://example.com/a.png")).toBe(true);
    expect(isExternalSrc("data:image/png;base64,AAAA")).toBe(true);
    expect(isExternalSrc("mailto:a@b.c")).toBe(true);
    expect(isExternalSrc("#якорь")).toBe(true);
  });

  it("локальные пути — не внешние (включая однокорневую C:)", () => {
    expect(isExternalSrc("img.png")).toBe(false);
    expect(isExternalSrc("./img.png")).toBe(false);
    expect(isExternalSrc("assets/img.png")).toBe(false);
    expect(isExternalSrc("C:\\img.png")).toBe(false);
    expect(isExternalSrc("C:/img.png")).toBe(false);
  });
});

describe("resolveLocalImagePath", () => {
  it("относительный путь склеивается с baseDir", () => {
    expect(resolveLocalImagePath("assets/img-0.png", BASE)).toBe(
      "C:\\docs\\project\\assets\\img-0.png",
    );
  });

  it("явные ./ и вложенные ../ нормализуются", () => {
    expect(resolveLocalImagePath("./a.png", BASE)).toBe("C:\\docs\\project\\a.png");
    expect(resolveLocalImagePath("../img.png", "C:\\docs\\project\\sub")).toBe(
      "C:\\docs\\project\\img.png",
    );
  });

  it("forward-слэши в src приводятся к сепаратору baseDir", () => {
    expect(resolveLocalImagePath("assets\\img.png", BASE)).toBe(
      "C:\\docs\\project\\assets\\img.png",
    );
  });

  it("кириллица raw и %-encoded", () => {
    expect(resolveLocalImagePath("изображения/рисунок 1.png", BASE)).toBe(
      "C:\\docs\\project\\изображения\\рисунок 1.png",
    );
    expect(resolveLocalImagePath("%D0%B8%D0%B7%D0%BE/cipher.png", BASE)).toBe(
      "C:\\docs\\project\\изо\\cipher.png",
    );
  });

  it("ASCII %-коды декодируются (URL-семантика, только для показа)", () => {
    expect(resolveLocalImagePath("my%20file.png", BASE)).toBe(
      "C:\\docs\\project\\my file.png",
    );
  });

  it("escape-артефакт anydoc \\_ снимается", () => {
    expect(resolveLocalImagePath("V2_ТЗ Total (1)\\_assets/img-0.png", BASE)).toBe(
      "C:\\docs\\project\\V2_ТЗ Total (1)_assets\\img-0.png",
    );
  });

  it("битая %-последовательность остаётся как есть", () => {
    expect(resolveLocalImagePath("a%D0b.png", BASE)).toBe("C:\\docs\\project\\a%D0b.png");
  });

  it("windows-абсолют возвращается как есть (сепараторы нормализуются)", () => {
    expect(resolveLocalImagePath("C:/data/pic.png", BASE)).toBe("C:\\data\\pic.png");
  });

  it("root-relative — от rootPath; без папки null", () => {
    expect(resolveLocalImagePath("/assets/logo.png", BASE, ROOT)).toBe(
      "C:\\docs\\project\\assets\\logo.png",
    );
    expect(resolveLocalImagePath("/assets/logo.png", BASE, null)).toBeNull();
    expect(resolveLocalImagePath("/assets/logo.png", BASE)).toBeNull();
  });

  it("внешние, якоря и пустые — null", () => {
    expect(resolveLocalImagePath("https://x/y.png", BASE)).toBeNull();
    expect(resolveLocalImagePath("data:image/png;base64,AA", BASE)).toBeNull();
    expect(resolveLocalImagePath("#intro", BASE)).toBeNull();
    expect(resolveLocalImagePath("", BASE)).toBeNull();
    expect(resolveLocalImagePath("   ", BASE)).toBeNull();
  });
});

describe("toAssetUrl / resolveImageDisplayUrl", () => {
  it("вне Tauri (vitest) toAssetUrl — identity", () => {
    expect(toAssetUrl("C:\\a\\b.png")).toBe("C:\\a\\b.png");
  });

  it("конвейер: резолвинг + identity-кодирование вне Tauri", () => {
    expect(resolveImageDisplayUrl("img.png", BASE)).toBe("C:\\docs\\project\\img.png");
    expect(resolveImageDisplayUrl("https://x/y.png", BASE)).toBeNull();
  });
});
