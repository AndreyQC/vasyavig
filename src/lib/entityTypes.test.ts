/**
 * Тесты справочника типов сущностей из harness.yaml (Phase 8.5, T3c; план
 * 20261105_002, HY-4/HY-5): разбор секции entities, флаг masking, кастомные
 * типы, доменный словарь NER.
 */

import {afterEach, describe, expect, it} from "vitest";
import {
  customTypeLabel,
  defaultEntityTypes,
  knownEntityTypeToken,
  isMaskingTypeToken,
  parseEntityTypes,
  resetEntityTypes,
  setEntityTypes,
  systemTypeOfToken,
} from "./entityTypes";
import {parseVasEntityHref, buildVasEntityHref} from "./agent/masking/vasEntityLink";
import {maskText} from "./agent/masking/mask";
import {RunRegistry} from "./agent/masking/registry";
import {detectNer, applyDomainDictionary} from "./agent/masking/ner";
import {resetUlidMonotonic} from "./agent/masking/ulid";

const Y = (entities: string): string => `project:\n  id: test\n${entities}`;

/** Разобрать и установить активным (как ensureEntityTypes, синхронно для тестов). */
function loadY(entities: string) {
  const config = parseEntityTypes(Y(entities));
  setEntityTypes(config);
  return config;
}

describe("parseEntityTypes", () => {
  afterEach(resetEntityTypes);

  it("без секции entities — системные 7 с masking: true", () => {
    const config = loadY("");
    expect(config.defs).toEqual(defaultEntityTypes().defs);
    expect(config.dictionary).toEqual([]);
    expect(isMaskingTypeToken("person")).toBe(true);
  });

  it("флаг masking: false у системного типа отключает маскирование", () => {
    const config = loadY("entities:\n  loc: {masking: false}\n");
    expect(isMaskingTypeToken("loc")).toBe(false);
    expect(isMaskingTypeToken("person")).toBe(true);
    expect(config.defs.filter((d) => d.masking)).toHaveLength(6);
  });

  it("кастомные типы: label, не маскируются, идут после системных", () => {
    const config = loadY("entities:\n  project:\n    label: {ru: Проект, en: Project}\n");
    const project = config.defs.find((d) => d.token === "project");
    expect(project).toEqual({
      token: "project",
      masking: false,
      custom: true,
      labelRu: "Проект",
      labelEn: "Project",
    });
    expect(isMaskingTypeToken("project")).toBe(false);
    expect(knownEntityTypeToken("project")).toBe(true);
  });

  it("битые токены/значения пропускаются", () => {
    const config = loadY(
      "entities:\n  '1Bad': {}\n  ok_type:\n    label: {ru: Ок}\n  secret: null\n",
    );
    expect(config.defs.map((d) => d.token)).toContain("ok_type");
    expect(config.defs.map((d) => d.token)).not.toContain("1bad");
    // secret: null не сломал системный дефолт
    expect(isMaskingTypeToken("secret")).toBe(true);
  });

  it("доменный словарь: только org/person/loc", () => {
    const config = parseEntityTypes(
      Y("entities:\n  dictionary:\n    Газпром: org\n    Иванов: person\n    Что-то: alien\n"),
    );
    expect(config.dictionary).toEqual([
      {word: "Газпром", type: "org"},
      {word: "Иванов", type: "person"},
    ]);
  });

  it("битый YAML — дефолт", () => {
    expect(parseEntityTypes("entities: [битый")).toEqual(defaultEntityTypes());
  });
});

describe("vasEntityLink с справочником", () => {
  afterEach(resetEntityTypes);

  it("кастомный тип валиден для href после загрузки справочника", () => {
    expect(parseVasEntityHref("vas-entity:project:01JBBCCCCDDDDDDDDDDDDDDDDD")).toBeNull();
    loadY("entities:\n  project:\n    label: {ru: Проект}\n");
    expect(parseVasEntityHref("vas-entity:project:01JBBCCCCDDDDDDDDDDDDDDDDD")).toEqual({
      type: "project",
      ulid: "01JBBCCCCDDDDDDDDDDDDDDDDD",
    });
    expect(buildVasEntityHref("PROJECT", "01jbbccccddddddddddddddddd")).toBe(
      "vas-entity:project:01JBBCCCCDDDDDDDDDDDDDDDDD",
    );
  });

  it("systemTypeOfToken: системный — EntityType, кастомный — null", () => {
    loadY("entities:\n  project:\n    label: {ru: Проект}\n");
    expect(systemTypeOfToken("person")).toBe("PERSON");
    expect(systemTypeOfToken("project")).toBeNull();
  });
});

describe("maskText: фильтр по masking-флагу (HY-5)", () => {
  afterEach(resetEntityTypes);

  it("кастомный тип не маскируется — ссылка уходит в промпт как есть", () => {
    loadY("entities:\n  project:\n    label: {ru: Проект}\n");
    resetUlidMonotonic();
    const DOC = "Проект [DBPM](vas-entity:project:01JBBCCCCDDDDDDDDDDDDDDDDD) готов.";
    const registry = new RunRegistry(DOC);
    const result = maskText(DOC, registry, [], [
      {start: 7, end: 57, ulid: "01JBBCCCCDDDDDDDDDDDDDDDDD", type: "project", value: "DBPM"},
    ]);
    expect(result.text).toBe(DOC); // без изменений
    expect(result.count).toBe(0);
  });

  it("masking: false у системного типа (loc) — локации не маскируются", () => {
    loadY("entities:\n  loc: {masking: false}\n");
    resetUlidMonotonic();
    const DOC =
      "Офис в [Москве](vas-entity:loc:01JBBCCCCDDDDDDDDDDDDDDDDD), связь ivanov@example.com, конец.";
    const registry = new RunRegistry(DOC);
    const result = maskText(DOC, registry, ["email"], [
      {start: 7, end: 61, ulid: "01JBBCCCCDDDDDDDDDDDDDDDDD", type: "loc", value: "Москве"},
    ]);
    expect(result.text).toContain("[Москве](vas-entity:loc:"); // ссылка цела
    expect(result.text).not.toContain("ivanov@example.com"); // email маскирован
    expect(result.count).toBe(1);
  });
});

describe("доменный словарь NER (HY-5)", () => {
  afterEach(resetEntityTypes);

  // ru-compromise — синглтон: выученное слово не отучить, поэтому «не ловится»
  // проверяем ДО загрузки словаря, «ловится» — после.
  it("без словаря Газпром не ловится", () => {
    resetEntityTypes();
    applyDomainDictionary(); // словарь пуст
    const spans = detectNer("Отчёт Газпром опубликован.");
    expect(spans.some((span) => span.value === "Газпром")).toBe(false);
  });

  it("Газпром: org ловится после applyDomainDictionary", () => {
    loadY("entities:\n  dictionary:\n    Газпром: org\n");
    applyDomainDictionary();
    const spans = detectNer("Отчёт Газпром опубликован.");
    expect(spans.some((span) => span.value === "Газпром" && span.type === "ORG")).toBe(true);
  });
});

describe("customTypeLabel", () => {
  afterEach(resetEntityTypes);

  it("кастомный — label по языку; системный — null (идёт через i18n)", () => {
    loadY("entities:\n  project:\n    label: {ru: Проект, en: Project}\n");
    expect(customTypeLabel("project", "ru-RU")).toBe("Проект");
    expect(customTypeLabel("project", "en")).toBe("Project");
    // неизвестный язык — fallback на en
    expect(customTypeLabel("project", "de")).toBe("Project");
    expect(customTypeLabel("person", "ru")).toBeNull();
  });
});
