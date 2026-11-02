import {describe, expect, it} from "vitest";
import {
  buildEmailMetaMessages,
  buildEmailRepairMessages,
  MAX_PREHEADER_CHARS,
  MAX_SUBJECT_CHARS,
  parseEmailMeta,
} from "./emailHtml";

describe("buildEmailMetaMessages", () => {
  it("system+user: документ и имя, без абсолютных путей", () => {
    const messages = buildEmailMetaMessages({
      docName: "a.md",
      document: "# План\n\nСодержимое документа",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("Документ: a.md");
    expect(messages[1].content).toContain("# План");
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("C:\\");
    expect(serialized).not.toContain("file://");
  });
});

describe("buildEmailRepairMessages", () => {
  it("прежний ответ + нумерованный список ошибок", () => {
    const base = buildEmailMetaMessages({docName: "a.md", document: "текст"});
    const repair = buildEmailRepairMessages(base, '{"subject":""}', ["пустая тема"]);
    expect(repair).toHaveLength(4);
    expect(repair[2].role).toBe("assistant");
    expect(repair[2].content).toBe('{"subject":""}');
    expect(repair[3].role).toBe("user");
    expect(repair[3].content).toContain("1. пустая тема");
  });
});

describe("parseEmailMeta", () => {
  it("валидный объект принимается", () => {
    const result = parseEmailMeta('{"subject": "Отчёт за неделю", "preheader": "Коротко о главном"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.subject).toBe("Отчёт за неделю");
      expect(result.meta.preheader).toBe("Коротко о главном");
    }
  });

  it("preheader необязателен", () => {
    const result = parseEmailMeta('{"subject": "Тема"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.meta.preheader).toBe("");
  });

  it("```json-обёртка и окружающий текст снимаются", () => {
    const fenced = '```json\n{"subject": "Тема", "preheader": ""}\n```';
    expect(parseEmailMeta(fenced).ok).toBe(true);
    const prose = 'Вот результат:\n{"subject": "Тема"}\nГотово.';
    expect(parseEmailMeta(prose).ok).toBe(true);
  });

  it("переводы строк в subject вычищаются пробелом", () => {
    const result = parseEmailMeta('{"subject": "строка\\nперенос"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.meta.subject).toBe("строка перенос");
  });

  it("не JSON, пустой ответ, не объект — ошибки", () => {
    expect(parseEmailMeta("не json").ok).toBe(false);
    expect(parseEmailMeta("").ok).toBe(false);
    expect(parseEmailMeta('"строка"').ok).toBe(false);
    expect(parseEmailMeta("[]").ok).toBe(false);
  });

  it("subject отсутствует/пуст — ошибка", () => {
    expect(parseEmailMeta('{"preheader": "x"}').ok).toBe(false);
    expect(parseEmailMeta('{"subject": "   "}').ok).toBe(false);
    const result = parseEmailMeta('{"subject": null}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("subject");
  });

  it("лишние поля — ошибка", () => {
    const result = parseEmailMeta('{"subject": "Т", "body": "тело писать нельзя"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("body");
  });

  it("превышение лимитов — ошибка", () => {
    const longSubject = "т".repeat(MAX_SUBJECT_CHARS + 1);
    expect(parseEmailMeta(JSON.stringify({subject: longSubject})).ok).toBe(false);
    const longPreheader = "п".repeat(MAX_PREHEADER_CHARS + 1);
    expect(parseEmailMeta(JSON.stringify({subject: "т", preheader: longPreheader})).ok).toBe(false);
  });
});
