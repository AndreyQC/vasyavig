/**
 * Тесты re-markup (Phase 8.5, T3b; план 20261105_003): скан репо, diff
 * (changed/missing/unknown-known), пересборка индекса.
 */

import {describe, expect, it} from "vitest";
import {
  diffEntitiesScan,
  listMarkdownFiles,
  scanMarkdownContents,
  scanRegistryForms,
  scanToIndexEntries,
} from "./entityScan";
import type {EntitiesIndexFile} from "./entitiesIndex";

const P = "01JBBCCCCDDDDDDDDDDDDDDDDD";
const O = "01JHKMMMMMMMMMMMMMMMMMMMMM";

const DOC_A = [
  "# Отчёт",
  `Поручено [Иванову И. И.](vas-entity:person:${P}) и [Ивановым И. И.](vas-entity:person:${P}).`,
  `[ООО Ромашка](vas-entity:org:${O}) заказчик.`,
  "",
  "```",
  `[мусор в коде](vas-entity:person:${P})`,
  "```",
].join("\n");

const index = (entries: Partial<EntitiesIndexFile["entries"][number]>[]): EntitiesIndexFile => ({
  path: "C:/repo/entities.jsonl",
  entries: entries.map((e) => ({
    ulid: "01JBBCCCCDDDDDDDDDDDDDDDDD",
    type: "person",
    canonical: "Иванову И. И.",
    forms: ["Иванову И. И."],
    ...e,
  })) as EntitiesIndexFile["entries"],
});

describe("listMarkdownFiles", () => {
  const tree = [
    {
      name: "repo", path: "C:/repo", isDir: true,
      children: [
        {name: "a.md", path: "C:/repo/a.md", isDir: false, children: null},
        {name: "node_modules", path: "C:/repo/node_modules", isDir: true, children: [
          {name: "x.md", path: "C:/repo/node_modules/x.md", isDir: false, children: null},
        ]},
        {name: ".hidden", path: "C:/repo/.hidden", isDir: true, children: [
          {name: "y.md", path: "C:/repo/.hidden/y.md", isDir: false, children: null},
        ]},
        {name: "sub", path: "C:/repo/sub", isDir: true, children: [
          {name: "b.md", path: "C:/repo/sub/b.md", isDir: false, children: null},
          {name: "c.txt", path: "C:/repo/sub/c.txt", isDir: false, children: null},
        ]},
      ],
    },
  ];

  it("только .md, скрытые и node_modules пропускаются", () => {
    expect(listMarkdownFiles(tree)).toEqual(["C:/repo/a.md", "C:/repo/sub/b.md"]);
  });
});

describe("scanMarkdownContents", () => {
  it("вхождения per-ULID; fenced-код пропущен", async () => {
    const scan = await scanMarkdownContents("C:/repo", [{path: "C:/repo/a.md", content: DOC_A}]);
    expect(scan.docs).toBe(1);
    expect(scan.byUlid.get(P)).toHaveLength(2); // код-блок не считается
    expect(scan.byUlid.get(O)).toHaveLength(1);
    expect(scan.byUlid.get(P)?.[0].value).toBe("Иванову И. И.");
  });
});

