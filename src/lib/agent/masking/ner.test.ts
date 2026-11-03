/**
 * Тесты NER-детектора (Phase 8.5, T2; план 20261104_003 §4).
 * Критерии приёмки диалога §8: отчество/инициалы/юр.формы/гео на русских
 * фикстурах, `\b` не используется. Фикстуры — обычные имена, не секреты
 * (LESSONS_LEARNED §16 о push protection здесь не про имена, но держим
 * непаттернные значения).
 */

import {describe, expect, it} from "vitest";
import {detectNer} from "./ner";
import {detectText} from "./detectors";

function found(text: string): Array<[string, string]> {
  return detectNer(text)
    .sort((a, b) => a.start - b.start)
    .map((span) => [span.value, span.type]);
}

describe("NER: PERSON", () => {
  it("полное ФИО — один спан (слияние соседних person-термов, N2)", () => {
    expect(found("Иван Петрович Смирнов подписал акт.")).toEqual([
      ["Иван Петрович Смирнов", "PERSON"],
    ]);
  });

  it("отдельно стоящее отчество (N3)", () => {
    expect(found("Доклад представил Кузьмич.")).toEqual([["Кузьмич", "PERSON"]]);
  });

  it("инициалы перед фамилией: «И. И. Иванов» (N4)", () => {
    expect(found("Заявку подал И. И. Иванов вчера.")).toEqual([["И. И. Иванов", "PERSON"]]);
  });

  it("фамилия + два инициала без пробела: «Иванов А.С.» (N4)", () => {
    expect(found("Иванов А.С. закрыл задачу.")).toEqual([["Иванов А.С.", "PERSON"]]);
  });

  it("фамилия + один инициал: «Петров А.» (N4)", () => {
    expect(found("Петров А. согласовал бюджет.")).toEqual([["Петров А.", "PERSON"]]);
  });

  it("склонённая фамилия с инициалами: «Иванову И. И.» целиком (N2/N4)", () => {
    const spans = detectNer("Поручено Иванову И. И. до пятницы.");
    const person = spans.find((span) => span.type === "PERSON");
    expect(person?.value).toBe("Иванову И. И.");
  });

  it("обычные слова и «т.д.» не детектируются", () => {
    expect(found("Врач принял пациента, плечи и ключ на месте, и т.д. далее.")).toEqual([]);
    expect(found("Свич и мяч лежат рядом.")).toEqual([]);
  });
});

describe("NER: ORG", () => {
  it("юр. форма + имя: «ООО Ромашка»", () => {
    expect(found("Договор с ООО Ромашка продлён.")).toEqual([["ООО Ромашка", "ORG"]]);
  });

  it("юр. форма + имя в кавычках: «ПАО «Газпром»»", () => {
    expect(found("Отчёт ПАО «Газпром» опубликован.")).toEqual([["ПАО «Газпром»", "ORG"]]);
  });

  it("юридическая форма без имени — тоже ORG", () => {
    expect(found("Общество зарегистрировано как ООО.")).toEqual([["ООО", "ORG"]]);
  });

  it("строчное «ооо» не детектируется", () => {
    expect(found("работает в ооо ромашка давно.")).toEqual([]);
  });
});

describe("NER: LOC", () => {
  it("гео-подсказка: «г. Москве» — значение без ключевого слова (N6)", () => {
    const spans = detectNer("Офис находится в г. Москве.");
    expect(spans).toEqual([
      {start: 20, end: 26, value: "Москве", type: "LOC", detector: "ner"},
    ]);
  });

  it("улица: «ул. Пушкина»", () => {
    expect(found("встреча на ул. Пушкина в полдень.")).toEqual([["Пушкина", "LOC"]]);
  });

  it("словарь ru-compromise: «Москва» в именительном (N1)", () => {
    const values = found("Москва встречает гостей.");
    expect(values).toContainEqual(["Москва", "LOC"]);
  });

  it("строчное слово после ключа не детектируется", () => {
    expect(found("по ул. московской ехали долго.")).toEqual([]);
  });
});

describe("NER: интеграция с detectText (D3)", () => {
  const DOC = "Иван Петрович Смирнов из ООО Ромашка, г. Москве, тел. +7 (495) 123-45-67.";

  it("детектор ner добавляет PERSON/ORG/LOC к общим спанам", () => {
    const spans = detectText(DOC, ["secrets", "email", "phone", "ner"]);
    const types = spans.map((span) => span.type).sort();
    expect(types).toContain("PERSON");
    expect(types).toContain("ORG");
    expect(types).toContain("LOC");
    expect(types).toContain("PHONE");
  });

  it("без ner в списке детекторов NER-спанов нет", () => {
    const spans = detectText(DOC, ["secrets", "email", "phone"]);
    expect(spans.every((span) => span.type !== "PERSON" && span.type !== "ORG")).toBe(true);
  });

  it("алиасы реестра: одно ФИО — один ULID (через maskText)", async () => {
    const {RunRegistry} = await import("./registry");
    const {maskText} = await import("./mask");
    const registry = new RunRegistry("Иван Смирнов и Иван Смирнов снова.");
    const result = maskText("Иван Смирнов и Иван Смирнов снова.", registry, ["ner"]);
    // ru-compromise может не слить «Иван Смирнов» в один терм-ран — тогда это
    // два PERSON-спана; главное — одинаковое значение даёт один алиас.
    const aliases = result.text.match(/\[\[VAS_PERSON_[0-9A-HJKMNP-TV-Z]{26}\]\]/g) ?? [];
    expect(new Set(aliases).size).toBe(1);
    expect(result.stats.PERSON).toBeGreaterThanOrEqual(2);
  });
});
