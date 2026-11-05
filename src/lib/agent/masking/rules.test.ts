import {describe, expect, it} from "vitest";
import {
  compileRule,
  compileRules,
  passesChecks,
  resolveOverlaps,
  runRules,
  type DetectorRule,
} from "./rules";
import {DEFAULT_DETECTOR_RULES} from "./rules.default";
import {
  ibanValid,
  innOrgValid,
  innPersonValid,
  luhnValid,
  ogrnValid,
  ogrnipCheckDigit,
  ogrnipValid,
  snilsChecksum,
  snilsValid,
} from "./validators";

describe("T6-9: валидаторы", () => {
  it("Luhn принимает тестовый номер и отвергает мусор", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid("")).toBe(false);
    expect(luhnValid("abc")).toBe(false);
  });

  it("СНИЛС", () => {
    // контрольные цифры считаем сами (алгоритм из guardrails)
    expect(snilsChecksum("112233565")).toBe("01");
    expect(snilsValid("11223356501")).toBe(true);
    expect(snilsValid("11223356502")).toBe(false);
    expect(snilsValid("112233")).toBe(false);
  });

  it("ИНН физлица и юрлица", () => {
    expect(innPersonValid("500100732259")).toBe(true);
    expect(innPersonValid("500100732258")).toBe(false);
    expect(innOrgValid("7707083893")).toBe(true);
    expect(innOrgValid("7707083894")).toBe(false);
  });

  it("ОГРН и ОГРНИП", () => {
    expect(ogrnValid("1027700132195")).toBe(true);
    expect(ogrnValid("1027700132196")).toBe(false);
    // ОГРНИП: контрольная цифра считается по mod 13
    const prefix = "30400010000000";
    const valid = `${prefix}${ogrnipCheckDigit(prefix)}`;
    expect(ogrnipValid(valid)).toBe(true);
    expect(ogrnipValid(`${prefix}9`)).toBe(false);
  });

  it("IBAN (mod-97)", () => {
    expect(ibanValid("DE89370400440532013000")).toBe(true);
    expect(ibanValid("DE89370400440532013001")).toBe(false);
  });
});

describe("T6-9: движок правил", () => {
  it("битая регулярка не ломает разбор (fail-open)", () => {
    const broken: DetectorRule = {rule_id: "broken", type: "x", regex: "([unclosed"};
    expect(compileRule(broken)).toBeNull();
    const compiled = compileRules([broken]);
    expect(compiled).toHaveLength(0);
  });

  it("capture_groups задаёт семантический span", () => {
    const rule = compileRule({
      rule_id: "email",
      type: "email",
      regex: "(?:^|[^\\w\\\\])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,63})\\b",
      capture_groups: [1],
    })!;
    const text = "почта ivan@example.com тут";
    const spans = runRules(text, [rule]);
    expect(spans).toHaveLength(1);
    expect(spans[0].value).toBe("ivan@example.com");
    expect(text.slice(spans[0].start, spans[0].end)).toBe("ivan@example.com");
  });

  it("min_length отсекает короткие значения", () => {
    const rule = compileRule({
      rule_id: "short",
      type: "x",
      regex: "\\d+",
      min_length: 5,
    })!;
    expect(runRules("123 123456", [rule])).toHaveLength(1);
  });

  it("banlist отсекает значения", () => {
    const rule = compileRule({
      rule_id: "banned",
      type: "x",
      regex: "\\w+",
      banlist: ["Password"],
    })!;
    expect(runRules("Password secret", [rule]).map((s) => s.value)).toEqual(["secret"]);
  });

  it("энтропия отсекает однообразные значения", () => {
    const rule = compileRule({rule_id: "ent", type: "x", regex: "[a-z]+", entropy: 2.0})!;
    expect(passesChecks(rule, "aaaa")).toBe(false);
    expect(passesChecks(rule, "abcdef")).toBe(true);
  });

  it("валидатор отсекает кандидата без верной контрольной суммы", () => {
    const rule = compileRule({
      rule_id: "snils",
      type: "snils",
      regex: "\\b(\\d{3}[\\s-]?\\d{3}[\\s-]?\\d{3}[\\s-]?\\d{2})\\b",
      capture_groups: [1],
      validators: ["snils"],
    })!;
    expect(runRules("СНИЛС 112-233-565-01", [rule])).toHaveLength(1);
    expect(runRules("СНИЛС 112-233-565-02", [rule])).toHaveLength(0);
  });

  it("префильтр по ключевым словам пропускает правило (recall-safe)", () => {
    const rule = compileRule({
      rule_id: "pref",
      type: "x",
      regex: "\\d{4}",
      keywords: ["паспорт"],
      prefilter_safe: true,
    })!;
    expect(runRules("номер 1234", [rule])).toHaveLength(0);
    expect(runRules("паспорт 1234", [rule])).toHaveLength(1);
  });

  it("без prefilter_safe ключевые слова не влияют", () => {
    const rule = compileRule({
      rule_id: "pref-off",
      type: "x",
      regex: "\\d{4}",
      keywords: ["паспорт"],
    })!;
    expect(runRules("номер 1234", [rule])).toHaveLength(1);
  });
});

