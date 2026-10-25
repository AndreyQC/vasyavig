import {describe, expect, it} from "vitest";
import {
  findUlidMatches,
  isPlausibleUlid,
  isValidUlidShape,
  parseBookmarkUlid,
  parseHarnessEnvelope,
} from "./harnessEnvelope";

/** Эталонная шапка задачного файла из harness-репо (lm_hrdo_2). */
const TASK_FILE = `<!-- [<[harness-yaml]]
id: 01M43R3ZGSNXQ0KSMZ9JSZEZ5W
project: lm_hrdo_2
title: "Etl Generator Entity Paths \u00b7 2026-09-21"
type: plan
created: 2026-09-21
related: []
[[harness-yaml]>] -->

> \u{1F516} **harness-yaml** \u00b7 документ в реестре \u00b7 id \`01M43R3ZGSNXQ0KSMZ9JSZEZ5W\` \u00b7 метаданные \u2014 в source

<!-- [<[task-yaml]]
kind: daily-task
status: done
task: 20260921_622
tracker: ""
priority: ""
assignee: ""
[[task-yaml]>] -->

# Etl Generator Entity Paths

**План:** [ссылка](plan.md)
`;

describe("parseHarnessEnvelope", () => {
  it("разбирает эталонный конверт (title с кавычками не обязателен, пустой список)", () => {
    const env = parseHarnessEnvelope(TASK_FILE);
    expect(env).not.toBeNull();
    expect(env?.id).toBe("01M43R3ZGSNXQ0KSMZ9JSZEZ5W");
    expect(env?.project).toBe("lm_hrdo_2");
    expect(env?.title).toBe("Etl Generator Entity Paths · 2026-09-21");
    expect(env?.type).toBe("plan");
    expect(env?.created).toBe("2026-09-21");
    expect(env?.related).toEqual([]);
    expect(env?.basedOn).toEqual([]);
  });

  it("title с кавычкой внутри — escape \\\" раскрывается", () => {
    const text = [
      "<!-- [<[harness-yaml]]",
      'title: "Конверт \\"заказчика\\" — тест"',
      "type: doc",
      "[[harness-yaml]>] -->",
    ].join("\n");
    expect(parseHarnessEnvelope(text)?.title).toBe('Конверт "заказчика" — тест');
  });

  it("инлайн-список related и скаляр в based_on -> список", () => {
    const text = [
      "<!-- [<[harness-yaml]]",
      "id: 01M43R3ZGSNXQ0KSMZ9JSZEZ5W",
      "related: [01M43R3YYCBWXD01XW1RXPM575, 01M43R3YYGN9KRJGJA99RYS6N0]",
      "based_on: 01M43RG8JG8BDFTJCQV525AZ1S",
      "[[harness-yaml]>] -->",
    ].join("\n");
    const env = parseHarnessEnvelope(text);
    expect(env?.related).toEqual(["01M43R3YYCBWXD01XW1RXPM575", "01M43R3YYGN9KRJGJA99RYS6N0"]);
    expect(env?.basedOn).toEqual(["01M43RG8JG8BDFTJCQV525AZ1S"]);
  });

  it("маркер ниже 5-й строки конвертом не считается", () => {
    const text = ["", "", "", "", "", "<!-- [<[harness-yaml]]", "id: 01M43R3ZGSNXQ0KSMZ9JSZEZ5W", "[[harness-yaml]>] -->"].join("\n");
    expect(parseHarnessEnvelope(text)).toBeNull();
  });

  it("нет закрывающего маркера — повреждённый конверт -> null", () => {
    const text = "<!-- [<[harness-yaml]]\nid: 01M43R3ZGSNXQ0KSMZ9JSZEZ5W\n";
    expect(parseHarnessEnvelope(text)).toBeNull();
  });

  it("файл без конверта -> null", () => {
    expect(parseHarnessEnvelope("# Просто документ\n\nТекст\n")).toBeNull();
  });

  it("упоминание маркера в теле (не в шапке) — не конверт", () => {
    const text = "# Документ\n\n```\n[[harness-yaml]>]\n```\n";
    expect(parseHarnessEnvelope(text)).toBeNull();
  });

  it("CRLF-файл разбирается так же", () => {
    const text = TASK_FILE.split("\n").join("\r\n");
    expect(parseHarnessEnvelope(text)?.id).toBe("01M43R3ZGSNXQ0KSMZ9JSZEZ5W");
  });
});

describe("parseBookmarkUlid", () => {
  it("достаёт ULID из закладки", () => {
    expect(parseBookmarkUlid(TASK_FILE)).toBe("01M43R3ZGSNXQ0KSMZ9JSZEZ5W");
  });
  it("нет закладки -> null", () => {
    expect(parseBookmarkUlid("# Документ\n")).toBeNull();
  });
});

describe("ULID-валидация", () => {
  it("форма: 26 символов Crockford (без I L O U)", () => {
    expect(isValidUlidShape("01M43R3ZGSNXQ0KSMZ9JSZEZ5W")).toBe(true);
    expect(isValidUlidShape("01M43R3ZGSNXQ0KSMZ9JSZEZ5")).toBe(false); // 25
    expect(isValidUlidShape("01M43R3ZGSNXQ0KSMZ9JSZEZ5WI")).toBe(false); // 27
    expect(isValidUlidShape("01M43R3ZGSNXQ0KSMZ9JSZEZ5L")).toBe(false); // L вне алфавита
    expect(isValidUlidShape("01m43r3zgsnxq0ksmz9jszez5w")).toBe(false); // нижний регистр
  });

  it("plausible: таймстемп в окне 2020–2100", () => {
    expect(isPlausibleUlid("01M43R3ZGSNXQ0KSMZ9JSZEZ5W")).toBe(true); // 2026-10
    expect(isPlausibleUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false); // 2016 — ниже окна
    expect(isPlausibleUlid("7ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false); // ~10889 год
    expect(isPlausibleUlid("00000000000000000000000000")).toBe(false); // 1970
  });

  it("findUlidMatches: offsets, границы слов, фильтр мусора", () => {
    const text =
      "см. 01M43R3ZGSNXQ0KSMZ9JSZEZ5W и префикс 01M43R3ZGS, мусор ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const matches = findUlidMatches(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].ulid).toBe("01M43R3ZGSNXQ0KSMZ9JSZEZ5W");
    expect(text.slice(matches[0].start, matches[0].end)).toBe(matches[0].ulid);
  });

  it("findUlidMatches: ULID внутри более длинного токена не матчится", () => {
    expect(findUlidMatches("x01M43R3ZGSNXQ0KSMZ9JSZEZ5W")).toHaveLength(0);
    expect(findUlidMatches("01M43R3ZGSNXQ0KSMZ9JSZEZ5Wx")).toHaveLength(0);
  });
});
