import {describe, expect, it} from "vitest";
import {
  getExtension,
  getFileKind,
  getFileName,
  getParentDir,
  isMdYfmSwap,
  joinPath,
  normalizeMdExt,
  remapPath,
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

  it("офисные расширения -> office", () => {
    for (const p of ["a.docx", "a.xlsx", "a.pdf", "a.ppt", "a.csv", "a.rtf", "a.epub"]) {
      expect(getFileKind(p)).toBe("office");
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

describe("getParentDir", () => {
  it("возвращает каталог для windows и posix путей", () => {
    expect(getParentDir("C:\\docs\\a.md")).toBe("C:\\docs");
    expect(getParentDir("/home/user/b.md")).toBe("/home/user");
  });

  it("без разделителя возвращает путь как есть", () => {
    expect(getParentDir("a.md")).toBe("a.md");
  });
});

describe("joinPath", () => {
  it("склеивает каталог и имя с нужным разделителем", () => {
    expect(joinPath("C:\\docs", "a.md")).toBe("C:\\docs\\a.md");
    expect(joinPath("/home/user", "b.md")).toBe("/home/user/b.md");
  });

  it("не дублирует разделитель", () => {
    expect(joinPath("C:\\docs\\", "a.md")).toBe("C:\\docs\\a.md");
    expect(joinPath("/home/user/", "b.md")).toBe("/home/user/b.md");
  });
});

describe("remapPath", () => {
  it("переименование файла — только сам файл", () => {
    expect(remapPath("C:\\docs\\a.md", "C:\\docs\\a.md", "C:\\docs\\b.md")).toBe("C:\\docs\\b.md");
    expect(remapPath("C:\\docs\\other.md", "C:\\docs\\a.md", "C:\\docs\\b.md")).toBeNull();
  });

  it("переименование папки — пути внутри неё", () => {
    expect(remapPath("C:\\docs\\sub\\a.md", "C:\\docs\\sub", "C:\\docs\\renamed")).toBe("C:\\docs\\renamed\\a.md");
    expect(remapPath("C:\\docs\\x.md", "C:\\docs\\sub", "C:\\docs\\renamed")).toBeNull();
  });
});
