import {describe, expect, it} from "vitest";
import {nextDiagramId, normalizeMermaidError} from "./mermaidRenderer";

describe("nextDiagramId", () => {
  it("уникален в пределах одной миллисекунды", () => {
    const ids = new Set(Array.from({length: 100}, (_, i) => nextDiagramId(12345, i)));
    expect(ids.size).toBe(100);
  });

  it("различается по времени", () => {
    expect(nextDiagramId(1, 0)).not.toBe(nextDiagramId(2, 0));
  });
});

describe("normalizeMermaidError", () => {
  it("Error -> message", () => {
    expect(normalizeMermaidError(new Error("Parse error on line 2"))).toBe("Parse error on line 2");
  });

  it("строка -> как есть", () => {
    expect(normalizeMermaidError("unknown diagram type")).toBe("unknown diagram type");
  });

  it("прочее -> generic, пустой message -> generic", () => {
    expect(normalizeMermaidError({weird: true})).toBe("diagram render failed");
    expect(normalizeMermaidError(new Error(""))).toBe("diagram render failed");
    expect(normalizeMermaidError(null)).toBe("diagram render failed");
  });
});
