import {describe, expect, it} from "vitest";
import {
  getExtension,
  getFileKind,
  getFileName,
  isMdYfmSwap,
  normalizeMdExt,
  replaceExtension,
} from "./utils";

describe("getExtension", () => {
  it("извлекает расширение в нижнем регистре", () => {
    expect(getExtension("C:/docs/Note.MD")).toBe("md");
    expect(getExtension("/home/user/file.YFM")).toBe("yfm");
  });

  it("возвращает пустую строку для файлов без расширения и dotfiles", () => {
    expect(getExtension("C:/docs/README")).toBe("");
    expect(getExtension(".gitignore")).toBe("");
  });
});

describe("getFileName", () => {
  it("извлекает имя файла из windows и posix путей", () => {
    expect(getFileName("C:\\docs\\a.md")).toBe("a.md");
    expect(getFileName("/home/user/b.md")).toBe("b.md");
  });
});

describe("getFileKind", () => {
  it("markdown-расширения -> markdown", () => {
    for (const p of ["a.md", "a.markdown", "a.yfm", "a.mdx"]) {
      expect(getFileKind(p)).toBe("markdown");
    }
  });

  it("текстовые расширения -> text", () => {
    for (const p of ["a.txt", "a.json", "a.py", "a.yaml", "a.rs"]) {
      expect(getFileKind(p)).toBe("text");
    }
  });

  it("прочие -> unsupported", () => {
    expect(getFileKind("a.exe")).toBe("unsupported");
    expect(getFileKind("a.png")).toBe("unsupported");
    expect(getFileKind("README")).toBe("unsupported");
  });
});

describe("normalizeMdExt", () => {
  it("markdown/mdx приводятся к md", () => {
    expect(normalizeMdExt("markdown")).toBe("md");
    expect(normalizeMdExt("mdx")).toBe("md");
    expect(normalizeMdExt("md")).toBe("md");
    expect(normalizeMdExt("yfm")).toBe("yfm");
  });
});

describe("isMdYfmSwap", () => {
  it("ловит смену md <-> yfm", () => {
    expect(isMdYfmSwap("md", "yfm")).toBe(true);
    expect(isMdYfmSwap("yfm", "markdown")).toBe(true);
  });

  it("не срабатывает при сохранении формата и на не-markdown парах", () => {
    expect(isMdYfmSwap("md", "markdown")).toBe(false);
    expect(isMdYfmSwap("md", "txt")).toBe(false);
    expect(isMdYfmSwap("txt", "json")).toBe(false);
  });
});

describe("replaceExtension", () => {
  it("меняет расширение в пути", () => {
    expect(replaceExtension("C:/docs/a.yfm", "md")).toBe("C:/docs/a.md");
  });

  it("добавляет расширение, если его не было", () => {
    expect(replaceExtension("C:/docs/a", "md")).toBe("C:/docs/a.md");
  });
});
