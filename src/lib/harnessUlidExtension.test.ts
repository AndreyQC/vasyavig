import {describe, expect, it, vi} from "vitest";
import {Schema} from "prosemirror-model";

const ULID_A = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ULID_B = "01M43R3YYCBWXD01XW1RXPM575";

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
    doc: {content: "paragraph+"},
    paragraph: {content: "text*", toDOM: () => ["p", 0]},
    text: {},
  },
});

function docOf(...paragraphs: string[]) {
  return schema.node("doc", null, paragraphs.map((text) => schema.node("paragraph", null, text ? schema.text(text) : undefined)));
}

function decoInfos(set: ReturnType<typeof buildUlidDecorations>) {
  // у Decoration поля type нет в публичных типах (рантайм-атрибуты инлайн-декорации)
  return set.find().map((d) => {
    const deco = d as unknown as {from: number; to: number; type: {attrs: Record<string, string>}};
    return {from: deco.from, to: deco.to, attrs: deco.type.attrs};
  });
}

describe("buildUlidDecorations", () => {
  it("известный ULID -> ulid-link с data-ulid и title «title · type»", () => {
    const set = buildUlidDecorations(docOf(`см. ${ULID_A} далее`), "C:/repo/_docs_");
    const [deco] = decoInfos(set);
    expect(deco.attrs.class).toBe("ulid-link");
    expect(deco.attrs["data-ulid"]).toBe(ULID_A);
    expect(deco.attrs.title).toBe("План А · plan");
    // текст параграфа начинается с pos+1: «см. » = 4 символа
    expect(deco.from).toBe(1 + 4);
    expect(deco.to).toBe(1 + 4 + 26);
  });

  it("неизвестный ULID -> ulid-unknown без data-ulid", () => {
    const [deco] = decoInfos(buildUlidDecorations(docOf(ULID_B), "C:/repo/_docs_"));
    expect(deco.attrs.class).toBe("ulid-unknown");
    expect(deco.attrs.title).toBe("harness.ulidUnknownTooltip");
    expect(deco.attrs["data-ulid"]).toBeUndefined();
  });

  it("мусорные 26-символьные токены не декорируются", () => {
    expect(buildUlidDecorations(docOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "C:/repo")).toBe(DecorationSetEmpty);
  });

  it("несколько параграфов: позиции от своего блока", () => {
    const infos = decoInfos(buildUlidDecorations(docOf("первый", `x ${ULID_A} y`, `z ${ULID_B}`), "C:/repo"));
    expect(infos).toHaveLength(2);
    // p1: open=0, текст 1..6, close=7; p2 open=8, текст с 9; «x »=2 -> ULID с 11
    expect(infos[0].from).toBe(1 + "первый".length + 1 /* close p1 */ + 1 /* open p2 */ + "x ".length);
    expect(infos[1].from).toBeGreaterThan(infos[0].to);
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

import {DecorationSet} from "prosemirror-view";
const DecorationSetEmpty = DecorationSet.empty;
