import {describe, expect, it} from "vitest";

import {detectText} from "./detectors";
import {maskText} from "./mask";
import {RunRegistry} from "./registry";
import {missingAliasIds, scanUnknownAliases, unmaskText} from "./unmask";
import {resetUlidMonotonic} from "./ulid";

const ALL = ["secrets", "email", "phone", "url_credentials"] as const;

const DOC = [
  "Связь: ivanov@example.com, тел. +7 (495) 123-45-67.",
  "API_KEY=sk-proj-abcdefghijklmnopqrstuvwx",
  "Пароль от стенда: SuperSecret123.",
].join("\n");

describe("RunRegistry — стабильность алиасов", () => {
  it("одно и то же значение → один ULID/алиас (критерий T1)", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry("текст без коллизий");
    const a = registry.createOrGet("ivanov@example.com", "EMAIL");
    const b = registry.createOrGet("ivanov@example.com", "EMAIL");
    expect(b.ulid).toBe(a.ulid);
    expect(registry.aliasOf(a)).toMatch(/^\[\[VAS_EMAIL_[0-9A-HJKMNP-TV-Z]{26}\]\]$/);
  });

  it("разные значения или типы → разные ULID", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry("текст");
    const a = registry.createOrGet("a@example.com", "EMAIL");
    const b = registry.createOrGet("b@example.com", "EMAIL");
    const c = registry.createOrGet("a@example.com", "PERSON");
    expect(new Set([a.ulid, b.ulid, c.ulid]).size).toBe(3);
  });
});

describe("maskText + unmaskText — round-trip", () => {
  it("значения восстанавливаются байт-в-байт (критерий T1)", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry(DOC);
    const masked = maskText(DOC, registry, ALL);
    expect(masked.count).toBeGreaterThan(0);
    expect(masked.text).not.toContain("ivanov@example.com");
    expect(masked.text).not.toContain("SuperSecret123");
    expect(masked.text).toContain("API_KEY="); // R5: ключ виден

    const unmasked = unmaskText(masked.text, registry);
    expect(unmasked.unknown).toEqual([]);
    expect(unmasked.text).toBe(DOC);
  });

  it("статистика по типам — без значений (критерий T1, D8)", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry(DOC);
    const masked = maskText(DOC, registry, ALL);
    expect(Object.keys(masked.stats).sort()).toEqual(["EMAIL", "PHONE", "SECRET"]);
    expect(JSON.stringify(masked.stats)).not.toContain("@");
    expect(JSON.stringify(masked.stats)).not.toContain("sk-proj");
  });

  it("maskText выключенных детекторов не меняет текст", () => {
    const registry = new RunRegistry(DOC);
    const masked = maskText(DOC, registry, []);
    expect(masked.count).toBe(0);
    expect(masked.text).toBe(DOC);
  });
});

describe("коллизия разделителя (R9)", () => {
  it("текст с [[VAS_ → префикс {{VAS_", () => {
    resetUlidMonotonic();
    const text = 'Смотри [[VAS_пример]] в документе. Пишите mail@example.com';
    const registry = new RunRegistry(text);
    const masked = maskText(text, registry, ALL);
    expect(masked.prefix).toBe("{{VAS_");
    expect(masked.text).toContain("{{VAS_EMAIL_");
    expect(unmaskText(masked.text, registry).text).toBe(text);
  });

  it("текст с [[VAS_ и {{VAS_ → префикс <<VAS_", () => {
    resetUlidMonotonic();
    const text = "[[VAS_а]] и {{VAS_б}}, а также tel@example.com";
    const registry = new RunRegistry(text);
    const masked = maskText(text, registry, ALL);
    expect(masked.prefix).toBe("<<VAS_");
    expect(unmaskText(masked.text, registry).text).toBe(text);
  });
});

describe("валидация ответа модели (§3.9 п.5)", () => {
  it("scanUnknownAliases находит алиасы вне реестра", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry("текст");
    const known = registry.aliasOf(registry.createOrGet("x@example.com", "EMAIL"));
    const fake = "[[VAS_EMAIL_01AAAAAAAAAAAAAAAAAAAAAAAA]]";
    const text = `упомянуты ${known} и ${fake}`;
    expect(scanUnknownAliases(text, registry)).toEqual([fake]);
  });

  it("missingAliasIds: алиас есть в промпте, потерян в ответе", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry("текст");
    const kept = registry.createOrGet("kept@example.com", "EMAIL");
    const lost = registry.createOrGet("lost@example.com", "EMAIL");
    const prompt = `письма: ${registry.aliasOf(kept)} и ${registry.aliasOf(lost)}`;
    const response = `в ответе только ${registry.aliasOf(kept)}`;
    expect(missingAliasIds(prompt, response, registry).map((r) => r.ulid)).toEqual([lost.ulid]);
  });

  it("unmaskText оставляет неизвестный алиас как есть и сообщает о нём", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry("текст");
    const fake = "[[VAS_ORG_01AAAAAAAAAAAAAAAAAAAAAAAA]]";
    const result = unmaskText(`в тексте ${fake} остался`, registry);
    expect(result.unknown).toEqual([fake]);
    expect(result.text).toBe(`в тексте ${fake} остался`);
  });
});

describe("детекторы работают через maskText (интеграция)", () => {
  it("детектированные спаны согласованы с maskText", () => {
    resetUlidMonotonic();
    const registry = new RunRegistry(DOC);
    const masked = maskText(DOC, registry, ALL);
    expect(masked.count).toBe(detectText(DOC, ALL).length);
    expect(registry.size).toBe(masked.count);
  });
});
