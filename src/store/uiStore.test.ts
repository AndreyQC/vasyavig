import {beforeEach, describe, expect, it} from "vitest";
import {useUiStore} from "./uiStore";

const initialUi = useUiStore.getState();

beforeEach(() => {
  useUiStore.setState(initialUi, true);
});

describe("uiStore.recentWorkspaces (план 20261028_004, D8)", () => {
  it("setLastWorkspacePath добавляет путь в недавние", () => {
    useUiStore.getState().setLastWorkspacePath("C:/a.vasyavig-workspace");
    expect(useUiStore.getState().recentWorkspaces).toEqual(["C:/a.vasyavig-workspace"]);
  });

  it("повторное открытие поднимает путь наверх без дубликата", () => {
    const s = useUiStore.getState();
    s.setLastWorkspacePath("C:/a.vasyavig-workspace");
    s.setLastWorkspacePath("C:/b.vasyavig-workspace");
    s.setLastWorkspacePath("C:/a.vasyavig-workspace");
    expect(useUiStore.getState().recentWorkspaces).toEqual([
      "C:/a.vasyavig-workspace",
      "C:/b.vasyavig-workspace",
    ]);
  });

  it("список ограничен пятью", () => {
    const s = useUiStore.getState();
    for (let i = 0; i < 7; i++) {
      s.setLastWorkspacePath(`C:/ws${i}.vasyavig-workspace`);
    }
    const recents = useUiStore.getState().recentWorkspaces;
    expect(recents).toHaveLength(5);
    expect(recents[0]).toBe("C:/ws6.vasyavig-workspace");
  });

  it("null не трогает список недавних", () => {
    const s = useUiStore.getState();
    s.setLastWorkspacePath("C:/a.vasyavig-workspace");
    s.setLastWorkspacePath(null);
    expect(useUiStore.getState().recentWorkspaces).toEqual(["C:/a.vasyavig-workspace"]);
    expect(useUiStore.getState().lastWorkspacePath).toBeNull();
  });
});

describe("uiStore.pendingCreateKind (план 20261028_004, D3)", () => {
  it("setPendingCreateDir по умолчанию — файл", () => {
    useUiStore.getState().setPendingCreateDir("C:/docs");
    expect(useUiStore.getState().pendingCreateKind).toBe("file");
  });

  it("режим папки передаётся явно", () => {
    useUiStore.getState().setPendingCreateDir("C:/docs", "dir");
    expect(useUiStore.getState().pendingCreateKind).toBe("dir");
    useUiStore.getState().setPendingCreateDir(null);
    expect(useUiStore.getState().pendingCreateDir).toBeNull();
    // kind остаётся до следующего запроса — читается до сброса в confirmCreate
    expect(useUiStore.getState().pendingCreateKind).toBe("dir");
  });
});

describe("uiStore.quickOpenOpen / cursorPos (план 20261028_004, D5/D7)", () => {
  it("открытие/закрытие палитры", () => {
    useUiStore.getState().setQuickOpenOpen(true);
    expect(useUiStore.getState().quickOpenOpen).toBe(true);
    useUiStore.getState().setQuickOpenOpen(false);
    expect(useUiStore.getState().quickOpenOpen).toBe(false);
  });

  it("позиция курсора ставится и сбрасывается", () => {
    useUiStore.getState().setCursorPos({line: 3, col: 7});
    expect(useUiStore.getState().cursorPos).toEqual({line: 3, col: 7});
    useUiStore.getState().setCursorPos(null);
    expect(useUiStore.getState().cursorPos).toBeNull();
  });
});
