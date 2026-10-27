import {describe, expect, it, vi} from "vitest";
import {Schema} from "prosemirror-model";
import {DecorationSet} from "prosemirror-view";

const ULID_A = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ULID_B = "01M43R3YYCBWXD01XW1RXPM575";
const ANCHOR = "01M5B8R7MQJZKD1NMQ7M9KZ1F0";

vi.mock("../lib/i18n", () => ({
  default: {t: (key: string) => key},
}));

vi.mock("../store/harnessStore", () => ({
  // минимальный стаб стора: resolveFor детерминирован, подписка не нужна
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

import {buildUlidDecorations, harnessUlidExtension} from "./harnessUlidExtension";

const schema = new Schema({
  nodes: {
    doc: {content: "block+"},
    paragraph: {content: "text*", group: "block", toDOM: () => ["p", 0]},
    code_block: {
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      toDOM: () => ["pre", ["code", 0]],
    },
    text: {},
  },
  marks: {
    link: {
      attrs: {href: {}, title: {default: null}},
      toDOM: (mark) => ["a", {href: mark.attrs.href as string}, 0],
    },
    code: {
      toDOM: () => ["code", 0],
    },
  },
});

function docOf(...paragraphs: string[]) {
  return schema.node(
    "doc",
    null,
    paragraphs.map((text) => schema.node("paragraph", null, text ? schema.text(text) : undefined)),
  );
}

function docWithLink(text: string, href: string, extraMarks: string[] = []) {
  const marks = [schema.marks.link.create({href}), ...extraMarks.map((m) => schema.marks[m].create())];
  return schema.node("doc", null, [
    schema.node("paragraph", null, schema.text(text, marks)),
  ]);
}

function docWithCodeBlock(text: string) {
  return schema.node("doc", null, [schema.node("code_block", null, schema.text(text))]);
}

function docWithMark(text: string, markName: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, schema.text(text, [schema.marks[markName].create()])),
  ]);
}

function decoInfos(set: ReturnType<typeof buildUlidDecorations>) {
  // у Decoration поля type нет в публичных типах (рантайм-атрибуты инлайн-декорации)
  return set.find().map((d) => {
    const deco = d as unknown as {from: number; to: number; type: {attrs: Record<string, string>}};
    return {from: deco.from, to: deco.to, attrs: deco.type.attrs};
  });
}

describe("buildUlidDecorations", () => {
  it("известный ULID -> ulid-link с data-ulid и aria-label «title · type»", () => {
    const set = buildUlidDecorations(docOf(`см. ${ULID_A} далее`), "C:/repo/_docs_");
    const [deco] = decoInfos(set);
    expect(deco.attrs.class).toBe("ulid-link");
    expect(deco.attrs["data-ulid"]).toBe(ULID_A);
    expect(deco.attrs["data-ulid-dir"]).toBe("C:/repo/_docs_");
    expect(deco.attrs["aria-label"]).toBe("План А · plan");
    expect(deco.attrs.title).toBeUndefined();
    // текст параграфа начинается с pos+1: «см. » = 4 символа
    expect(deco.from).toBe(1 + 4);
    expect(deco.to).toBe(1 + 4 + 26);
  });

  it("неизвестный ULID -> ulid-unknown без data-ulid", () => {
    const [deco] = decoInfos(buildUlidDecorations(docOf(ULID_B), "C:/repo/_docs_"));
    expect(deco.attrs.class).toBe("ulid-unknown");
    expect(deco.attrs["aria-label"]).toBe("harness.ulidUnknownTooltip");
    expect(deco.attrs["data-ulid"]).toBeUndefined();
    expect(deco.attrs["data-ulid-unknown"]).toBe(ULID_B);
  });

  it("мусорные 26-символьные токены не декорируются", () => {
    expect(buildUlidDecorations(docOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "C:/repo")).toBe(DecorationSet.empty);
  });

  it("несколько параграфов: позиции от своего блока", () => {
    const infos = decoInfos(buildUlidDecorations(docOf("первый", `x ${ULID_A} y`, `z ${ULID_B}`), "C:/repo"));
    expect(infos).toHaveLength(2);
    // p1: open=0, текст 1..6, close=7; p2 open=8, текст с 9; «x »=2 -> ULID с 11
    expect(infos[0].from).toBe(1 + "первый".length + 1 /* close p1 */ + 1 /* open p2 */ + "x ".length);
    expect(infos[1].from).toBeGreaterThan(infos[0].to);
  });

  it("ссылка `[имя](ulid:…)` -> одна декорация на весь текст ссылки", () => {
    const text = "20261027_001_ulid_body_links_plan.md";
    const [deco] = decoInfos(buildUlidDecorations(docWithLink(text, `ulid:${ULID_A}`), "C:/repo"));
    expect(deco.attrs.class).toBe("ulid-link");
    expect(deco.attrs["data-ulid"]).toBe(ULID_A);
    expect(deco.from).toBe(1);
    expect(deco.to).toBe(1 + text.length);
  });

  it("ссылка с якорем -> data-anchor", () => {
    const [deco] = decoInfos(
      buildUlidDecorations(docWithLink("раздел", `ulid:${ULID_A}#${ANCHOR}`), "C:/repo"),
    );
    expect(deco.attrs["data-ulid"]).toBe(ULID_A);
    expect(deco.attrs["data-anchor"]).toBe(ANCHOR);
  });

  it("обычная ссылка: ULID в тексте не линкифицируется (нет вложенных ссылок)", () => {
    expect(buildUlidDecorations(docWithLink(ULID_A, "https://example.com"), "C:/repo")).toBe(
      DecorationSet.empty,
    );
  });

  it("код-блок не линкифицируется", () => {
    expect(buildUlidDecorations(docWithCodeBlock(ULID_A), "C:/repo")).toBe(DecorationSet.empty);
  });

  it("инлайн-код закладки остаётся кликабельным", () => {
    const [deco] = decoInfos(buildUlidDecorations(docWithMark(ULID_A, "code"), "C:/repo"));
    expect(deco.attrs.class).toBe("ulid-link");
  });
});

describe("harnessUlidExtension", () => {
  it("регистрирует один плагин в builder", () => {
    const factories: unknown[] = [];
    harnessUlidExtension("C:/repo/_docs_/a.md")({
      addPlugin: (factory: unknown) => {
        factories.push(factory);
      },
    } as unknown as Parameters<ReturnType<typeof harnessUlidExtension>>[0]);
    expect(factories).toHaveLength(1);
  });
});
