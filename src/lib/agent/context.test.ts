import {describe, expect, it} from "vitest";
import type {AssistantContextSettings} from "./config";
import {buildContextPack, truncateByHeadings} from "./context";

function settings(patch: Partial<AssistantContextSettings> = {}): AssistantContextSettings {
  return {
    includeDocument: true,
    includeSelection: true,
    maxChars: 1000,
    chunking: "headings",
    ...patch,
  };
}

describe("truncateByHeadings", () => {
  it("не трогает текст в пределах лимита", () => {
    const result = truncateByHeadings("abc", 10);
    expect(result).toEqual({text: "abc", truncated: false});
  });

  it("обрезает по целым строкам и помечает omitted", () => {
    const text = ["# H", "", ...Array.from({length: 30}, (_, i) => `line ${i}`)].join("\n");
    const result = truncateByHeadings(text, 160);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[context truncated:");
    expect(result.text.startsWith("# H")).toBe(true);
  });

  it("жёстко режет, если даже первая строка не влезает", () => {
    const result = truncateByHeadings("x".repeat(500), 10);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("500 chars omitted");
  });
});

describe("buildContextPack", () => {
  it("включает документ и выделение в объём", () => {
    const pack = buildContextPack({
      docId: "doc-1",
      name: "a.md",
      content: "abc",
      selection: {text: "b", from: 3, to: 5},
      settings: settings(),
    });
    expect(pack.document).toMatchObject({content: "abc", originalChars: 3, truncated: false});
    expect(pack.selection).toMatchObject({text: "b", originalChars: 1, from: 3, to: 5});
    expect(pack.totalChars).toBe(4);
    expect(pack.maxChars).toBe(1000);
  });

  it("уважает include_document/include_selection", () => {
    const pack = buildContextPack({
      docId: "doc-1",
      name: "a.md",
      content: "abc",
      selection: {text: "b", from: 0, to: 1},
      settings: settings({includeDocument: false, includeSelection: false}),
    });
    expect(pack.document).toBeNull();
    expect(pack.selection).toBeNull();
    expect(pack.totalChars).toBe(0);
  });

  it("выделение обрезается остатком лимита", () => {
    const pack = buildContextPack({
      docId: "doc-1",
      name: "a.md",
      content: "x".repeat(1100),
      selection: {text: "y".repeat(500), from: 0, to: 500},
      settings: settings({maxChars: 1000}),
    });
    expect(pack.document?.truncated).toBe(true);
    expect(pack.selection?.truncated).toBe(true);
    expect(pack.totalChars).toBeLessThanOrEqual(1100);
  });
});
