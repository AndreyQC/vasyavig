// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {FileNode} from "../types";
import {useFileStore} from "./fileStore";
import {useEditorStore} from "./editorStore";
import {useUiStore} from "./uiStore";

vi.mock("../lib/i18n", () => ({
  // i18n тянет @gravity-ui/uikit (configure) — в vitest не нужен, ошибки проверяем на ключах
  default: {
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  },
}));

vi.mock("../hooks/useTauriFS", () => ({
  convertToMarkdown: vi.fn(),
  createFile: vi.fn(),
  deletePath: vi.fn(),
  grantAssetScope: vi.fn(async () => {}),
  listDirectory: vi.fn(async (path: string): Promise<FileNode[]> => [
    {name: "a.md", path: `${path}/a.md`, isDir: false, children: null},
  ]),
  openFileDialog: vi.fn(),
  openFolderDialog: vi.fn(),
  readFile: vi.fn(),
  readFileLatin1: vi.fn(),
  renamePath: vi.fn(),
  saveWorkspaceFileDialog: vi.fn(),
  unwatchFolder: vi.fn(async () => {}),
  watchFolder: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

const {listDirectory, readFile, readFileLatin1, saveWorkspaceFileDialog, unwatchFolder, watchFolder, writeFile} =
  await import("../hooks/useTauriFS");

const initialFile = useFileStore.getState();
const initialEditor = useEditorStore.getState();
const initialUi = useUiStore.getState();

beforeEach(() => {
  useFileStore.setState(initialFile, true);
  useEditorStore.setState(initialEditor, true);
  useUiStore.setState(initialUi, true);
  vi.clearAllMocks();
  (listDirectory as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => [
    {name: "a.md", path: `${path}/a.md`, isDir: false, children: null},
  ]);
  (saveWorkspaceFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue(WS);
});

const WS = "C:/work/ws.vasyavig-workspace";

function setWorkspace(path = WS) {
  useFileStore.setState({workspaceFilePath: path});
}

describe("fileStore.addRoot", () => {
  it("добавляет корень с авто-цветом и деревом, грантит scope и стартует watcher", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    const s = useFileStore.getState();
    expect(s.roots).toEqual([{path: "C:/docs", color: "red"}]);
    expect(s.trees["C:/docs"]).toHaveLength(1);
    expect(watchFolder).toHaveBeenCalledWith("C:/docs");
  });

  it("второй корень получает другой цвет", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    await useFileStore.getState().addRoot("D:/work");
    expect(useFileStore.getState().roots.map((r) => r.color)).toEqual(["red", "orange"]);
  });

  it("повторное добавление того же пути (другой регистр/разделители) — no-op", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/Docs");
    await useFileStore.getState().addRoot("c:\\docs");
    const s = useFileStore.getState();
    expect(s.roots).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledTimes(1); // только первая автозапись
  });

  it("дубликат пути — уведомление вместо молчаливого no-op", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    await useFileStore.getState().addRoot("C:/docs");
    const s = useFileStore.getState();
    expect(s.roots).toHaveLength(1);
    expect(s.notice).toContain("rootAlreadyAdded");
  });

  it("вложенная папка добавляется отдельным корнем с уведомлением", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    await useFileStore.getState().addRoot("C:/docs/guides");
    const s = useFileStore.getState();
    expect(s.roots.map((r) => r.path)).toEqual(["C:/docs", "C:/docs/guides"]);
    expect(s.notice).toContain("rootNested");
  });

  it("родитель существующего корня добавляется с уведомлением", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs/guides");
    await useFileStore.getState().addRoot("C:/docs");
    const s = useFileStore.getState();
    expect(s.roots).toHaveLength(2);
    expect(s.notice).toContain("rootContains");
  });

  it("независимая папка добавляется без уведомлений", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    await useFileStore.getState().addRoot("D:/work");
    expect(useFileStore.getState().notice).toBeNull();
  });

  it("не трогает открытые вкладки", async () => {
    setWorkspace();
    useEditorStore.getState().openTab({path: "E:/out/x.md", kind: "markdown", content: "x"});
    await useFileStore.getState().addRoot("C:/docs");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("автозапись: файл workspace сразу содержит новую папку и цвет", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/work/project");
    expect(writeFile).toHaveBeenCalledWith(WS, expect.any(String));
    const [, content] = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.folders).toEqual([{path: "./project", color: "red"}]);
  });
});

