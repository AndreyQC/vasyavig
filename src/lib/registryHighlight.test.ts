import {beforeEach, describe, expect, it, vi} from "vitest";
import {Schema} from "prosemirror-model";

const P1 = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const P2 = "01BBBBBBBBBBBBBBBBBBBBBBBB";
const P4 = "01DDDDDDDDDDDDDDDDDDDDDDDD";

vi.mock("../store/uiStore", () => {
  let enabled = true;
  return {
    useUiStore: {
      getState: () => ({registryHighlight: enabled}),
      subscribe: () => () => {},
      __setEnabled: (on: boolean) => {
        enabled = on;
      },
    },
  };
});

const {__setEnabled} = (await import("../store/uiStore")).useUiStore as unknown as {
  __setEnabled: (on: boolean) => void;
};

import {
  buildRegistryDecorations,
  compileRegistryForms,
  matchRegistryForms,
  MIN_FORM_LENGTH,
  resetRegistryCompiledCache,
  type RegistryCompiled,
} from "./registryHighlightExtension";
import {resetDeclensionCache} from "./agent/masking/declension";
import {DecorationSet} from "prosemirror-view";

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
  },
});

function docOf(...paragraphs: string[]) {
  return schema.node(
    "doc",
    null,
    paragraphs.map((text) => schema.node("paragraph", null, text ? schema.text(text) : undefined)),
  );
}

function docWithLinkPart(linkText: string, rest: string, href: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text(linkText, [schema.marks.link.create({href})]),
      schema.text(rest),
    ]),
  ]);
}

function decoInfos(set: DecorationSet) {
  // у Decoration поля type нет в публичных типах (рантайм-атрибуты инлайн-декорации)
  return set.find().map((d) => {
    const deco = d as unknown as {from: number; to: number; type: {attrs: Record<string, string>}};
    return {from: deco.from, to: deco.to, attrs: deco.type.attrs};
  });
}

const PERSON_FULL = {ulid: P1, type: "person", canonical: "Иванов Иван Иванович", forms: ["Иванов Иван Иванович"]};

function compiledOf(...entries: Array<{ulid: string; type: string; canonical: string; forms?: string[]; aliases?: string[]}>): RegistryCompiled {
  const compiled = compileRegistryForms(
    entries.map((e) => ({...e, forms: e.forms ?? [e.canonical], aliases: e.aliases ?? []})),
  );
  expect(compiled).not.toBeNull();
  return compiled as RegistryCompiled;
}

beforeEach(() => {
  resetRegistryCompiledCache();
  resetDeclensionCache();
  __setEnabled(true);
});

describe("compileRegistryForms / matchRegistryForms", () => {
  it("пустой справочник → null (подсвечивать нечего)", () => {
    expect(compileRegistryForms([])).toBeNull();
  });

  it(`формы короче ${MIN_FORM_LENGTH} отбрасываются (org не склоняется)`, () => {
    expect(compileRegistryForms([{ulid: P1, type: "org", canonical: "ОО", forms: ["ОО"]}])).toBeNull();
  });

  it("точка в форме экранируется: «г. Тула» матчится только литерально", () => {
    const compiled = compiledOf({ulid: P1, type: "loc", canonical: "г. Тула", forms: ["г. Тула"]});
    expect(matchRegistryForms("Прибыл в г. Тула вечером", compiled)).toHaveLength(1);
    expect(matchRegistryForms("Прибыл в гХ Тула", compiled)).toHaveLength(0);
  });

  it("границы слова: «Иванов» не внутри «Иванович»", () => {
    const compiled = compiledOf({ulid: P1, type: "person", canonical: "Иванов", forms: ["Иванов"]});
    expect(matchRegistryForms("Иванович", compiled)).toHaveLength(0);
    expect(matchRegistryForms("Ивановы", compiled)).toHaveLength(0);
    const standalone = matchRegistryForms("Иванов пришёл", compiled);
    expect(standalone).toHaveLength(1);
    expect(standalone[0].value).toBe("Иванов");
    expect(standalone[0].ulids).toEqual([P1]);
  });

  it("longest-first: полная ФИО важнее совпадающей по позиции короткой формы", () => {
    const compiled = compiledOf(
      PERSON_FULL,
      {ulid: P2, type: "person", canonical: "Иванов", forms: ["Иванов"]},
    );
    const matches = matchRegistryForms("Иванов Иван Иванович", compiled);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe("Иванов Иван Иванович");
    expect(matches[0].ulids).toEqual([P1]);
  });

  it("неоднозначная форма (однофамильцы-дубли): 2 ULID, ambiguous", () => {
    const compiled = compiledOf(
      {ulid: P2, type: "person", canonical: "Иванов", forms: ["Иванов"]},
      {ulid: P4, type: "person", canonical: "Иванов", forms: ["Иванов"]},
    );
    const matches = matchRegistryForms("Иванов", compiled);
    expect(matches).toHaveLength(1);
    expect(matches[0].ambiguous).toBe(true);
    expect(matches[0].ulids.sort()).toEqual([P2, P4].sort());
  });

  it("алиас матчится наравне с формами (T6-1)", () => {
    const compiled = compiledOf({
      ulid: P1,
      type: "person",
      canonical: "Иванов Иван Иваныч",
      forms: ["Иванов Иван Иваныч"],
      aliases: ["John Smith"],
    });
    const matches = matchRegistryForms("письмо от John Smith", compiled);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe("John Smith");
    expect(matches[0].ulids).toEqual([P1]);
  });
});

