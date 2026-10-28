import {describe, expect, it} from "vitest";
import type {FileNode} from "../types";
import {filterQuickOpen, flattenFiles, fuzzyScore} from "./quickOpen";

const file = (path: string, children: FileNode[] | null = null): FileNode => ({
  name: path.split("/").pop()!,
  path,
  isDir: children !== null,
  children,
});

const TREE: Record<string, FileNode[]> = {
  "C:/docs": [
    file("C:/docs/README.md"),
    file("C:/docs/img", [file("C:/docs/img/logo.png")]),
    file("C:/docs/notes.txt"),
    file("C:/docs/data.xyz"), // unsupported — не индексируется
  ],
};

describe("flattenFiles", () => {
  it("рекурсивно собирает файлы поддерживаемых типов", () => {
    const entries = flattenFiles(TREE);
    expect(entries.map((e) => e.path)).toEqual([
      "C:/docs/README.md",
      "C:/docs/img/logo.png",
      "C:/docs/notes.txt",
    ]);
  });

  it("dir у записи — каталог файла", () => {
    const entries = flattenFiles(TREE);
    expect(entries.find((e) => e.name === "logo.png")?.dir).toBe("C:/docs/img");
  });
});

describe("fuzzyScore", () => {
  it("пустой запрос — 0 (все совпадают)", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("нет подпоследовательности — null", () => {
    expect(fuzzyScore("xz", "readme.md")).toBeNull();
  });

  it("подряд идущие совпадения лучше разбросанных", () => {
    expect(fuzzyScore("ab", "ab.txt")!).toBeGreaterThan(fuzzyScore("ab", "a_x_b.txt")!);
  });

  it("совпадение с начала имени лучше", () => {
    expect(fuzzyScore("no", "notes.txt")!).toBeGreaterThan(fuzzyScore("no", "plan_oq.md")!);
  });
});

describe("filterQuickOpen", () => {
  const entries = flattenFiles(TREE);

  it("пустой запрос — все записи в исходном порядке", () => {
    expect(filterQuickOpen(entries, "")).toHaveLength(3);
  });

  it("фильтрует по подпоследовательности имени", () => {
    const result = filterQuickOpen(entries, "rdm");
    expect(result.map((e) => e.name)).toEqual(["README.md"]);
  });

  it("limit ограничивает выдачу", () => {
    const many = Array.from({length: 80}, (_, i) => ({path: `C:/f${i}.md`, name: `f${i}.md`, dir: "C:"}));
    expect(filterQuickOpen(many, "f")).toHaveLength(50);
  });
});
