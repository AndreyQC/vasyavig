import {describe, expect, it} from "vitest";
import {collectFindings} from "./findings";

const PATH = "C:\\ws\\docs\\a.md";

describe("collectFindings: links", () => {
  it("находит %-кириллицу, \\_ и legacy-схему ULID", async () => {
    const content = [
      "# Doc",
      "",
      "[one](docs/%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80.md)",
      "[two](docs/a\\_b.md)",
      "[three](harness_ulid:01JG2S4H6K)",
    ].join("\n");

    const findings = await collectFindings({content, path: PATH, rules: ["links"]});
    expect(findings.map((item) => item.rule)).toEqual(["links", "links", "links"]);
    expect(findings.map((item) => item.line)).toEqual([3, 4, 5]);
    expect(findings[0].messageKey).toBe("assistant.finding.percentCyrillic");
  });

  it("не считает обычные ссылки проблемой", async () => {
    const content = "[ok](docs/plain.md)\n[web](https://example.com/%D0%BF)";
    const findings = await collectFindings({content, path: PATH, rules: ["links"]});
    expect(findings).toHaveLength(0);
  });
});

describe("collectFindings: anchors and headings", () => {
  it("находит битый локальный якорь", async () => {
    const content = ["# Title", "", "## Section", "", "[go](#missing)", "[ok](#section)"].join("\n");
    const findings = await collectFindings({content, path: PATH, rules: ["anchors"]});
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "anchors",
      line: 5,
      messageKey: "assistant.finding.brokenAnchor",
      params: {fragment: "missing"},
    });
  });

  it("находит дубли custom-id", async () => {
    const content = "# One {#same}\n\n# Two {#same}\n";
    const findings = await collectFindings({content, path: PATH, rules: ["headings"]});
    expect(findings).toHaveLength(1);
    expect(findings[0].params).toEqual({id: "same", count: 2});
  });
});

describe("collectFindings: toc", () => {
  it("сообщает об отсутствующем оглавлении", async () => {
    const content = "# Doc\n\n## Section\n";
    const findings = await collectFindings({content, path: PATH, rules: ["toc"]});
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "toc",
      severity: "info",
      messageKey: "assistant.finding.tocMissing",
    });
  });

  it("сообщает об устаревшем оглавлении", async () => {
    const content = [
      "# Doc",
      "",
      "## Оглавление",
      "",
      "- [Wrong](#wrong)",
      "",
      "## Section",
    ].join("\n");
    const findings = await collectFindings({content, path: PATH, rules: ["toc"]});
    expect(findings).toHaveLength(1);
    expect(findings[0].messageKey).toBe("assistant.finding.tocStale");
    expect(findings[0].line).toBe(5);
  });
});

describe("collectFindings: envelope and images", () => {
  it("требует harness-конверт только в harness-репозитории", async () => {
    const content = "# Doc\n";
    const noHarness = await collectFindings({content, path: PATH, rules: ["envelope"]});
    expect(noHarness).toHaveLength(0);

    const harness = await collectFindings({
      content,
      path: PATH,
      rules: ["envelope"],
      harness: true,
    });
    expect(harness).toHaveLength(1);
    expect(harness[0].messageKey).toBe("assistant.finding.envelopeMissing");

    const broken = await collectFindings({
      content: "<!-- [<[harness-yaml]]\nid: x\n",
      path: PATH,
      rules: ["envelope"],
      harness: true,
    });
    expect(broken[0]).toMatchObject({
      severity: "error",
      messageKey: "assistant.finding.envelopeBroken",
    });
  });

  it("находит неразрешимую относительную картинку", async () => {
    const content = "# Doc\n\n![alt](missing.png)\n![web](https://example.com/a.png)";
    const checked: string[] = [];
    const findings = await collectFindings({
      content,
      path: PATH,
      rules: ["images"],
      fileExists: async (path) => {
        checked.push(path);
        return false;
      },
    });
    expect(checked).toHaveLength(1);
    expect(checked[0].replace(/\\/g, "/")).toBe("C:/ws/docs/missing.png");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      line: 3,
      params: {target: "missing.png"},
    });
  });
});

describe("collectFindings: limits and rules", () => {
  it("фильтрует правила", async () => {
    const content = "# Doc\n\n[go](#missing)\n[legacy](ulid:ABC)\n";
    const findings = await collectFindings({content, path: PATH, rules: ["anchors"]});
    expect(findings.every((item) => item.rule === "anchors")).toBe(true);
  });

  it("ограничивает число findings", async () => {
    const content = Array.from({length: 10}, (_, i) => `[go](#missing-${i})`).join("\n");
    const findings = await collectFindings({
      content,
      path: PATH,
      rules: ["anchors"],
      maxFindings: 2,
    });
    expect(findings).toHaveLength(2);
  });

  it("findings не содержат абсолютного пути", async () => {
    const content = "# Doc\n\n[go](#missing)\n";
    const findings = await collectFindings({content, path: PATH});
    expect(JSON.stringify(findings)).not.toContain("C:\\\\ws");
    expect(JSON.stringify(findings)).not.toContain("C:/ws");
  });
});
