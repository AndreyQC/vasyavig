import {describe, expect, it} from "vitest";
import {blockAt, markdownBlocks} from "./entityContext";
import {matchesOfForm, resolveRegistryForm} from "./entityResolution";
import {computeCoOccurrences, pairKey, type EntityRelation} from "./entityRelations";

const P1 = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const P2 = "01BBBBBBBBBBBBBBBBBBBBBBBB";
const O1 = "01CCCCCCCCCCCCCCCCCCCCCCCC";
const O2 = "01DDDDDDDDDDDDDDDDDDDDDDDD";

const ENTRIES = [
  {ulid: P1, type: "person", canonical: "Иванов Иван Иванович", forms: ["Иванов Иван Иванович", "Иванов И. И."], aliases: []},
  {ulid: P2, type: "person", canonical: "Иванов Пётр Сидорович", forms: ["Иванов Пётр Сидорович", "Иванов И. И."], aliases: []},
  {ulid: O1, type: "org", canonical: "ООО Ромашка", forms: ["ООО Ромашка"], aliases: []},
  {ulid: O2, type: "org", canonical: "АО Колос", forms: ["АО Колос"], aliases: []},
];

const EMPTY_PROFILE = {byEntity: {}, docs: {}};

describe("entityContext: markdownBlocks / blockAt", () => {
  it("абзац, заголовок, строка таблицы и пункт списка — отдельные блоки", () => {
    const md = ["# Планы", "", "Иванов И. И. вместе с ООО Ромашка.", "", "| ФИО | Дата |", "", "- Иванов И. И. ведёт АО Колос"].join("\n");
    const blocks = markdownBlocks(md);
    expect(blocks.map((b) => b.text)).toEqual([
      "# Планы",
      "Иванов И. И. вместе с ООО Ромашка.",
      "| ФИО | Дата |",
      "- Иванов И. И. ведёт АО Колос",
    ]);
  });

  it("fenced-код — не контекст; вхождение в коде падает в fallback (весь документ)", () => {
    const md = ["До кода.", "", "```", "Иванов И. И. в примере", "```", "", "После кода."].join("\n");
    const blocks = markdownBlocks(md);
    expect(blocks.map((b) => b.text)).toEqual(["До кода.", "После кода."]);
    const offset = md.indexOf("Иванов И. И. в примере");
    const block = blockAt(md, offset);
    expect(block.text).toBe(md); // fallback — весь документ
  });

  it("многострочный абзац — один блок; blockAt находит блок по смещению", () => {
    const md = ["строка один", "продолжение строки", "", "другой абзац"].join("\n");
    const blocks = markdownBlocks(md);
    expect(blocks).toHaveLength(2);
    const found = blockAt(md, md.indexOf("продолжение"));
    expect(found.text).toBe("строка один\nпродолжение строки");
  });
});

describe("entityResolution: matchesOfForm / resolveRegistryForm", () => {
  it("matchesOfForm собирает всех кандидатов формы (однофамильцы)", () => {
    const ulids = matchesOfForm(ENTRIES, "Иванов И. И.").map((e) => e.ulid);
    expect(ulids.sort()).toEqual([P1, P2].sort());
  });

  it("неизвестное значение → null", () => {
    expect(resolveRegistryForm("Незнакомец Н. Н.", {docPath: "a.md", contextUlids: []}, ENTRIES, [], EMPTY_PROFILE)).toBeNull();
  });

  it("единственный кандидат → unique без контекста", () => {
    const r = resolveRegistryForm("ООО Ромашка", {docPath: "a.md", contextUlids: []}, ENTRIES, [], EMPTY_PROFILE);
    expect(r).toMatchObject({status: "unique", entry: {ulid: O1}});
  });

  it("несколько кандидатов + явная связь с контекстом → resolved via relations", () => {
    // «Иванов И. И.» рядом с АО Колос: у P2 works_at АО Колос — он и есть
    const relations: EntityRelation[] = [
      {from: P2, to: O2, kind: "member_of", confidence: "explicit"},
    ];
    const r = resolveRegistryForm(
      "Иванов И. И.",
      {docPath: "a.md", contextUlids: [O2]},
      ENTRIES,
      relations,
      EMPTY_PROFILE,
    );
    expect(r).toMatchObject({status: "resolved", via: "relations", entry: {ulid: P2}});
  });

  it("связей нет — профиль co_occurs в документе выбирает кандидата", () => {
    const profile = computeCoOccurrences(new Map([["a.md", [P1, O1]]]));
    const r = resolveRegistryForm(
      "Иванов И. И.",
      {docPath: "a.md", contextUlids: [O1]},
      ENTRIES,
      [],
      profile,
    );
    expect(r).toMatchObject({status: "resolved", via: "co_occurs", entry: {ulid: P1}});
  });

  it("контекст пуст, связей нет → конфликт со списком кандидатов", () => {
    const r = resolveRegistryForm(
      "Иванов И. И.",
      {docPath: "a.md", contextUlids: []},
      ENTRIES,
      [],
      EMPTY_PROFILE,
    );
    expect(r).toMatchObject({status: "conflict"});
    expect(r != null && r.status === "conflict").toBe(true);
    if (r != null && r.status === "conflict") {
      expect(r.candidates.map((c) => c.ulid).sort()).toEqual([P1, P2].sort());
    }
  });

  it("co_occurs учитывает документ: пара из другого документа не считается", () => {
    const profile = computeCoOccurrences(new Map([["other.md", [P1, O1]]]));
    const r = resolveRegistryForm(
      "Иванов И. И.",
      {docPath: "a.md", contextUlids: [O1]},
      ENTRIES,
      [],
      profile,
    );
    expect(r).toMatchObject({status: "conflict"}); // пара есть, но не в этом документе
    expect(pairKey(P1, O1)).toBe(`${P1}|${O1}`); // порядок пары лексический
  });

  it("D-7: stored-перематчинг не находит кандидатов — без pre-computed null, с ними конфликт", () => {
    // «Иванову Ивану Ивановичу» — склонённая форма: matchesOfForm по stored-
    // формам её не знает ([]), компилят (declension) даёт [P1]. Резолвер с
    // pre-computed кандидатом работает, без — null (молчаливая потеря).
    expect(matchesOfForm(ENTRIES, "Иванову Ивану Ивановичу")).toEqual([]);
    expect(
      resolveRegistryForm("Иванову Ивану Ивановичу", {docPath: "a.md", contextUlids: []}, ENTRIES, [], EMPTY_PROFILE),
    ).toBeNull();
    const pre = ENTRIES.filter((e) => e.ulid === P1);
    const r = resolveRegistryForm(
      "Иванову Ивану Ивановичу",
      {docPath: "a.md", contextUlids: []},
      ENTRIES,
      [],
      EMPTY_PROFILE,
      pre,
    );
    expect(r).toMatchObject({status: "unique", entry: {ulid: P1}});
    // 2+ pre-computed кандидатов без связей → conflict (flagman T6-5)
    const r2 = resolveRegistryForm(
      "Ивановым И. И.",
      {docPath: "a.md", contextUlids: []},
      ENTRIES,
      [],
      EMPTY_PROFILE,
      ENTRIES.filter((e) => e.type === "person"),
    );
    expect(r2).toMatchObject({status: "conflict", candidates: [{ulid: P1}, {ulid: P2}]});
  });
});
