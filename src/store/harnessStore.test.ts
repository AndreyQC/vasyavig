// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {resetHarnessCaches, useHarnessStore, openUlidTarget} from "./harnessStore";
import {useFileStore} from "./fileStore";
import {HARNESS_INDEX_REL} from "../lib/harnessIndex";

vi.mock("../lib/i18n", () => ({
  default: {t: (key: string) => key},
}));

vi.mock("../hooks/useTauriFS", () => ({
  convertToMarkdown: vi.fn(),
  createFile: vi.fn(),
  deletePath: vi.fn(),
  grantAssetScope: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
  openFileDialog: vi.fn(),
  openFolderDialog: vi.fn(),
  readFile: vi.fn(),
  readFileLatin1: vi.fn(),
  renamePath: vi.fn(),
  saveWorkspaceFileDialog: vi.fn(),
  saveWorkspaceDialog: vi.fn(),
  unwatchFolder: vi.fn(async () => {}),
  watchFolder: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

const {readFile} = await import("../hooks/useTauriFS");

const ULID_A = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const REPO = "C:/repos/lm_hrdo_2";
const INDEX_PATH = `${REPO}/${HARNESS_INDEX_REL}`;
const JSONL = `${JSON.stringify({ulid: ULID_A, path: "_docs_/_tasks_/a_plan.md", title: "План А", type: "plan"})}\n`;

const initialHarness = useHarnessStore.getState();
const initialFile = useFileStore.getState();

/** readFile отдаёт содержимое только для пути индекса репозитория REPO. */
function mockIndexReader() {
  (readFile as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
    if (path.replace(/\\/g, "/").toLowerCase() === INDEX_PATH.toLowerCase()) return JSONL;
    throw new Error("not found");
  });
}

beforeEach(() => {
  useHarnessStore.setState(initialHarness, true);
  useFileStore.setState(initialFile, true);
  resetHarnessCaches();
  vi.clearAllMocks();
  mockIndexReader();
});

describe("harnessStore.ensureIndex / resolveFor", () => {
  it("загружает реестр по каталогу внутри репо и резолвит полный ULID и префикс", async () => {
    await useHarnessStore.getState().ensureIndex(`${REPO}/_docs_/_tasks_`);
    const store = useHarnessStore.getState();
    expect(store.version).toBe(1);

    const found = store.resolveFor(`${REPO}/_docs_/_tasks_`, ULID_A);
    expect(found).toMatchObject({status: "found", repoRoot: REPO, entry: {title: "План А"}});

    expect(store.resolveFor(`${REPO}/_docs_/_tasks_`, "01M43R3ZG").status).toBe("found");
    expect(store.resolveFor(`${REPO}/_docs_/_tasks_`, "01M5RK385592V1WEET1786GDFN").status).toBe("unknown");
  });

  it("повторное ensureIndex того же репо не перезагружает индекс (version не растёт)", async () => {
    await useHarnessStore.getState().ensureIndex(`${REPO}/docs`);
    const version = useHarnessStore.getState().version;
    expect(version).toBe(1);
    await useHarnessStore.getState().ensureIndex(`${REPO}/_docs_/_tasks_`);
    expect(useHarnessStore.getState().version).toBe(version);
  });

  it("каталог вне harness-репо: индекса нет, resolveFor -> unknown", async () => {
    await useHarnessStore.getState().ensureIndex("C:/plain/project/docs");
    const store = useHarnessStore.getState();
    expect(store.version).toBe(0);
    expect(store.resolveFor("C:/plain/project/docs", ULID_A).status).toBe("unknown");
  });
});

describe("harnessStore.invalidatePath", () => {
  it("событие по пути индекса сбрасывает кэш: следующий ensureIndex перечитывает", async () => {
    await useHarnessStore.getState().ensureIndex(`${REPO}/docs`);
    const callsAfterFirst = (readFile as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    useHarnessStore.getState().invalidatePath(`${REPO}\\${HARNESS_INDEX_REL}`); // windows-форма пути
    expect(useHarnessStore.getState().version).toBe(2); // загрузка + сброс — каждая меняет версию

    await useHarnessStore.getState().ensureIndex(`${REPO}/docs`);
    expect((readFile as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(useHarnessStore.getState().resolveFor(`${REPO}/docs`, ULID_A).status).toBe("found");
  });

  it("чужие пути не инвалидируют", async () => {
    await useHarnessStore.getState().ensureIndex(`${REPO}/docs`);
    useHarnessStore.getState().invalidatePath(`${REPO}/docs/other.md`);
    expect(useHarnessStore.getState().version).toBe(1);
  });
});

describe("openUlidTarget", () => {
  it("found -> fileStore.openFile с абсолютным путём", async () => {
    const openFile = vi.fn();
    useFileStore.setState({openFile});
    await useHarnessStore.getState().ensureIndex(`${REPO}/docs`);
    await openUlidTarget(`${REPO}/docs`, ULID_A);
    expect(openFile).toHaveBeenCalledWith(`${REPO}/_docs_/_tasks_/a_plan.md`);
  });

  it("unknown -> уведомление, openFile не вызывается", async () => {
    const openFile = vi.fn();
    const setNotice = vi.fn();
    useFileStore.setState({openFile, setNotice});
    await useHarnessStore.getState().ensureIndex(`${REPO}/docs`);
    await openUlidTarget(`${REPO}/docs`, "01M5RK385592V1WEET1786GDFN");
    expect(openFile).not.toHaveBeenCalled();
    expect(setNotice).toHaveBeenCalledWith("harness.ulidUnknown");
  });
});
