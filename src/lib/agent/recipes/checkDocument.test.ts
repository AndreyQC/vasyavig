import {describe, expect, it} from "vitest";
import type {Finding} from "../findings";
import {fixTargetFor, type ModelFixTarget} from "../fixes";
import {
  buildCheckMessages,
  buildFindingItems,
  buildRepairMessages,
  parseVerdicts,
  type FindingPromptItem,
} from "./checkDocument";

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "rule">): Finding {
  return {severity: "warning", messageKey: "assistant.finding.brokenAnchor", ...partial};
}

const CONTENT = "# Введение\n\nсм. [текст](#vvedenie-1)\n\n![Скрин](assets/old.png)\n";

function fixtures(): {
  findings: Finding[];
  map: Map<string, Finding>;
  targets: Map<string, ModelFixTarget>;
} {
  const findings = [
    finding({id: "anchors-3-1", rule: "anchors", line: 3, params: {fragment: "vvedenie-1"}}),
    finding({id: "images-5-1", rule: "images", line: 5, params: {target: "assets/old.png"}}),
    finding({id: "toc-0-1", rule: "toc", severity: "info", messageKey: "assistant.finding.tocMissing"}),
  ];
  const targets = new Map<string, ModelFixTarget>();
  for (const item of findings) {
    const target = fixTargetFor(item, CONTENT);
    if (target) targets.set(item.id, target);
  }
  return {findings, map: new Map(findings.map((item) => [item.id, item])), targets};
}

function itemsFor(proposedIds: ReadonlySet<string> = new Set()): FindingPromptItem[] {
  const {findings, targets} = fixtures();
  return buildFindingItems(findings, targets, proposedIds);
}

describe("buildFindingItems", () => {
  it("fixable findings получают target и формат replacement", () => {
    const items = itemsFor();
    const anchor = items.find((item) => item.id === "anchors-3-1");
    expect(anchor?.fixable).toBe(true);
    expect(anchor?.proposed).toBe(false);
    expect(anchor?.target).toBe("](#vvedenie-1)");
    expect(anchor?.replacementFormat).toContain("якорь");

    const image = items.find((item) => item.id === "images-5-1");
    expect(image?.fixable).toBe(true);
    expect(image?.target).toBe("![Скрин](assets/old.png)");

    const toc = items.find((item) => item.id === "toc-0-1");
    expect(toc?.fixable).toBe(false);
    expect(toc?.target).toBeUndefined();
  });

  it("proposed findings не получают target", () => {
    const items = itemsFor(new Set(["anchors-3-1"]));
    const anchor = items.find((item) => item.id === "anchors-3-1");
    expect(anchor?.proposed).toBe(true);
    expect(anchor?.target).toBeUndefined();
  });
});