describe("fileStore.removeRoot", () => {
  it("удаляет только затронутый корень, дерево другого остаётся", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    await useFileStore.getState().addRoot("D:/work");
    await useFileStore.getState().removeRoot("C:/docs");
    const s = useFileStore.getState();
    expect(s.roots.map((r) => r.path)).toEqual(["D:/work"]);
    expect(s.trees["D:/work"]).toHaveLength(1);
    expect(s.trees["C:/docs"]).toBeUndefined();
    expect(unwatchFolder).toHaveBeenCalledWith("C:/docs");
    expect(writeFile).toHaveBeenCalled();
  });

  it("закрывает вкладки потерявших корень файлов, вкладки другого корня остаются", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    await useFileStore.getState().addRoot("D:/work");
    const editor = useEditorStore.getState();
    editor.openTab({path: "C:/docs/a.md", kind: "markdown", content: "a"});
    editor.openTab({path: "D:/work/a.md", kind: "markdown", content: "b"});
    await useFileStore.getState().removeRoot("C:/docs");
    const tabs = useEditorStore.getState().tabs.map((t) => t.path);
    expect(tabs).toEqual(["D:/work/a.md"]);
  });

  it("вложенный корень: вкладки его файлов переживают удаление внешнего корня", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    await useFileStore.getState().addRoot("C:/docs/guides");
    useEditorStore.getState().openTab({path: "C:/docs/guides/a.md", kind: "markdown", content: "g"});
    await useFileStore.getState().removeRoot("C:/docs");
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(["C:/docs/guides/a.md"]);
  });
});

describe("fileStore.setRootColor", () => {
  it("меняет цвет и немедленно пишет файл workspace", async () => {
    setWorkspace();
    await useFileStore.getState().addRoot("C:/docs");
    useFileStore.getState().setRootColor("C:/docs", "orange");
    const calls = (writeFile as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const [, content] = calls[calls.length - 1];
    expect(JSON.parse(content).folders[0].color).toBe("orange");
  });
});

describe("fileStore.addRootInteractive (первый корень без файла workspace)", () => {
  it("спрашивает место файла и только после выбора добавляет папку", async () => {
    (saveWorkspaceFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue(WS);
    await useFileStore.getState().addRootInteractive("C:/docs");
    const s = useFileStore.getState();
    expect(s.workspaceFilePath).toBe(WS);
    expect(s.roots).toHaveLength(1);
    expect(useUiStore.getState().lastWorkspacePath).toBe(WS);
  });

  it("отмена диалога места — корень не добавляется", async () => {
    (saveWorkspaceFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await useFileStore.getState().addRootInteractive("C:/docs");
    expect(useFileStore.getState().roots).toHaveLength(0);
    expect(useFileStore.getState().workspaceFilePath).toBeNull();
  });
});

describe("fileStore.openWorkspaceFile / restoreLastWorkspace", () => {
  it("замещает корни из файла, восстанавливает цвета, обновляет lastWorkspacePath", async () => {
    await useFileStore.getState().addRootInteractive("C:/old");
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        version: 1,
        folders: [
          {path: "./project", color: "blue"},
          {path: "D:/data", color: "pink"},
        ],
      }),
    );
    await useFileStore.getState().openWorkspaceFile(WS);
    const s = useFileStore.getState();
    expect(s.roots).toEqual([
      {path: "C:/work/project", color: "blue"},
      {path: "D:/data", color: "pink"},
    ]);
    expect(s.workspaceFilePath).toBe(WS);
    expect(useUiStore.getState().lastWorkspacePath).toBe(WS);
    // деревья обоих корней загружены
    expect(s.trees["C:/work/project"]).toHaveLength(1);
    expect(s.trees["D:/data"]).toHaveLength(1);
  });

  it("незнакомая версия — ошибка, чистый старт (состав не меняется)", async () => {
    await useFileStore.getState().addRootInteractive("C:/old");
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({version: 2, folders: []}));
    const before = useFileStore.getState().roots;
    await useFileStore.getState().openWorkspaceFile("C:/x.vasyavig-workspace");
    const s = useFileStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.roots).toBe(before);
    expect(s.workspaceFilePath).toBe(WS);
  });

  it("restoreLastWorkspace без сохранённого пути — чистый старт без ошибок", async () => {
    await useFileStore.getState().restoreLastWorkspace();
    expect(useFileStore.getState().roots).toHaveLength(0);
    expect(useFileStore.getState().error).toBeNull();
  });

  it("restoreLastWorkspace восстанавливает корни из последнего файла", async () => {
    useUiStore.getState().setLastWorkspacePath(WS);
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({version: 1, folders: [{path: "./project", color: "teal"}]}),
    );
    await useFileStore.getState().restoreLastWorkspace();
    expect(useFileStore.getState().roots).toEqual([{path: "C:/work/project", color: "teal"}]);
  });
});

