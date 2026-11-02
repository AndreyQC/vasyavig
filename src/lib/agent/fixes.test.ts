import {describe, expect, it} from "vitest";
import {applyInsert, applyReplaceAll} from "./proposals";
import {collectFindings, type Finding, type FindingRule} from "./findings";
import {
  deterministicFixFor,
  fixTargetFor,
  MODEL_FIXABLE_RULES,
  validateModelReplacement,
} from "./fixes";
import {applyTocInsert, applyTocReplace, buildTocPlan} from "../generateToc";

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "rule">): Finding {
  return {severity: "warning", messageKey: "assistant.finding.brokenAnchor", ...partial};
}

describe("deterministicFixFor", () => {
  it("tocStale: старый блок заменяется списком из buildTocPlan", async () => {
    const content = [
      "# Doc",
      "",
      "## Оглавление",
      "",
      "- [Old](#old)",
      "",
      "## Intro",
      "",
      "text",
    ].join("\n");
    const findings = await collectFindings({content, path: "a.md", rules: ["toc"]});
    const stale = findings.find((item) => item.messageKey === "assistant.finding.tocStale");
    expect(stale).toBeTruthy();

    const fix = deterministicFixFor(stale as Finding, content);
    expect(fix?.kind).toBe("replace");
    if (fix?.kind !== "replace") return;
    expect(applyReplaceAll(content, fix.oldText, fix.newText)).toBe(applyTocReplace(content));
    expect(fix.newText).toBe(buildTocPlan(content).list);
  });

  it("tocMissing: блок вставляется после первой непустой строки", async () => {
    const content = ["<!-- envelope -->", "", "# Title", "", "## Section", "", "body"].join("\n");
    const findings = await collectFindings({content, path: "a.md", rules: ["toc"]});
    const missing = findings.find((item) => item.messageKey === "assistant.finding.tocMissing");
    expect(missing).toBeTruthy();

    const fix = deterministicFixFor(missing as Finding, content);
    expect(fix?.kind).toBe("insert");
    if (fix?.kind !== "insert") return;
    expect(fix.anchor).toBe("# Title");
    expect(fix.position).toBe("before");
    const result = applyInsert(content, fix.anchor, fix.position, fix.text);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.indexOf("<!-- envelope -->")).toBeLessThan(result.indexOf("## Оглавление"));
    expect(result.indexOf("## Оглавление")).toBeLessThan(result.indexOf("# Title"));
    expect(result).toContain("- [Title](#title)");
  });

  it("tocMissing для файла без шапки совпадает с applyTocInsert", () => {
    const content = ["# Title", "", "## Section"].join("\n");
    const fix = deterministicFixFor(
      finding({id: "toc-0-1", rule: "toc", messageKey: "assistant.finding.tocMissing"}),
      content,
    );
    expect(fix?.kind).toBe("insert");
    if (fix?.kind !== "insert") return;
    expect(applyInsert(content, fix.anchor, fix.position, fix.text)).toBe(applyTocInsert(content));
  });

  it("percentCyrillic: %-кодированная кириллица декодируется", () => {
    const content = "[Глава](1_%D0%B3%D0%BB%D0%B0%D0%B2%D0%B0.md) и текст\n";
    const fix = deterministicFixFor(
      finding({
        id: "links-1-1",
        rule: "links",
        messageKey: "assistant.finding.percentCyrillic",
        line: 1,
      }),
      content,
    );
    expect(fix).toEqual({
      kind: "replace",
      oldText: "](1_%D0%B3%D0%BB%D0%B0%D0%B2%D0%B0.md)",
      newText: "](1_глава.md)",
    });
  });

  it("escapedUnderscore: \\_ в пути заменяется на _", () => {
    const content = "![Рисунок](assets\\_img.png)\n";
    const fix = deterministicFixFor(
      finding({
        id: "links-1-2",
        rule: "links",
        messageKey: "assistant.finding.escapedUnderscore",
        line: 1,
      }),
      content,
    );
    expect(fix).toEqual({
      kind: "replace",
      oldText: "](assets\\_img.png)",
      newText: "](assets_img.png)",
    });
  });

  it("legacyUlid: схема заменяется на harness-ulid:", () => {
    const content = "[Документ](harness_ulid:01J8Z2X7K3M5Q9W2E4R6T8Y0UC)\n";
    const fix = deterministicFixFor(
      finding({
        id: "links-1-3",
        rule: "links",
        messageKey: "assistant.finding.legacyUlid",
        line: 1,
      }),
      content,
    );
    expect(fix).toEqual({
      kind: "replace",
      oldText: "](harness_ulid:01J8Z2X7K3M5Q9W2E4R6T8Y0UC)",
      newText: "](harness-ulid:01J8Z2X7K3M5Q9W2E4R6T8Y0UC)",
    });
  });

  it("ссылочный фикс не строится, если строки нет или target не подпадает", () => {
    const content = "обычный текст\n";
    const none = deterministicFixFor(
      finding({
        id: "links-1-1",
        rule: "links",
        messageKey: "assistant.finding.percentCyrillic",
        line: 1,
      }),
      content,
    );
    expect(none).toBeNull();

    const beyond = deterministicFixFor(
      finding({
        id: "links-9-1",
        rule: "links",
        messageKey: "assistant.finding.percentCyrillic",
        line: 9,
      }),
      content,
    );
    expect(beyond).toBeNull();
  });

  it("недетерминированные правила не получают локальный фикс", async () => {
    const content = "# A\n\nсм. [текст](#missing)\n";
    const findings = await collectFindings({content, path: "a.md", rules: ["anchors", "headings"]});
    for (const item of findings) {
      expect(deterministicFixFor(item, content)).toBeNull();
    }
    for (const rule of ["envelope", "images"] as FindingRule[]) {
      const synthetic = finding({id: `${rule}-1-1`, rule, line: 1});
      expect(deterministicFixFor(synthetic, content)).toBeNull();
    }
  });
});