describe("T6-9: union-span при пересечении", () => {
  it("пересекающиеся спаны объединяются, атрибуция — у длиннейшего", () => {
    const spans = resolveOverlaps([
      {start: 0, end: 10, type: "short", rule_id: "a", value: "0123456789"},
      {start: 5, end: 20, type: "long", rule_id: "b", value: "56789012345"},
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBe(0);
    expect(spans[0].end).toBe(20);
    expect(spans[0].type).toBe("long");
  });

  it("непересекающиеся спаны не сливаются", () => {
    const spans = resolveOverlaps([
      {start: 0, end: 5, type: "a", rule_id: "a", value: "aaaaa"},
      {start: 10, end: 15, type: "b", rule_id: "b", value: "bbbbb"},
    ]);
    expect(spans).toHaveLength(2);
  });
});

describe("T6-9: встроенный корпус", () => {
  const rules = compileRules(DEFAULT_DETECTOR_RULES);

  it("находит email, телефон и ФИО", () => {
    const text =
      "Иванов Иван Иванович согласовал договор. Почта ivan.ivanov@example.com, телефон +7 (495) 123-45-67.";
    const spans = runRules(text, rules);
    const types = spans.map((span) => span.type);
    expect(types).toContain("email");
    expect(types).toContain("phone");
    expect(types).toContain("person");
  });

  it("разговорное отчество «Иваныч» правилом ФИО не ловится (ловит NER)", () => {
    // В строгом правиле отчество — якорь точности, формы «-ыч» в нём нет.
    // Разговорные формы («Иваныч», «Ильич») понимает наш NER/склонялка (T3d).
    const spans = runRules("Иваныч пришёл вовремя", rules).filter((s) => s.type === "person");
    expect(spans).toHaveLength(0);
  });

  it("не ловит мусор: «Красная Площадь», «Общество Ромашка»", () => {
    const text = "Красная Площадь закрыта сегодня. Общество Ромашка открыло филиал.";
    const spans = runRules(text, rules);
    expect(spans).toHaveLength(0);
  });

  it("не ловит ФИО без отчества (однофамильцы) — якорь точности", () => {
    const spans = runRules("Иванов пришёл вовремя", rules);
    expect(spans.filter((span) => span.type === "person")).toHaveLength(0);
  });

  it("ловит ФИО с отчеством в обоих порядках", () => {
    const a = runRules("Иванов Иван Иванович пришёл", rules).filter((s) => s.type === "person");
    const b = runRules("Иван Иванович Иванов пришёл", rules).filter((s) => s.type === "person");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("ловит ФИО с инициалами", () => {
    const spans = runRules("Иванов И. И. согласовал", rules).filter((s) => s.type === "person");
    expect(spans).toHaveLength(1);
  });

  it("не ловит 12 цифр без валидного ИНН", () => {
    const spans = runRules("номер 123456789012", rules).filter((s) => s.type === "inn");
    expect(spans).toHaveLength(0);
  });

  it("ловит валидный ИНН", () => {
    const spans = runRules("ИНН 500100732259", rules).filter((s) => s.type === "inn");
    expect(spans).toHaveLength(1);
  });

  it("правила без пересечений дают стабильный результат", () => {
    const text = "Иванов Иван Иванович, ivan@example.com, +7 495 123-45-67";
    const first = runRules(text, rules);
    const second = runRules(text, rules);
    expect(first).toEqual(second);
  });
});
