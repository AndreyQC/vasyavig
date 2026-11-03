/**
 * Тесты ядра vas-entity (Phase 8.5, T3; план 20261105_001): схема href,
 * парсер разметки, словарь идентичности entities.jsonl, интеграция
 * маскирования (постоянные ULID, склонения, canonical).
 */

import {describe, expect, it} from "vitest";
import {buildVasEntityHref, parseVasEntityHref} from "./vasEntityLink";
import {
  collectMarkedEntities,
  parseEntityLinks,
  type EntityLinkSpan,
} from "./vasEntityMarkup";
import {RunRegistry} from "./registry";
import {maskText} from "./mask";
import {unmaskText} from "./unmask";
import {
  matchEntityEntry,
  mergeEntitiesIndex,
  parseEntitiesJsonl,
  serializeEntitiesJsonl,
  type EntityIndexEntry,
} from "../../entitiesIndex";

/** Правдоподобные ULID (окно таймстемпа ≥ 2020). */
const P_ULID = "01JBBCCCCDDDDDDDDDDDDDDDDD";
const O_ULID = "01JHKMMMMMMMMMMMMMMMMMMMMM";

describe("vasEntityLink: parse/build", () => {
  it("разбирает валидный href и собирает обратно", () => {
    expect(parseVasEntityHref(`vas-entity:person:${P_ULID}`)).toEqual({
      type: "PERSON",
      ulid: P_ULID,
    });
    expect(buildVasEntityHref("PERSON", P_ULID.toLowerCase())).toBe(
      `vas-entity:person:${P_ULID}`,
    );
    expect(buildVasEntityHref("URL_CRED", P_ULID)).toBe(`vas-entity:url_cred:${P_ULID}`);
  });

  it("мусорные href → null: схема, тип, ULID", () => {
    expect(parseVasEntityHref(`harness-ulid:${P_ULID}`)).toBeNull();
    expect(parseVasEntityHref("vas-entity:alien:" + P_ULID)).toBeNull();
    expect(parseVasEntityHref("vas-entity:person:01AAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull(); // таймстемп < 2020
    expect(parseVasEntityHref("vas-entity:person")).toBeNull();
    expect(parseVasEntityHref(null)).toBeNull();
  });
});

describe("vasEntityMarkup: parseEntityLinks", () => {
  it("находит чип-ссылки, спан покрывает всю конструкцию", () => {
    const md = `Поручено [Иванову И. И.](vas-entity:person:${P_ULID}) из [ООО Ромашка](vas-entity:org:${O_ULID}).`;
    const spans = parseEntityLinks(md);
    expect(spans).toHaveLength(2);
    const first = spans[0] as EntityLinkSpan;
    expect(md.slice(first.start, first.end)).toBe(`[Иванову И. И.](vas-entity:person:${P_ULID})`);
    expect(first.value).toBe("Иванову И. И.");
    expect(first.type).toBe("PERSON");
    expect(first.ulid).toBe(P_ULID);
  });

  it("склонения: один ULID — разные тексты", () => {
    const md =
      `[Иванову И. И.](vas-entity:person:${P_ULID}) и [Ивановым И. И.](vas-entity:person:${P_ULID}).`;
    const spans = parseEntityLinks(md);
    expect(spans).toHaveLength(2);
    expect(new Set(spans.map((s) => s.value))).toEqual(new Set(["Иванову И. И.", "Ивановым И. И."]));
    expect(new Set(spans.map((s) => s.ulid)).size).toBe(1);
  });

  it("обычные ссылки и код-блоки не считаются разметкой", () => {
    const md = [
      "[Обычная ссылка](https://example.com) и [мусорная схема](vas-entity:person:short).",
      "",
      "```",
      "[Иванов](vas-entity:person:" + P_ULID + ")",
      "```",
    ].join("\n");
    expect(parseEntityLinks(md)).toEqual([]);
  });

  it("collectMarkedEntities: canonical = первое вхождение, формы уникальны, конфликт типов", () => {
    const spans = parseEntityLinks(
      `[Иванову И. И.](vas-entity:person:${P_ULID}), [Иванов Иван Иваныч](vas-entity:person:${P_ULID}), ` +
        `[Иванов И.](vas-entity:org:${P_ULID})`,
    );
    const {records, typeConflicts} = collectMarkedEntities(spans);
    const person = records.find((r) => r.type === "PERSON");
    expect(person?.canonical).toBe("Иванову И. И.");
    // формы собираются по ULID: конфликтный org-вариант того же ULID тоже в формах
    expect(person?.forms).toEqual(["Иванов И.", "Иванов Иван Иваныч", "Иванову И. И."]);
    expect(typeConflicts).toEqual([{ulid: P_ULID, types: ["PERSON", "ORG"]}]);
  });
});

describe("entitiesIndex: jsonl-словарь", () => {
  const line = (entry: EntityIndexEntry): string =>
    JSON.stringify({ulid: entry.ulid, type: entry.type, canonical: entry.canonical, forms: entry.forms});

  it("parse/serialize round-trip, битые строки пропускаются", () => {
    const text = [
      line({ulid: P_ULID, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И.", "Ивановым И. И."]}),
      "{битая строка",
      "",
      line({ulid: O_ULID, type: "org", canonical: "ООО Ромашка", forms: ["ООО Ромашка"]}),
    ].join("\n");
    const entries = parseEntitiesJsonl(text);
    expect(entries).toHaveLength(2);
    expect(serializeEntitiesJsonl(entries).split("\n")).toHaveLength(2);
    expect(parseEntitiesJsonl(serializeEntitiesJsonl(entries))).toEqual(entries);
  });

  it("merge: canonical/type существующей неизменны, forms растут", () => {
    const existing = [{ulid: P_ULID, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И."]}];
    const incoming = [
      {ulid: P_ULID, type: "person", canonical: "Ивановым И. И.", forms: ["Ивановым И. И.", "Иванову И. И."]},
    ];
    const {entries} = mergeEntitiesIndex(existing, incoming);
    expect(entries[0]?.canonical).toBe("Иванову И. И.");
    expect(entries[0]?.forms).toEqual(["Иванову И. И.", "Ивановым И. И."]);
  });

  it("merge: конфликт типов фиксируется", () => {
    const {typeConflicts} = mergeEntitiesIndex(
      [{ulid: P_ULID, type: "person", canonical: "А", forms: ["А"]}],
      [{ulid: P_ULID, type: "org", canonical: "А", forms: ["А"]}],
    );
    expect(typeConflicts).toEqual([{ulid: P_ULID, types: ["person", "org"]}]);
  });

  it("match: точное совпадение по формам, фильтр по типу", () => {
    const entries = [
      {ulid: P_ULID, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И.", "Ивановым И. И."]},
      {ulid: O_ULID, type: "org", canonical: "ООО Ромашка", forms: ["ООО Ромашка"]},
    ];
    expect(matchEntityEntry(entries, "Ивановым И. И.")?.ulid).toBe(P_ULID);
    expect(matchEntityEntry(entries, "ООО Ромашка", "ORG")?.ulid).toBe(O_ULID);
    expect(matchEntityEntry(entries, "ООО Ромашка", "PERSON")).toBeNull();
    expect(matchEntityEntry(entries, "Петров")).toBeNull();
  });
});

describe("mask/registry: разметка и постоянные ULID (T3-5)", () => {
  const MARKED = `[Иванову И. И.](vas-entity:person:${P_ULID}) и [Ивановым И. И.](vas-entity:person:${P_ULID}) из [ООО Ромашка](vas-entity:org:${O_ULID}).`;

  it("размеченное — постоянный алиас из href; склонения дают один алиас", () => {
    const registry = new RunRegistry(MARKED);
    const spans = parseEntityLinks(MARKED);
    for (const span of spans) registry.registerExisting(span.ulid, span.type, span.value);
    const result = maskText(MARKED, registry, [], spans);
    const aliases = result.text.match(/\[\[VAS_PERSON_[0-9A-HJKMNP-TV-Z]{26}\]\]/g) ?? [];
    expect(new Set(aliases).size).toBe(1);
    expect(aliases[0]).toBe(`[[VAS_PERSON_${P_ULID}]]`);
    expect(result.text).toContain(`[[VAS_ORG_${O_ULID}]]`);
    expect(result.text).not.toContain("Иванову");
    expect(result.text).not.toContain("vas-entity"); // href-конструкции наружу не идут
    expect(result.count).toBe(3);
  });

  it("unmask подставляет canonical (первая форма)", () => {
    const registry = new RunRegistry(MARKED);
    const spans = parseEntityLinks(MARKED);
    for (const span of spans) registry.registerExisting(span.ulid, span.type, span.value);
    const masked = maskText(MARKED, registry, [], spans);
    const restored = unmaskText(masked.text, registry);
    expect(restored.unknown).toEqual([]);
    expect(restored.text).toContain("Иванову И. И."); // canonical, не «Ивановым»
    expect(restored.text).toContain("ООО Ромашка");
  });

  it("resolver: неразмеченное известное значение — постоянный ULID, новое — per-run", () => {
    const DOC = "Упомянут Ивановым И. И. и Петров А.С.";
    const index = [
      {ulid: P_ULID, type: "person", canonical: "Иванову И. И.", forms: ["Иванову И. И.", "Ивановым И. И."]},
    ];
    const registry = new RunRegistry(DOC, (value, type) => matchEntityEntry(index, value, type)?.ulid ?? null);
    const result = maskText(DOC, registry, ["ner"]);
    expect(result.text).toContain(`[[VAS_PERSON_${P_ULID}]]`); // известное
    expect(result.text).not.toContain("Ивановым");
    expect(result.text).toMatch(/\[\[VAS_PERSON_01J[0-9A-HJKMNP-TV-Z]{23}\]\]/); // Петров — per-run
  });

  it("детектор внутри размеченной ссылки не создаёт дубль (longest-wins)", () => {
    const DOC = `связь [ivanov@example.com](vas-entity:email:${P_ULID}) по делу`;
    const registry = new RunRegistry(DOC);
    const spans = parseEntityLinks(DOC);
    for (const span of spans) registry.registerExisting(span.ulid, span.type, span.value);
    const result = maskText(DOC, registry, ["email"], spans);
    expect(result.text).toContain(`[[VAS_EMAIL_${P_ULID}]]`);
    expect(result.text).not.toContain("example.com");
    expect(result.count).toBe(1);
  });
});