describe("fixTargetFor", () => {
  it("brokenAnchor: target — точный фрагмент ссылки с якорем", () => {
    const content = "# Введение\n\nсм. [текст](#vvedenie-1)\n";
    const target = fixTargetFor(
      finding({id: "anchors-3-1", rule: "anchors", line: 3, params: {fragment: "vvedenie-1"}}),
      content,
    );
    expect(target?.oldText).toBe("](#vvedenie-1)");
    expect(target?.newTextFor("введение")).toBe("](#введение)");
  });

  it("imageUnresolved: target — весь image-match", () => {
    const content = "![Скрин](assets/old.png)\n";
    const target = fixTargetFor(
      finding({id: "images-1-1", rule: "images", line: 1, params: {target: "assets/old.png"}}),
      content,
    );
    expect(target?.oldText).toBe("![Скрин](assets/old.png)");
    expect(target?.newTextFor("assets/new.png")).toBe("![Скрин](assets/new.png)");
  });

  it("несовпадающий фрагмент/строка/правило дают null", () => {
    const content = "# A\n\nсм. [текст](#other)\n";
    expect(
      fixTargetFor(
        finding({id: "anchors-2-1", rule: "anchors", line: 2, params: {fragment: "missing-1"}}),
        content,
      ),
    ).toBeNull();
    expect(
      fixTargetFor(
        finding({id: "anchors-9-1", rule: "anchors", line: 9, params: {fragment: "other"}}),
        content,
      ),
    ).toBeNull();
    expect(
      fixTargetFor(finding({id: "toc-0-1", rule: "toc", line: 1}), content),
    ).toBeNull();
  });

  it("MODEL_FIXABLE_RULES — только anchors и images", () => {
    expect(MODEL_FIXABLE_RULES).toEqual(["anchors", "images"]);
  });
});

describe("validateModelReplacement", () => {
  const anchor = finding({id: "anchors-1-1", rule: "anchors", line: 1});
  const image = finding({id: "images-1-1", rule: "images", line: 1});

  it("якорь: без #, пробелов и скобок", () => {
    expect(validateModelReplacement(anchor, " новый-якорь ")).toBeNull();
    expect(validateModelReplacement(anchor, "с пробелом")).toContain("якорь");
    expect(validateModelReplacement(anchor, "#якорь")).toContain("якорь");
    expect(validateModelReplacement(anchor, "фраг(мент)")).toContain("якорь");
    expect(validateModelReplacement(anchor, "")).toContain("replacement");
  });

  it("путь картинки: относительный, без '..' и внешних схем", () => {
    expect(validateModelReplacement(image, "assets/new.png")).toBeNull();
    expect(validateModelReplacement(image, "http://example.com/a.png")).toContain("относительным");
    expect(validateModelReplacement(image, "../a.png")).toContain("'..'");
    expect(validateModelReplacement(image, "/abs/a.png")).toContain("относительным");
    expect(validateModelReplacement(image, "a b.png")).toContain("пробелы");
  });
});
