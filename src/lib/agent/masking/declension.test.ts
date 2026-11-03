/**
 * Тесты обратной склонялки (Phase 8.5, T3d; план 20261105_004): генерация
 * падежных форм от nominative-базы (person/loc), выбор базы из форм, fuzzy-
 * матчинг неразмеченных склонений, интеграция с maskText-резолвером.
 * Спайки lvovich 2.1.0: косвенная база не склоняется; «Анна» признаётся
 * и именем, и отчеством — отчество только из последнего слова.
 */

import {beforeEach, describe, expect, it} from "vitest";
import {expandEntityForms, parsePersonCanonical, resetDeclensionCache} from "./declension";
import {matchEntityEntry, type EntityIndexEntry} from "../../entitiesIndex";
import {RunRegistry} from "./registry";
import {maskText} from "./mask";
import {resetUlidMonotonic} from "./ulid";

const P = "01JBBCCCCDDDDDDDDDDDDDDDDD";
const L = "01JHKMMMMMMMMMMMMMMMMMMMMM";

beforeEach(() => {
  resetDeclensionCache();
});

describe("parsePersonCanonical", () => {
  it("отчество — последнее слово (даже разговорное «Иваныч»)", () => {
    expect(parsePersonCanonical("Иванов Иван Иваныч")).toEqual({
      initials: [],
      lastname: "Иванов",
      firstname: "Иван",
      middlename: "Иваныч",
    });
  });

  it("женское имя не принимается за отчество (lvovich признаёт «Анну»)", () => {
    const parts = parsePersonCanonical("Иванова Анна Сергеевна");
    expect(parts).toEqual({
      initials: [],
      lastname: "Иванова",
      firstname: "Анна",
      middlename: "Сергеевна",
    });
  });

  it("инициалы отделяются: «Иванову И. И.»", () => {
    const parts = parsePersonCanonical("Иванову И. И.");
    expect(parts.initials).toEqual(["И.", "И."]);
    expect(parts.lastname).toBe("Иванову");
    expect(parts.firstname).toBeUndefined();
    expect(parts.middlename).toBeUndefined();
  });
});

describe("expandEntityForms: PERSON", () => {
  it("nominative-база: ФИО → падежи × шаблоны с инициалами и без", () => {
    const forms = expandEntityForms("Иванов Иван Иваныч", "person");
    expect(forms).toContain("Иванов Иван Иваныч"); // nominative
    expect(forms).toContain("Иванову И. И."); // dative + инициалы
    expect(forms).toContain("И. И. Иванову");
    expect(forms).toContain("Ивановым И. И."); // instrumental
    expect(forms).toContain("И. И. Ивановым");
    expect(forms).toContain("Иванова Ивана Иваныч"); // accusative ФИО (разговорное отчество не склоняется)
    expect(forms).toContain("Иванов Иван Иваныч");
  });

  it("база выбирается из форм: косвенный canonical + nominative в forms", () => {
    const forms = expandEntityForms("Иванову И. И.", "person", ["Иванов И. И."]);
    expect(forms).toContain("Иванову И. И."); // наблюдаемая
    expect(forms).toContain("Иванов И. И."); // наблюдаемая
    expect(forms).toContain("Ивановым И. И."); // сгенерированная от базы «Иванов»
    expect(forms).toContain("И. И. Ивановым");
  });

  it("коснённый canonical без nominative-форм — только наблюдаемые + перестановка инициалов", () => {
    // lvovich косвенную базу не склоняет; безопасные формы — перестановка
    expect(expandEntityForms("Иванову И. И.", "person")).toEqual([
      "Иванову И. И.",
      "И. И. Иванову",
    ]);
  });

  it("женская фамилия: Иванова → Ивановой", () => {
    const forms = expandEntityForms("Иванова Анна Сергеевна", "person");
    expect(forms).toContain("Ивановой Анны Сергеевны"); // genitive
    expect(forms).toContain("Ивановой А.С.");
  });

  it("несклоняемая фамилия — только наблюдаемые + перестановка инициалов", () => {
    expect(expandEntityForms("Шевченко И. И.", "person")).toEqual([
      "Шевченко И. И.",
      "И. И. Шевченко",
    ]);
  });
});

describe("expandEntityForms: LOC и прочие", () => {
  it("город: Москвы/Москву/Москве", () => {
    const forms = expandEntityForms("Москва", "loc");
    expect(forms).toContain("Москвы"); // genitive
    expect(forms).toContain("Москву"); // accusative
    expect(forms).toContain("Москве"); // prepositional
  });

  it("org/secret/email не склоняются — только canonical", () => {
    expect(expandEntityForms("ООО Ромашка", "org")).toEqual(["ООО Ромашка"]);
    expect(expandEntityForms("ivanov@example.com", "email")).toEqual(["ivanov@example.com"]);
  });
});

describe("matchEntityEntry fuzzy", () => {
  const entries: EntityIndexEntry[] = [
    {ulid: P, type: "person", canonical: "Иванов Иван Иваныч", forms: ["Иванов Иван Иваныч"]},
    {ulid: L, type: "org", canonical: "ООО Ромашка", forms: ["ООО Ромашка"]},
  ];

  it("склонённая форма без разметки → запись найдена (fuzzy)", () => {
    expect(matchEntityEntry(entries, "Ивановым И. И.", "PERSON", {fuzzy: true})?.ulid).toBe(P);
    expect(matchEntityEntry(entries, "И. И. Ивановым", undefined, {fuzzy: true})?.ulid).toBe(P);
    expect(matchEntityEntry(entries, "Иванову И. И.", "PERSON", {fuzzy: true})?.ulid).toBe(P);
  });

  it("точное совпадение приоритетно, без fuzzy склонения не находятся", () => {
    expect(matchEntityEntry(entries, "Иванов Иван Иваныч")?.ulid).toBe(P);
    expect(matchEntityEntry(entries, "Ивановым И. И.", "PERSON")).toBeNull(); // fuzzy off
  });

  it("org не склоняется — fuzzy не находит несуществующие формы", () => {
    expect(matchEntityEntry(entries, "ООО Ромашкой", "ORG", {fuzzy: true})).toBeNull();
  });
});

describe("интеграция: резолвер даёт постоянный ULID склонённому значению", () => {
  it("maskText: «Ивановым И. И.» без разметки → ULID записи индекса", () => {
    resetUlidMonotonic();
    const DOC = "Задача у Ивановым И. И. и у ООО Ромашка.";
    const entries: EntityIndexEntry[] = [
      {ulid: P, type: "person", canonical: "Иванов Иван Иваныч", forms: ["Иванов Иван Иваныч"]},
    ];
    const registry = new RunRegistry(
      DOC,
      (value, type) => matchEntityEntry(entries, value, type, {fuzzy: true})?.ulid ?? null,
    );
    const result = maskText(DOC, registry, ["ner"]);
    expect(result.text).toContain(`[[VAS_PERSON_${P}]]`); // склонённое — постоянный ULID
    expect(result.text).not.toContain("Ивановым");
  });
});
