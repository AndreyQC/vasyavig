import {describe, expect, it, vi} from "vitest";
import {EditorState} from "@codemirror/state";

const ULID_A = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ULID_B = "01M43R3YYCBWXD01XW1RXPM575";
const ANCHOR = "01M5B8R7MQJZKD1NMQ7M9KZ1F0";

vi.mock("./i18n", () => ({
  default: {t: (key: string) => key},
}));

vi.mock("../store/harnessStore", () => ({
  useHarnessStore: {
    getState: () => ({
      resolveFor: (_dir: string, ulid: string) =>
        ulid === ULID_A
          ? {status: "found", repoRoot: "C:/repo", entry: {ulid, path: "a.md", title: "План А", type: "plan"}}
          : {status: "unknown"},
    }),
    subscribe: () => () => {},
  },
  openUlidTarget: vi.fn(),
}));

import {buildMarkupDecorations, findMarkupUlidRanges} from "./harnessUlidMarkupExtension";

function stateOf(text: string): EditorState {
  return EditorState.create({doc: text});
}

describe("findMarkupUlidRanges", () => {
  it("находит ссылку и якорь, диапазон — весь href-токен", () => {
    const text = `См. [файл](harness-ulid:${ULID_A}) и [раздел](harness-ulid:${ULID_A}#${ANCHOR}).`;
    const ranges = findMarkupUlidRanges(text);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ulid: ULID_A});
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe(`harness-ulid:${ULID_A}`);
    expect(ranges[1].anchor).toBe(ANCHOR);
    expect(text.slice(ranges[1].from, ranges[1].to)).toBe(`harness-ulid:${ULID_A}#${ANCHOR}`);
  });

  it("legacy `harness_ulid:` и `ulid:` тоже находятся", () => {
    const text = `[a](harness_ulid:${ULID_A}) [b](ulid:${ULID_A})`;
    expect(findMarkupUlidRanges(text).map((r) => r.ulid)).toEqual([ULID_A, ULID_A]);
  });

  it("невалидный ULID/таймстемп не подсвечивается", () => {
    expect(findMarkupUlidRanges("[a](harness-ulid:bad)")).toHaveLength(0);
    expect(findMarkupUlidRanges("[a](harness-ulid:7ZZZZZZZZZZZZZZZZZZZZZZZZZ)")).toHaveLength(0);
  });

  it("fenced-код-блок пропускается", () => {
    const text = [
      "```md",
      `[a](harness-ulid:${ULID_A})`,
      "```",
      `[b](harness-ulid:${ULID_A})`,
      "~~~",
      `[c](harness-ulid:${ULID_A})`,
      "~~~",
    ].join("\n");
    const ranges = findMarkupUlidRanges(text);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe(`harness-ulid:${ULID_A}`);
    // единственное вхождение вне блоков — строка [b]
    expect(text.indexOf("[b]", 0)).toBeLessThan(ranges[0].from);
  });

  it("обычный текст и голые ULID не трогаются", () => {
    expect(findMarkupUlidRanges(`голый ${ULID_A} без схемы`)).toHaveLength(0);
  });
});

function decoSpecs(text: string) {
  const state = stateOf(text);
  const set = buildMarkupDecorations(state, "C:/repo/_docs_");
  const specs: Array<{from: number; to: number; cls: string; attrs: Record<string, string>}> = [];
  set.between(0, state.doc.length, (from, to, value) => {
    const spec = (value as unknown as {spec: {class?: string; attributes?: Record<string, string>}}).spec;
    specs.push({from, to, cls: spec.class ?? "", attrs: spec.attributes ?? {}});
  });
  return specs;
}

describe("buildMarkupDecorations", () => {
  it("известный ULID -> ulid-link с data-ulid и aria-label", () => {
    const [spec] = decoSpecs(`[файл](harness-ulid:${ULID_A})`);
    expect(spec.cls).toBe("ulid-link");
    expect(spec.attrs["data-ulid"]).toBe(ULID_A);
    expect(spec.attrs["data-ulid-dir"]).toBe("C:/repo/_docs_");
    expect(spec.attrs["aria-label"]).toBe("План А · plan");
  });

  it("неизвестный -> ulid-unknown без data-ulid", () => {
    const [spec] = decoSpecs(`[файл](harness-ulid:${ULID_B})`);
    expect(spec.cls).toBe("ulid-unknown");
    expect(spec.attrs["data-ulid"]).toBeUndefined();
    expect(spec.attrs["data-ulid-unknown"]).toBe(ULID_B);
    expect(spec.attrs["aria-label"]).toBe("harness.ulidUnknownTooltip");
  });

  it("якорь -> data-anchor", () => {
    const [spec] = decoSpecs(`[раздел](harness-ulid:${ULID_A}#${ANCHOR})`);
    expect(spec.attrs["data-anchor"]).toBe(ANCHOR);
  });
});
