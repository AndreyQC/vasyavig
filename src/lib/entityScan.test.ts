/**
 * Тесты re-markup (Phase 8.5, T3b; план 20261105_003): скан репо, diff
 * (changed/missing/unknown-known), пересборка индекса.
 */

import {describe, expect, it} from "vitest";
import {
  diffEntitiesScan,
  listMarkdownFiles,
  scanMarkdownContents,
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