describe("buildCheckMessages", () => {
  it("system+user: документ, выделение и findings JSON; без абсолютных путей", () => {
    const messages = buildCheckMessages({
      docName: "a.md",
      document: CONTENT,
      selection: "выделенный фрагмент",
      items: itemsFor(),
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    const user = messages[1].content;
    expect(user).toContain("Документ: a.md");
    expect(user).toContain("см. [текст](#vvedenie-1)");
    expect(user).toContain("Выделение в документе:");
    expect(user).toContain('"anchors-3-1"');
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("C:\\");
    expect(serialized).not.toContain("file://");
  });

  it("пустое выделение не попадает в промпт", () => {
    const messages = buildCheckMessages({docName: "a.md", document: CONTENT, selection: "", items: []});
    expect(messages[1].content).not.toContain("Выделение");
  });
});

describe("buildRepairMessages", () => {
  it("прежний ответ + нумерованный список ошибок", () => {
    const base = buildCheckMessages({docName: "a.md", document: CONTENT, items: itemsFor()});
    const repair = buildRepairMessages(base, '{"verdicts":[]}', ["ошибка 1", "ошибка 2"]);
    expect(repair).toHaveLength(4);
    expect(repair[2].role).toBe("assistant");
    expect(repair[2].content).toBe('{"verdicts":[]}');
    expect(repair[3].role).toBe("user");
    expect(repair[3].content).toContain("1. ошибка 1");
    expect(repair[3].content).toContain("2. ошибка 2");
  });
});

describe("parseVerdicts", () => {
  const {map} = fixtures();

  it("валидный объект {verdicts: [...]} принимается", () => {
    const result = parseVerdicts(
      JSON.stringify({
        verdicts: [
          {findingId: "anchors-3-1", action: "fix", replacement: "введение", rationale: "якорь существует"},
          {findingId: "toc-0-1", action: "explain", rationale: "вставить оглавление вручную"},
        ],
      }),
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts).toHaveLength(2);
    expect(result.verdicts[0]).toEqual({
      findingId: "anchors-3-1",
      action: "fix",
      replacement: "введение",
      rationale: "якорь существует",
    });
  });

  it("голый массив, ```-обёртка и текст вокруг JSON допускаются", () => {
    const bare = parseVerdicts(
      '[{"findingId":"toc-0-1","action":"keep","rationale":"ok"}]',
      map,
    );
    expect(bare.ok).toBe(true);

    const fenced = parseVerdicts(
      'Вот ответ:\n```json\n{"verdicts":[{"findingId":"toc-0-1","action":"keep","rationale":"ok"}]}\n```\n',
      map,
    );
    expect(fenced.ok).toBe(true);
  });

  it("неизвестный findingId — ошибка валидации", () => {
    const result = parseVerdicts(
      '{"verdicts":[{"findingId":"anchors-99-9","action":"keep"}]}',
      map,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("anchors-99-9");
  });

  it("дубликат, неверный action и не-JSON — ошибки", () => {
    const duplicate = parseVerdicts(
      '{"verdicts":[{"findingId":"toc-0-1","action":"keep"},{"findingId":"toc-0-1","action":"keep"}]}',
      map,
    );
    expect(duplicate.ok).toBe(false);

    const badAction = parseVerdicts(
      '{"verdicts":[{"findingId":"toc-0-1","action":"delete"}]}',
      map,
    );
    expect(badAction.ok).toBe(false);

    const notJson = parseVerdicts("совсем не JSON", map);
    expect(notJson.ok).toBe(false);
  });

  it("fix требует replacement, поддерживаемое правило и валидную схему", () => {
    const noReplacement = parseVerdicts(
      '{"verdicts":[{"findingId":"anchors-3-1","action":"fix"}]}',
      map,
    );
    expect(noReplacement.ok).toBe(false);

    const notFixable = parseVerdicts(
      '{"verdicts":[{"findingId":"toc-0-1","action":"fix","replacement":"x"}]}',
      map,
    );
    expect(notFixable.ok).toBe(false);

    const badSchema = parseVerdicts(
      '{"verdicts":[{"findingId":"anchors-3-1","action":"fix","replacement":"с пробелом"}]}',
      map,
    );
    expect(badSchema.ok).toBe(false);

    const good = parseVerdicts(
      '{"verdicts":[{"findingId":"images-5-1","action":"fix","replacement":"assets/new.png"}]}',
      map,
    );
    expect(good.ok).toBe(true);
  });

  it("replacement у keep/explain — ошибка; rationale обрезается до 2000", () => {
    const withReplacement = parseVerdicts(
      '{"verdicts":[{"findingId":"toc-0-1","action":"keep","replacement":"x"}]}',
      map,
    );
    expect(withReplacement.ok).toBe(false);

    const long = "д".repeat(3000);
    const result = parseVerdicts(
      JSON.stringify({verdicts: [{findingId: "toc-0-1", action: "explain", rationale: long}]}),
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts[0].rationale).toHaveLength(2000);
  });

  it("пустой ответ — ошибка", () => {
    expect(parseVerdicts("", map).ok).toBe(false);
    expect(parseVerdicts("   \n  ", map).ok).toBe(false);
  });
});
