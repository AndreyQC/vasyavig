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
  it("ссылка ulid: -> data-ulid, href снят, класс ссылки", () => {
    const root = render(`<p><a href="ulid:${ULID}">файл.md</a></p>`);
    const link = root.querySelector("a[data-ulid]");
    expect(link?.getAttribute("data-ulid")).toBe(ULID);
    expect(link?.getAttribute("href")).toBeNull();
    expect(link?.getAttribute("data-ulid-dir")).toBe(DIR);
    expect(link?.getAttribute("aria-label")).toBe("План А · plan");
    expect(link?.className).toBe("ulid-link");
    expect(link?.textContent).toBe("файл.md");
  });

  it("неизвестный ULID -> data-ulid-unknown без перехода", () => {
    const href = `ulid:${ULID.slice(0, -1)}9`;
    const root = render(`<p><a href="${href}">файл.md</a></p>`);
    const link = root.querySelector("a[data-ulid-unknown]");
    expect(link?.getAttribute("data-ulid-unknown")).toBe(ULID.slice(0, -1) + "9");
    expect(link?.getAttribute("href")).toBeNull();
    expect(link?.getAttribute("aria-label")).toBe("нет в реестре");
    expect(link?.className).toBe("ulid-unknown");
  });

  it("якорь переезжает в data-anchor", () => {
    const root = render(`<p><a href="ulid:${ULID}#${ANCHOR}">раздел</a></p>`);
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

  it("битый ulid: остаётся обычной ссылкой", () => {
    const root = render(`<p><a href="ulid:bad">x</a></p>`);
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("ulid:bad");
    expect(link?.hasAttribute("data-ulid-unknown")).toBe(false);
  });
});

describe("превью: схемы URI", () => {
  it("transform сохраняет href `ulid:` при allowedSchemes", () => {
    const {result} = transform(`[файл](ulid:${ULID})`, PREVIEW_TRANSFORM_OPTIONS);
    expect(result.html).toContain(`href="ulid:${ULID}"`);
  });

  it("transform по умолчанию вырезает href `ulid:`", () => {
    const {result} = transform(`[файл](ulid:${ULID})`);
    expect(result.html).not.toContain("href=");
  });

  it("DOMPurify пропускает `ulid:` и режет `javascript:`", () => {
    const sanitized = DOMPurify.sanitize(
      `<a href="ulid:${ULID}">ok</a><a href="javascript:alert(1)">bad</a>`,
      {ALLOWED_URI_REGEXP: PREVIEW_SAFE_URI_RE},
    );
    expect(sanitized).toContain(`href="ulid:${ULID}"`);
    expect(sanitized).not.toContain("javascript:");
  });
});