describe("diffEntitiesScan", () => {
  it("правка текста ссылки -> changed; ULID без вхождений -> missing", async () => {
    const scan = await scanMarkdownContents("C:/repo", [
      {path: "C:/repo/a.md", content: `Задача у [Иванов И. Иваныч](vas-entity:person:${P}).`},
    ]);
    const diff = diffEntitiesScan(scan, index([
      {ulid: P, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И."]},
      {ulid: O, type: "org", canonical: "ООО Ромашка", forms: ["ООО Ромашка"]},
    ]), [{path: "C:/repo/a.md", content: `Задача у [Иванов И. Иваныч](vas-entity:person:${P}).`}]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({ulid: P, value: "Иванов И. Иваныч", canonical: "Иванову И. И."});
    expect(diff.missing).toEqual([{ulid: O, type: "org", canonical: "ООО Ромашка"}]);
  });

  it("известная форма вне разметки -> unknown-known; внутри разметки — нет", async () => {
    const DOC = `Копия Иванову И. И. в тексте, а [Иванову И. И.](vas-entity:person:${P}) размечена.`;
    const scan = await scanMarkdownContents("C:/repo", [{path: "C:/repo/a.md", content: DOC}]);
    const diff = diffEntitiesScan(scan, index([
      {ulid: P, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И."]},
    ]), [{path: "C:/repo/a.md", content: DOC}]);
    expect(diff.unknownKnown).toHaveLength(1);
    expect(diff.unknownKnown[0]).toMatchObject({ulid: P, value: "Иванову И. И.", doc: "C:/repo/a.md"});
    expect(diff.changed).toHaveLength(0);
  });
});

describe("scanToIndexEntries (rebuild)", () => {
  it("canonical из старого индекса переживает пересборку; forms собираются", async () => {
    const scan = await scanMarkdownContents("C:/repo", [
      {path: "C:/repo/a.md", content: `[Иванову И. И.](vas-entity:person:${P}) и [Ивановым И. И.](vas-entity:person:${P})`},
    ]);
    const entries = scanToIndexEntries(scan, [
      {ulid: P, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И."]},
    ]);
    expect(entries).toEqual([
      {ulid: P, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И.", "Ивановым И. И."]},
    ]);
  });

  it("новый ULID без истории — canonical = первая форма", async () => {
    const scan = await scanMarkdownContents("C:/repo", [
      {path: "C:/repo/a.md", content: `[ООО Ромашка](vas-entity:org:${O})`},
    ]);
    const entries = scanToIndexEntries(scan, []);
    expect(entries).toEqual([{ulid: O, type: "org", canonical: "ООО Ромашка", forms: ["ООО Ромашка"]}]);
  });
});

describe("typeConflicts (T3e-1)", () => {
  it("один ULID с разными type в href — конфликт собран", async () => {
    const DOC =
      `[А](vas-entity:person:${P}) и [ООО Ромашка](vas-entity:org:${O}) и [Б](vas-entity:org:${P}).`;
    const scan = await scanMarkdownContents("C:/repo", [{path: "C:/repo/a.md", content: DOC}]);
    expect(scan.typeConflicts).toEqual([{ulid: P, types: ["org", "person"]}]);
    expect(scan.byUlid.get(P)).toHaveLength(2); // вхождения всё равно собираются
  });

  it("без конфликта — пусто; одинаковый тип в разных документах — не конфликт", async () => {
    const scan = await scanMarkdownContents("C:/repo", [
      {path: "C:/repo/a.md", content: `[А](vas-entity:person:${P})`},
      {path: "C:/repo/b.md", content: `[Б](vas-entity:person:${P}) [В](vas-entity:org:${O})`},
    ]);
    expect(scan.typeConflicts).toEqual([]);
  });
});

describe("scanRegistryForms (T6-6)", () => {
  const P1 = "01JBBCCCCDDDDDDDDDDDDDDDDD";
  const P2 = "01JHKNNNNNNNNNNNNNNNNNNNNN";
  const O1 = "01JHKMMMMMMMMMMMMMMMMMMMMM";
  const P3 = "01JHKPPPPPPPPPPPPPPPPPPPPP";

  const formsIndex: EntitiesIndexFile = {
    path: "C:/repo/entities.jsonl",
    entries: [
      {ulid: P1, type: "person", canonical: "Иванов И. И.", forms: ["Иванов И. И."]},
      {ulid: P2, type: "person", canonical: "Иванов Пётр", forms: ["Иванов И. И."]}, // общий форма-ключ
      {ulid: O1, type: "org", canonical: "АО Колос", forms: ["АО Колос"]},
      {ulid: P3, type: "person", canonical: "Забытый З. З.", forms: ["Забытый З. З."]},
    ],
  };

  const docWithSharedForm = `[Иванов И. И.](vas-entity:person:${P1}) и Иванов И. И. — разные?`;
  const docWithOrgText = "АО Колос упоминается текстом без якоря.";

  it("общая форма вне якоря → ambiguous; форма в тексте оживляет запись", () => {
    const diff = scanRegistryForms(
      [{path: "a.md", content: docWithSharedForm}, {path: "b.md", content: docWithOrgText}],
      formsIndex,
      {root: "C:/repo", docs: 2, byUlid: new Map([[P1, []]]), typeConflicts: []},
    );
    expect(diff.ambiguous).toHaveLength(1);
    expect(diff.ambiguous[0]).toMatchObject({value: "Иванов И. И.", type: "person"});
    expect(diff.ambiguous[0].ulids.sort()).toEqual([P1, P2].sort());
    expect(diff.ambiguous[0].occurrences[0].doc).toBe("a.md");
    // P1 — по якорю, P2 — по форме в тексте, O1 — по тексту, P3 — нигде
    expect(diff.unused.map((u) => u.ulid)).toEqual([P3]);
  });

  it("вхождение формы внутри якоря не считается неоднозначным", () => {
    const diff = scanRegistryForms(
      [{path: "a.md", content: `[Иванов И. И.](vas-entity:person:${P1})`}],
      formsIndex,
      {root: "C:/repo", docs: 1, byUlid: new Map(), typeConflicts: []},
    );
    // единственное вхождение формы — внутри конструкции якоря → вне разметки пусто
    expect(diff.ambiguous).toHaveLength(0);
  });

  it("D-8: форма только внутри fenced-кода → не ambiguous и не «оживляет» запись", () => {
    const diff = scanRegistryForms(
      [{path: "a.md", content: "текст без форм.\n\n```\nИванов И. И.\n```\n"}],
      formsIndex,
      {root: "C:/repo", docs: 1, byUlid: new Map(), typeConflicts: []},
    );
    expect(diff.ambiguous).toHaveLength(0); // фенс зачищен перед матчингом
    // ни одна запись не «оживлена» (форма была только во фенсе) → все в unused
    expect(diff.unused.map((u) => u.ulid).sort()).toEqual([O1, P1, P2, P3].sort());
  });

  it("пустой справочник → пустой diff", () => {
    const diff = scanRegistryForms([{path: "a.md", content: "текст"}], {path: "e", entries: []}, {root: "r", docs: 1, byUlid: new Map(), typeConflicts: []});
    expect(diff).toEqual({ambiguous: [], unused: []});
  });
});
