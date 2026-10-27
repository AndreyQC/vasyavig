// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import transform from "@diplodoc/transform";
import DOMPurify from "dompurify";
import {
  linkifyUlidLinksInElement,
  PREVIEW_SAFE_URI_RE,
  PREVIEW_TRANSFORM_OPTIONS,
} from "./previewLinks";

const ULID = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ANCHOR = "01M5B8R7MQJZKD1NMQ7M9KZ1F0";
const DIR = "C:/repo/_docs_";

const lookup = (ulid: string) =>
  ulid === ULID ? {title: "План А", type: "plan"} : null;

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  linkifyUlidLinksInElement(root, lookup, "нет в реестре", DIR);
  return root;
}

describe("linkifyUlidLinksInElement", () => {
  it("ссылка harness-ulid: -> data-ulid, href снят, класс ссылки", () => {
    const root = render(`<p><a href="harness-ulid:${ULID}">файл.md</a></p>`);
    const link = root.querySelector("a[data-ulid]");
    expect(link?.getAttribute("data-ulid")).toBe(ULID);
    expect(link?.getAttribute("href")).toBeNull();
    expect(link?.getAttribute("data-ulid-dir")).toBe(DIR);
    expect(link?.getAttribute("aria-label")).toBe("План А · plan");
    expect(link?.className).toBe("ulid-link");
    expect(link?.textContent).toBe("файл.md");
  });

  it("legacy `harness_ulid:` и `ulid:` тоже разбираются", () => {
    for (const scheme of ["harness_ulid:", "ulid:"]) {
      const root = render(`<p><a href="${scheme}${ULID}">файл.md</a></p>`);
      expect(root.querySelector("a[data-ulid]")?.getAttribute("data-ulid")).toBe(ULID);
    }
  });

  it("неизвестный ULID -> data-ulid-unknown без перехода", () => {
    const href = `harness-ulid:${ULID.slice(0, -1)}9`;
    const root = render(`<p><a href="${href}">файл.md</a></p>`);
    const link = root.querySelector("a[data-ulid-unknown]");
    expect(link?.getAttribute("data-ulid-unknown")).toBe(ULID.slice(0, -1) + "9");
    expect(link?.getAttribute("href")).toBeNull();
    expect(link?.getAttribute("aria-label")).toBe("нет в реестре");
    expect(link?.className).toBe("ulid-unknown");
  });

  it("якорь переезжает в data-anchor", () => {
    const root = render(`<p><a href="harness-ulid:${ULID}#${ANCHOR}">раздел</a></p>`);
    const link = root.querySelector("a[data-ulid]");
    expect(link?.getAttribute("data-ulid")).toBe(ULID);
    expect(link?.getAttribute("data-anchor")).toBe(ANCHOR);
  });

  it("обычные ссылки не трогаем", () => {
    const root = render(`<p><a href="https://example.com">внешняя</a></p>`);
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.hasAttribute("data-ulid")).toBe(false);
  });

  it("битый ULID остаётся обычной ссылкой", () => {
    const root = render(`<p><a href="harness-ulid:bad">x</a></p>`);
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("harness-ulid:bad");
    expect(link?.hasAttribute("data-ulid-unknown")).toBe(false);
  });
});

describe("превью: схемы URI", () => {
  it("transform сохраняет href `harness-ulid:` при allowedSchemes", () => {
    const {result} = transform(`[файл](harness-ulid:${ULID})`, PREVIEW_TRANSFORM_OPTIONS);
    expect(result.html).toContain(`href="harness-ulid:${ULID}"`);
  });

  it("transform по умолчанию вырезает href `harness-ulid:` (валидная схема)", () => {
    const {result} = transform(`[файл](harness-ulid:${ULID})`);
    expect(result.html).not.toContain("href=");
  });

  it("legacy `harness_ulid:` проходит как относительный путь, `ulid:` — нет", () => {
    const legacyInvalid = transform(`[файл](harness_ulid:${ULID})`);
    expect(legacyInvalid.result.html).toContain(`href="harness_ulid:${ULID}"`);
    const legacyUlid = transform(`[файл](ulid:${ULID})`);
    expect(legacyUlid.result.html).not.toContain("href=");
  });

  it("DOMPurify пропускает `harness-ulid:` и режет `javascript:`", () => {
    const sanitized = DOMPurify.sanitize(
      `<a href="harness-ulid:${ULID}">ok</a><a href="javascript:alert(1)">bad</a>`,
      {ALLOWED_URI_REGEXP: PREVIEW_SAFE_URI_RE},
    );
    expect(sanitized).toContain(`href="harness-ulid:${ULID}"`);
    expect(sanitized).not.toContain("javascript:");
  });
});
