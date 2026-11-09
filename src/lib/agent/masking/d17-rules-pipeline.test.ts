/**
 * D-17 (P1) регресс: правила T6-9 доходят до конвейера «Проверить документ».
 *
 * Фикстуры — секция «Маскирование» тест-документа GUI-приёмки 20261108_001
 * (валидные контрольные суммы из rules.test.ts, заведомо не настоящие).
 * Детекторы — эффективный дефолт конфига (createDefaultConfig), т.е. путь
 * приложения без vasyavig.yaml. Корни дефекта: fallback parseMaskingDetectors
 * без "rules" (config.ts), 14–15-значный regex карты (rules.default.ts),
 * context-правило без case_insensitive.
 */

import {describe, expect, it} from "vitest";

import {createDefaultConfig} from "../config";
import {maskText} from "./mask";
import {RunRegistry} from "./registry";
import {unmaskText} from "./unmask";

const GUI_DEFAULT = createDefaultConfig().app.assistant.masking.detectors;

const DOC = [
  "## Маскирование",
  "",
  "- СНИЛС: 112-233-565 01",
  "- ИНН физлица: 500100732259",
  "- ИНН юрлица: 7707083893",
  "- ОГРН: 1027700132195",
  "- Карта: 4111 1111 1111 1111",
  "- IBAN: DE89370400440532013000",
  "- Email: ivan.ivanov@example.com",
  "- Телефон: +7 (495) 123-45-67",
  "- Токен стенда: xoxb-fake-token-not-a-real-secret",
].join("\n");

const FIXTURES = [
  "112-233-565 01",
  "500100732259",
  "7707083893",
  "1027700132195",
  "4111 1111 1111 1111",
  "DE89370400440532013000",
];

describe("D-17: правила-детекторы в конвейере маскирования", () => {
  it("дефолт конфига содержит rules", () => {
    expect(GUI_DEFAULT).toContain("rules");
  });

  it("maskText с дефолтными детекторами не оставляет фикстур открытым текстом", () => {
    const registry = new RunRegistry(DOC);
    const res = maskText(DOC, registry, GUI_DEFAULT);
    for (const secret of FIXTURES) {
      expect(res.text, `утекает: ${secret}`).not.toContain(secret);
    }
  });

  it("round-trip: unmask восстанавливает документ байт-в-байт", () => {
    const registry = new RunRegistry(DOC);
    const res = maskText(DOC, registry, GUI_DEFAULT);
    expect(unmaskText(res.text, registry).text).toBe(DOC);
  });
});