describe("buildRegistryDecorations", () => {
  it("вхождение в параграфе: позиция от блока + атрибуты чипа-подсказки", () => {
    const compiled = compiledOf(PERSON_FULL);
    const text = "Встреча с Ивановым И. И. завтра";
    const [deco] = decoInfos(buildRegistryDecorations(docOf(text), compiled));
    expect(deco.attrs.class).toBe("vas-registry-match");
    expect(deco.attrs["data-vas-registry-ulid"]).toBe(P1);
    expect(deco.attrs["data-vas-registry-ulids"]).toBe(P1);
    expect(deco.attrs["data-vas-type"]).toBe("person");
    expect(deco.from).toBe(1 + "Встреча с ".length);
    expect(deco.to).toBe(1 + "Встреча с ".length + "Ивановым И. И.".length);
  });

  it("код-блок не подсвечивается", () => {
    const compiled = compiledOf(PERSON_FULL);
    const doc = schema.node("doc", null, [schema.node("code_block", null, schema.text("Иванов Иван Иванович"))]);
    expect(buildRegistryDecorations(doc, compiled)).toBe(DecorationSet.empty);
  });

  it("текст link-марки пропускается, соседний неразмеченный — подсвечивается", () => {
    const compiled = compiledOf({ulid: P2, type: "person", canonical: "Иванов", forms: ["Иванов"]});
    const infos = decoInfos(buildRegistryDecorations(docWithLinkPart("Иванов", " и Иванов", "https://example.com"), compiled));
    expect(infos).toHaveLength(1);
    // смежные текст-узлы одного абзаца границы не создают: 1(open) + 6 + « и »
    expect(infos[0].from).toBe(1 + 6 + 3);
    expect(infos[0].to).toBe(infos[0].from + "Иванов".length);
  });

  it("неоднозначная форма → класс vas-registry-ambiguous", () => {
    const compiled = compiledOf(
      {ulid: P2, type: "person", canonical: "Иванов", forms: ["Иванов"]},
      {ulid: P4, type: "person", canonical: "Иванов", forms: ["Иванов"]},
    );
    const [deco] = decoInfos(buildRegistryDecorations(docOf("Иванов"), compiled));
    expect(deco.attrs.class).toBe("vas-registry-match vas-registry-ambiguous");
    expect(deco.attrs["data-vas-registry-ulids"]).toBe(`${P2},${P4}`);
  });

  it("флаг uiStore выключен → декораций нет", () => {
    __setEnabled(false);
    const compiled = compiledOf(PERSON_FULL);
    expect(buildRegistryDecorations(docOf("Иванов Иван Иванович"), compiled)).toBe(DecorationSet.empty);
  });

  it("compiled null (пустой справочник) → декораций нет", () => {
    expect(buildRegistryDecorations(docOf("Иванов Иван Иванович"), null)).toBe(DecorationSet.empty);
  });
});