describe("fileStore.newWorkspaceFile", () => {
  it("сбрасывает корни, назначает файл и пишет пустой состав", async () => {
    await useFileStore.getState().addRootInteractive("C:/old");
    const NEW = "C:/new-ws.vasyavig-workspace";
    await useFileStore.getState().newWorkspaceFile(NEW);
    const s = useFileStore.getState();
    expect(s.roots).toHaveLength(0);
    expect(s.workspaceFilePath).toBe(NEW);
    expect(useUiStore.getState().lastWorkspacePath).toBe(NEW);
    const calls = (writeFile as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const [, content] = calls[calls.length - 1];
    expect(JSON.parse(content).folders).toEqual([]);
    expect(unwatchFolder).toHaveBeenCalledWith("C:/old");
  });
});

describe("fileStore.openFile (image/email)", () => {
  it("изображение открывается без чтения файла (контент пуст)", async () => {
    await useFileStore.getState().openFile("C:/docs/logo.png");
    expect(readFile).not.toHaveBeenCalled();
    expect(readFileLatin1).not.toHaveBeenCalled();
    const tab = useEditorStore.getState().tabs.find((t) => t.path === "C:/docs/logo.png");
    expect(tab).toMatchObject({kind: "image", content: "", dirty: false});
    expect(useFileStore.getState().activeFilePath).toBe("C:/docs/logo.png");
  });

  it("одиночное клик-открытие изображения — preview-вкладка", async () => {
    await useFileStore.getState().openFile("C:/docs/logo.png", {preview: true});
    const tab = useEditorStore.getState().tabs.find((t) => t.path === "C:/docs/logo.png");
    expect(tab?.preview).toBe(true);
  });

  it("письмо читается через latin-1 транспорт (не read_file)", async () => {
    (readFileLatin1 as ReturnType<typeof vi.fn>).mockResolvedValue("Subject: test\r\n\r\nbody");
    await useFileStore.getState().openFile("C:/mail/letter.eml");
    expect(readFileLatin1).toHaveBeenCalledWith("C:/mail/letter.eml");
    expect(readFile).not.toHaveBeenCalled();
    const tab = useEditorStore.getState().tabs.find((t) => t.path === "C:/mail/letter.eml");
    expect(tab).toMatchObject({kind: "email", content: "Subject: test\r\n\r\nbody"});
  });

  it("ошибка чтения письма — ошибка в store, вкладка не открывается", async () => {
    (readFileLatin1 as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("cannot read"));
    await useFileStore.getState().openFile("C:/mail/broken.eml");
    expect(useFileStore.getState().error).toContain("cannot read");
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });
});
