import {describe, expect, it} from "vitest";
import {
  ALIAS_MAX_LENGTH,
  parseWorkspace,
  resolveFolderPath,
  serializeWorkspace,
  toWorkspaceRelative,
  WorkspaceFormatError,
} from "./workspaceFile";
import type {RootInfo} from "./rootColors";

const root = (path: string, color: RootInfo["color"]): RootInfo => ({path, color});

describe("parseWorkspace", () => {
  it("читает version 1 с папками и цветами", () => {
    const folders = parseWorkspace(
      JSON.stringify({version: 1, folders: [{path: "./project", color: "blue"}]}),
    );
    expect(folders).toEqual([{path: "./project", color: "blue"}]);
  });

  it("чужая версия формата — WorkspaceFormatError, не краш", () => {
    expect(() => parseWorkspace(JSON.stringify({version: 2, folders: []}))).toThrow(
      WorkspaceFormatError,
    );
  });

  it("не-JSON и кривые структуры — WorkspaceFormatError", () => {
    expect(() => parseWorkspace("not json")).toThrow(WorkspaceFormatError);
    expect(() => parseWorkspace(JSON.stringify({version: 1}))).toThrow(WorkspaceFormatError);
    expect(() => parseWorkspace(JSON.stringify({version: 1, folders: [{path: ""}]}))).toThrow(
      WorkspaceFormatError,
    );
    expect(() =>
      parseWorkspace(JSON.stringify({version: 1, folders: [{path: "./x", color: "grey"}]})),
    ).toThrow(WorkspaceFormatError);
  });
});

describe("toWorkspaceRelative", () => {
  it("папка доступна относительно — ./project", () => {
    expect(toWorkspaceRelative("C:/work/project", "C:/work/docs.vasyavig-workspace")).toBe(
      "./project",
    );
  });

  it("смешанные разделители и регистр не мешают", () => {
    expect(toWorkspaceRelative("C:\\Work\\Project", "C:/work/docs.vasyavig-workspace")).toBe(
      "./project",
    );
  });

  it("уровень выше — ../x", () => {
    expect(toWorkspaceRelative("C:/project", "C:/work/docs.vasyavig-workspace")).toBe(
      "../project",
    );
  });

  it("другой диск Windows — абсолютный путь", () => {
    expect(toWorkspaceRelative("D:/data", "C:/work/docs.vasyavig-workspace")).toBe("D:/data");
  });

  it("POSIX: относительный путь возможен", () => {
    expect(toWorkspaceRelative("/home/u/project", "/home/u/ws/docs.vasyavig-workspace")).toBe(
      "../project",
    );
    expect(toWorkspaceRelative("/home/u/ws/project", "/home/u/ws/docs.vasyavig-workspace")).toBe(
      "./project",
    );
  });

  it("UNC против диска — абсолютный путь", () => {
    expect(toWorkspaceRelative("//server/share/p", "C:/work/docs.vasyavig-workspace")).toBe(
      "//server/share/p",
    );
  });
});

describe("serializeWorkspace + resolveFolderPath roundtrip", () => {
  it("roundtrip относительный путь", () => {
    const text = serializeWorkspace([root("C:/work/project", "blue")], "C:/work/ws.vasyavig-workspace");
    const parsed = parseWorkspace(text);
    expect(parsed[0].path).toBe("./project");
    expect(resolveFolderPath(parsed[0].path, "C:/work/ws.vasyavig-workspace")).toBe(
      "C:/work/project",
    );
  });

  it("roundtrip абсолютный путь (другой диск)", () => {
    const text = serializeWorkspace([root("D:/data", "red")], "C:/work/ws.vasyavig-workspace");
    const parsed = parseWorkspace(text);
    expect(parsed[0].path).toBe("D:/data");
    expect(resolveFolderPath(parsed[0].path, "C:/work/ws.vasyavig-workspace")).toBe("D:/data");
  });

  it("roundtrip уровень выше", () => {
    const text = serializeWorkspace([root("C:/project", "teal")], "C:/work/a/ws.vasyavig-workspace");
    expect(parseWorkspace(text)[0].path).toBe("../../project");
    expect(resolveFolderPath("../../project", "C:/work/a/ws.vasyavig-workspace")).toBe(
      "C:/project",
    );
  });

  it("порядок корней и цвета сохраняются", () => {
    const text = serializeWorkspace(
      [root("C:/a", "red"), root("C:/b", "pink"), root("C:/c", "amber")],
      "C:/ws.vasyavig-workspace",
    );
    const parsed = parseWorkspace(text);
    expect(parsed.map((f) => f.color)).toEqual(["red", "pink", "amber"]);
  });
});

describe("alias (план 20261028_002)", () => {
  it("parse: alias читается", () => {
    const folders = parseWorkspace(
      JSON.stringify({version: 1, folders: [{path: "./p", color: "blue", alias: "Мой проект"}]}),
    );
    expect(folders).toEqual([{path: "./p", color: "blue", alias: "Мой проект"}]);
  });

  it("parse: без alias и с пробельным alias поле отсутствует (strict)", () => {
    const folders = parseWorkspace(
      JSON.stringify({
        version: 1,
        folders: [{path: "./a", color: "blue"}, {path: "./b", color: "red", alias: "   "}],
      }),
    );
    expect(folders).toStrictEqual([{path: "./a", color: "blue"}, {path: "./b", color: "red"}]);
  });

  it("parse: alias trim'ится", () => {
    const folders = parseWorkspace(
      JSON.stringify({version: 1, folders: [{path: "./p", color: "blue", alias: "  Docs  "}]}),
    );
    expect(folders[0].alias).toBe("Docs");
  });

  it("parse: нестроковый alias — WorkspaceFormatError", () => {
    expect(() =>
      parseWorkspace(JSON.stringify({version: 1, folders: [{path: "./p", color: "blue", alias: 5}]})),
    ).toThrow(WorkspaceFormatError);
  });

  it("parse: alias длиннее предела обрезается, файл читается", () => {
    const folders = parseWorkspace(
      JSON.stringify({version: 1, folders: [{path: "./p", color: "blue", alias: "ж".repeat(150)}]}),
    );
    expect(folders[0].alias).toBe("ж".repeat(ALIAS_MAX_LENGTH));
  });

  it("serialize: alias пишется только непустой; roundtrip", () => {
    const roots: RootInfo[] = [
      {path: "C:/work/alpha", color: "blue", alias: "Альфа"},
      {path: "C:/work/beta", color: "red"},
      {path: "C:/work/gamma", color: "teal", alias: "  "},
    ];
    const text = serializeWorkspace(roots, "C:/work/ws.vasyavig-workspace");
    const data = JSON.parse(text);
    expect(data.folders[0].alias).toBe("Альфа");
    expect(data.folders[1]).not.toHaveProperty("alias");
    expect(data.folders[2]).not.toHaveProperty("alias");
    const parsed = parseWorkspace(text);
    expect(parsed).toStrictEqual([
      {path: "./alpha", color: "blue", alias: "Альфа"},
      {path: "./beta", color: "red"},
      {path: "./gamma", color: "teal"},
    ]);
  });
});
