import {describe, expect, it} from "vitest";
import {normalizePath, pathsLosingRoot, resolveRoot} from "./roots";
import type {RootInfo} from "./rootColors";

const root = (path: string, color: RootInfo["color"] = "blue"): RootInfo => ({path, color});

describe("normalizePath", () => {
  it("приводит разделители и регистр", () => {
    expect(normalizePath("C:\\Docs\\A.md")).toBe("c:/docs/a.md");
    expect(normalizePath("C:/Docs/")).toBe("c:/docs");
  });

  it("корень диска не теряет последний символ", () => {
    expect(normalizePath("C:\\")).toBe("c:");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("resolveRoot", () => {
  it("матчит путь внутри корня независимо от разделителей и регистра", () => {
    const roots = [root("C:\\Docs")];
    expect(resolveRoot("c:/docs/a.md", roots)?.path).toBe("C:\\Docs");
    expect(resolveRoot("C:/DOCS/sub/b.md", roots)?.path).toBe("C:\\Docs");
  });

  it("не матчит соседний префикс без границы разделителя", () => {
    const roots = [root("C:/docs")];
    expect(resolveRoot("C:/docs2/a.md", roots)).toBeNull();
  });

  it("выбирает самый глубокий корень (вложенные корни)", () => {
    const roots = [root("C:/docs"), root("C:/docs/guides", "pink")];
    expect(resolveRoot("C:/docs/guides/intro.md", roots)?.path).toBe("C:/docs/guides");
    expect(resolveRoot("C:/docs/other.md", roots)?.path).toBe("C:/docs");
    expect(resolveRoot("C:/docs/guides", roots)?.path).toBe("C:/docs/guides");
  });

  it("файл вне корней — null", () => {
    const roots = [root("C:/docs"), root("D:\\work", "red")];
    expect(resolveRoot("D:/other/x.md", roots)).toBeNull();
    expect(resolveRoot("C:/docs2/a.md", roots)).toBeNull();
  });

  it("пустой список корней — null", () => {
    expect(resolveRoot("C:/a.md", [])).toBeNull();
  });
});

describe("pathsLosingRoot", () => {
  const roots = [root("C:/docs"), root("C:/docs/guides", "pink"), root("D:/work", "red")];

  it("теряют корень только файлы удаляемого корня вне вложенных корней", () => {
    const paths = [
      "C:/docs/readme.md",
      "C:/docs/guides/intro.md",
      "D:/work/notes.md",
      "E:/outside.md",
    ];
    expect(pathsLosingRoot(paths, roots, "C:/docs")).toEqual(["C:/docs/readme.md"]);
  });

  it("удаление вложенного корня: файлы остаются во внешнем корне (вкладки не трогаем)", () => {
    const paths = ["C:/docs/guides/intro.md", "C:/docs/readme.md"];
    expect(pathsLosingRoot(paths, roots, "C:/docs/guides")).toEqual([]);
  });

  it("удаление корня без вложенного: его файлы теряют корень", () => {
    const paths = ["D:/work/notes.md"];
    expect(pathsLosingRoot(paths, roots, "D:/work")).toEqual(["D:/work/notes.md"]);
  });
});
