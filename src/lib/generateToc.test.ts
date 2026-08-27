import {describe, expect, it} from "vitest";
import transform from "@diplodoc/transform";
import {applyTocInsert, applyTocReplace, buildTocList, buildTocPlan, collectHeadings} from "./generateToc";

const DOC = [
  "# 1. Введение",
  "",
  "## 1.1. Цель документа",
  "",
  "Текст раздела.",
  "",
  "# 2. Общее описание",
  "",
  "## Тест с пунктуацией, запятая!",
  "",
  "### 2.1. Вложенный",
  "",
  "##### Глубокий H5 (не в TOC)",
  "",
  "## 1.1. Цель документа",
  "",
].join("\n");

describe("collectHeadings", () => {
  it("собирает H1–H4 с вложенностью и github-слагами", () => {
    const headings = collectHeadings(DOC);
    expect(headings.map((h) => h.title)).toEqual([
      "1. Введение",
      "1.1. Цель документа",
      "2. Общее описание",
      "Тест с пунктуацией, запятая!",
      "2.1. Вложенный",
      "1.1. Цель документа",
    ]);
    expect(headings[0].href).toBe("#1-введение");
    expect(headings[1].href).toBe("#11-цель-документа");
    // дубль получает суффикс -1 — как github-slugger у transform
    expect(headings[5].href).toBe("#11-цель-документа-1");
  });

  it("слаги совпадают с якорями превью (supportGithubAnchors)", () => {
    const {result} = transform(DOC, {supportGithubAnchors: true});
    const anchors = [...result.html.matchAll(/<a[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    const ours = collectHeadings(DOC).map((h) => h.href.slice(1));
    for (const slug of ours) {
      expect(anchors).toContain(slug);
    }
  });

  it("поддерживает custom id {#my-id}", () => {
    const headings = collectHeadings("## Раздел {#custom-anchor}");
    expect(headings).toEqual([{level: 2, title: "Раздел", href: "#custom-anchor"}]);
  });
});

describe("buildTocList", () => {
  it("строит список с отступами 2 пробела на уровень", () => {
    const list = buildTocList(collectHeadings(DOC));
    expect(list.split("\n")[0]).toBe("- [1. Введение](#1-введение)");
    expect(list.split("\n")[1]).toBe("  - [1.1. Цель документа](#11-цель-документа)");
    expect(list).toContain("    - [2.1. Вложенный](#21-вложенный)");
  });
});

describe("buildTocPlan / apply", () => {
  const DOC_WITH_TOC = [
    "**Техническое задание**",
    "",
    "## Оглавление",
    "",
    "- [старый пункт](#старый)",
    "  - [подпункт](#подпункт)",
    "",
    "# 1. Введение",
    "",
    "Текст.",
  ].join("\n");

  it("находит существующий блок «Оглавление» и диапазон списка", () => {
    const plan = buildTocPlan(DOC_WITH_TOC);
    expect(plan.tocHeadingLine).toBe(2);
    expect(plan.listRange).toEqual({from: 4, to: 6});
  });

  it("replace подменяет список под заголовком", () => {
    const out = applyTocReplace(DOC_WITH_TOC);
    expect(out).toContain("## Оглавление");
    expect(out).toContain("- [1. Введение](#1-введение)");
    expect(out).not.toContain("#старый");
    expect(out).toContain("**Техническое задание**");
    expect(out).toContain("# 1. Введение");
  });

  it("insert добавляет блок оглавления в начало", () => {
    const out = applyTocInsert(DOC);
    expect(out.startsWith("## Оглавление\n\n- [1. Введение](#1-введение)")).toBe(true);
    expect(out.endsWith(DOC)).toBe(true);
  });

  it("заголовок без списка: replace вставляет список под заголовок", () => {
    const doc = "## Оглавление\n\n# Раздел один\n";
    const out = applyTocReplace(doc);
    expect(out).toBe("## Оглавление\n\n- [Раздел один](#раздел-один)\n\n# Раздел один\n");
  });

  it("без «Оглавление» tocHeadingLine = null", () => {
    expect(buildTocPlan(DOC).tocHeadingLine).toBeNull();
  });
});
