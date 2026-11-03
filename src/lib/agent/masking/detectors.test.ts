import {describe, expect, it} from "vitest";

import {detectText, mergeSpans} from "./detectors";
import type {DetectorSpan} from "./types";

const ALL = ["secrets", "email", "phone", "url_credentials"] as const;

describe("detectText — email", () => {
  it("находит e-mail на границе слов", () => {
    const spans = detectText("Пишите на ivanov@example.com сегодня.", ALL);
    expect(spans.map((s) => s.value)).toEqual(["ivanov@example.com"]);
    expect(spans[0]?.type).toBe("EMAIL");
  });

  it("кириллица вплотную не мешает — значение всё равно маскируется (анти-\\b)", () => {
    // \\b по кириллице не работает; lookaround-семантика здесь безопасная:
    // склеенное «адресатivanov@example.com» — утечка, маскируем.
    const spans = detectText("адресатivanov@example.com получатель", ALL);
    expect(spans.map((s) => s.value)).toEqual(["ivanov@example.com"]);
  });
});

describe("detectText — phone", () => {
  it("находит RU-форматы", () => {
    const spans = detectText(
      "Звоните: +7 (495) 123-45-67 или 8-912-345-67-89.",
      ALL,
    );
    expect(spans.map((s) => s.type)).toEqual(["PHONE", "PHONE"]);
    expect(spans.map((s) => s.value)).toEqual([
      "+7 (495) 123-45-67",
      "8-912-345-67-89",
    ]);
  });

  it("не маскирует числа документов", () => {
    const spans = detectText("Договор № 812345678 от 2026 года.", ALL);
    expect(spans.filter((s) => s.type === "PHONE")).toEqual([]);
  });
});

describe("detectText — url_credentials", () => {
  it("находит логин:пароль в URL", () => {
    const spans = detectText("База: postgres://admin:s3cret@db.local:5432/app", ALL);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.type).toBe("URL_CRED");
    expect(spans[0]?.value).toContain("admin:s3cret@");
  });
});

describe("detectText — secrets", () => {
  it("KEY=value: маскируется только значение, ключ виден (R5)", () => {
    const text = "API_KEY=sk-proj-abcdefghijklmnopqrstuvwx";
    const spans = detectText(text, ALL);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe("sk-proj-abcdefghijklmnopqrstuvwx");
    expect(text.slice(0, spans[0]!.start)).toBe("API_KEY=");
  });

  it("русские ключи ловятся (R6)", () => {
    const spans = detectText("пароль: SuperSecret123", ALL);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.value).toBe("SuperSecret123");
  });

  it("quoted-значение с пробелами маскируется целиком", () => {
    const spans = detectText('client_secret = "very secret value here"', ALL);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.value).toBe('"very secret value here"');
  });

  it("PEM-блок маскируется целиком, мультистрока (R10)", () => {
    const text = [
      "before",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890",
      "more lines here",
      "-----END RSA PRIVATE KEY-----",
      "after",
    ].join("\n");
    const spans = detectText(text, ALL);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.value.startsWith("-----BEGIN")).toBe(true);
    expect(spans[0]!.value.endsWith("-----END RSA PRIVATE KEY-----")).toBe(true);
  });

  it("JWT, ghp_, AKIA, xox, sk- распознаются как SECRET", () => {
    const text = [
      "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "github ghp_abcdefghijklmnopqrstuvwxyz012345",
      "aws AKIAIOSFODNN7EXAMPLE",
      // Фикстур без длинных цифр — чтобы не совпадать с реальным паттерном
      // Slack-токена и не триггерить GitHub push protection (урок 20261104).
      "slack xoxb-fake-token-not-a-real-secret",
    ].join(" | ");
    const spans = detectText(text, ALL);
    expect(spans.filter((s) => s.type === "SECRET")).toHaveLength(4);
  });
});

describe("detectText — пересечения (R8)", () => {
  it("URL с credentials внутри token=… — один спан, без пересечений", () => {
    const text = "token: https://user:pass@example.com/path";
    const spans = detectText(text, ALL);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.type).toBe("URL_CRED");
  });

  it("mergeSpans убирает вложенные спаны (longest-wins)", () => {
    const a: DetectorSpan = {start: 0, end: 10, value: "0123456789", type: "SECRET", detector: "secrets"};
    const b: DetectorSpan = {start: 2, end: 6, value: "2345", type: "URL_CRED", detector: "url_credentials"};
    expect(mergeSpans([b, a])).toEqual([a]);
  });
});

describe("detectText — выключенные детекторы", () => {
  it("пустой список — текст не трогается", () => {
    expect(detectText("mail@example.com +7 495 123-45-67", [])).toEqual([]);
  });

  it("только phone — e-mail не находится", () => {
    const spans = detectText("mail@example.com", ["phone"]);
    expect(spans).toEqual([]);
  });
});
