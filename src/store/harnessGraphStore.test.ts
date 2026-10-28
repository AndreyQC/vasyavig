// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {useHarnessGraphStore} from "./harnessGraphStore";
import {resetHarnessCaches, useHarnessStore} from "./harnessStore";
import {HARNESS_INDEX_REL} from "../lib/harnessIndex";

vi.mock("../lib/i18n", () => ({
  default: {t: (key: string) => key},
}));

vi.mock("../hooks/useTauriFS", () => ({
  readFile: vi.fn(),
}));

const {readFile} = await import("../hooks/useTauriFS");

const REPO = "C:/repos/lm_hrdo_2";
const ROOT_KEY = "c:/repos/lm_hrdo_2";
const INDEX_PATH = `${REPO}/${HARNESS_INDEX_REL}`;
const PLAN = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const RES = "01M43R3ZGSNXQ0KSMZ9JSZEZ5X";

const JSONL = [
  JSON.stringify({
    ulid: PLAN,
    path: "_docs_/_plans_/a.md",
    title: "План A",
    type: "plan",
    project: "lm_hrdo_2",
    related: [RES],
  }),
  JSON.stringify({
    ulid: RES,
    path: "_docs_/_tasks_/a_result.md",
    title: "Результат A",
    type: "result",
    project: "lm_hrdo_2",
    based_on: [PLAN],
  }),
].join("\n");

const mockedReadFile = vi.mocked(readFile);

function mockFiles(files: Record<string, string>) {
  mockedReadFile.mockImplementation(async (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  });
}

describe("harnessGraphStore", () => {
  beforeEach(() => {
    useHarnessGraphStore.getState().reset();
    useHarnessStore.setState({indexes: {}, version: 0});
    resetHarnessCaches();
    mockFiles({[INDEX_PATH]: JSONL});
  });

  it("ensureGraph: панель сама тянет реестр и строит граф", async () => {
    await useHarnessGraphStore.getState().ensureGraph(REPO);
    const graph = useHarnessGraphStore.getState().getGraph(REPO);
    expect(graph).toBeDefined();
    expect(Object.keys(graph!.nodes)).toHaveLength(2);
    // обратный `based_on` и симметричный `related`
    expect(graph!.childrenByParent[PLAN]).toEqual([RES]);
    expect(graph!.relatedByNode[RES]).toEqual([{ulid: PLAN, direction: "in"}]);
  });

  it("syncGraph: реестр не менялся — пересчёта нет", async () => {
    await useHarnessGraphStore.getState().ensureGraph(REPO);
    const before = useHarnessGraphStore.getState().version;
    useHarnessGraphStore.getState().syncGraph(REPO);
    expect(useHarnessGraphStore.getState().version).toBe(before);
  });

  it("syncGraph: реестр обновился — граф пересчитан", async () => {
    await useHarnessGraphStore.getState().ensureGraph(REPO);
    const before = useHarnessGraphStore.getState().version;
    const index = useHarnessStore.getState().indexes[ROOT_KEY];
    useHarnessStore.setState({
      indexes: {
        [ROOT_KEY]: {
          ...index,
          entries: [...index.entries, {...index.entries[0], ulid: "NEW", path: "new.md"}],
        },
      },
      version: 2,
    });
    useHarnessGraphStore.getState().syncGraph(REPO);
    expect(useHarnessGraphStore.getState().version).toBe(before + 1);
    expect(Object.keys(useHarnessGraphStore.getState().getGraph(REPO)!.nodes)).toHaveLength(3);
  });

  it("findByPath: документ находится по абсолютному пути файла", async () => {
    await useHarnessGraphStore.getState().ensureGraph(REPO);
    const node = useHarnessGraphStore
      .getState()
      .findByPath(REPO, `${REPO}\\_docs_\\_tasks_\\a_result.md`);
    expect(node?.ulid).toBe(RES);
    expect(node?.title).toBe("Результат A");
  });

  it("findByPath: файл вне репозитория — null", async () => {
    await useHarnessGraphStore.getState().ensureGraph(REPO);
    expect(useHarnessGraphStore.getState().findByPath(REPO, "C:/other/file.md")).toBeUndefined();
  });

  it("getGraph: реестр не загружен — undefined", () => {
    expect(useHarnessGraphStore.getState().getGraph(REPO)).toBeUndefined();
  });
});
