// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {useHarnessTasksStore} from "./harnessTasksStore";
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
const MANIFEST_PATH = `${REPO}/harness_manifest.json`;
const T1 = `${REPO}/docs/11_tracker/T-1.md`;
const T2 = `${REPO}/docs/11_tracker/T-2.md`;
const PLAN = `${REPO}/_docs_/_plans_/plan_a.md`;

const MANIFEST = `{
  "vocabularies": {"task": {"types": ["tracker"], "statuses": [
    {"value": "done", "label": {"ru": "Выполнена", "en": "Done"}, "color": "green", "aliases": ["Выполнена"]}
  ]}}
}`;

const envelope = (status: string) =>
  `<!-- [<[task-yaml]]\nkind: external-tracker-task\nstatus: ${status}\ntask: ""\ntracker: T-1\npriority: ""\nassignee: Иванов\n[[task-yaml]>] -->\n# T-1`;

const JSONL = [
  JSON.stringify({ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5W", path: "docs/11_tracker/T-1.md", title: "Т-1", type: "tracker", updated: "2026-10-20"}),
  JSON.stringify({ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5X", path: "docs/11_tracker/T-2.md", title: "Т-2", type: "tracker", updated: "2026-10-21"}),
  JSON.stringify({ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5Y", path: "_docs_/_plans_/plan_a.md", title: "План", type: "plan"}),
].join("\n");

const mockedReadFile = vi.mocked(readFile);

/** Карта «путь -> содержимое»; отсутствие пути = ENOENT (проба вернёт null). */
function mockFiles(files: Record<string, string>) {
  mockedReadFile.mockImplementation(async (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  });
}

function seedRegistry() {
  useHarnessStore.setState({
    indexes: {
      [ROOT_KEY]: {
        repoRoot: REPO,
        byUlid: {
          "01M43R3ZGSNXQ0KSMZ9JSZEZ5W": {ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5W", path: "docs/11_tracker/T-1.md", title: "Т-1", type: "tracker", updated: "2026-10-20", related: [], basedOn: []},
          "01M43R3ZGSNXQ0KSMZ9JSZEZ5X": {ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5X", path: "docs/11_tracker/T-2.md", title: "Т-2", type: "tracker", updated: "2026-10-21", related: [], basedOn: []},
          "01M43R3ZGSNXQ0KSMZ9JSZEZ5Y": {ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5Y", path: "_docs_/_plans_/plan_a.md", title: "План", type: "plan", related: [], basedOn: []},
        },
      },
    },
    version: 1,
  });
}

describe("harnessTasksStore", () => {
  beforeEach(() => {
    useHarnessTasksStore.getState().reset();
    // кэш «каталог -> корень репо» в harnessStore модульный: сбрасываем,
    // иначе отрицательный ответ из прошлого теста блокирует загрузку реестра
    resetHarnessCaches();
    seedRegistry();
  });

  it("ensureTasks: кандидаты реестра + подробности из файлов; без task-yaml и не-задачи исключаются", async () => {
    mockFiles({
      [MANIFEST_PATH]: MANIFEST,
      [T1]: envelope("Выполнена"),
      [T2]: "просто документ без конверта",
      [PLAN]: envelope("open"),
    });
    await useHarnessTasksStore.getState().ensureTasks(REPO);
    const state = useHarnessTasksStore.getState();
    const root = state.roots[ROOT_KEY];
    expect(root).toBeDefined();
    // тип plan отфильтрован словарём (types: [tracker]), T-2 — без конверта
    expect(root.rows).toHaveLength(1);
    expect(root.rows[0].ref.path).toBe("docs/11_tracker/T-1.md");
    // статус из файла приведён к канону словаря манифеста
    expect(root.rows[0].statusCanonical).toBe("done");
    expect(root.vocab.statuses).toHaveLength(1);
  });

  it("ensureTasks: манифеста нет — встроенный дефолт", async () => {
    mockFiles({
      [INDEX_PATH]: JSONL,
      [T1]: envelope("done"),
    });
    // манифеста нет — словарь дефолтный (types: tracker+backlog), но задачи
    // из реестра видны: дашборд сам тянет реестр
    useHarnessStore.setState({indexes: {}, version: 0});
    await useHarnessTasksStore.getState().ensureTasks(REPO);
    const root = useHarnessTasksStore.getState().roots[ROOT_KEY];
    expect(root?.vocab).toBeDefined();
    expect(root?.vocab.statuses.length).toBeGreaterThan(1);
    expect(root?.rows.map((r) => r.ref.path)).toEqual(["docs/11_tracker/T-1.md"]);
  });

  it("ensureTasks: дашборд сам подтягивает реестр (без открытого markdown-файла)", async () => {
    // реестра в harnessStore нет — раньше кандидаты были бы пустыми
    useHarnessStore.setState({indexes: {}, version: 0});
    mockFiles({
      [INDEX_PATH]: JSONL,
      [MANIFEST_PATH]: MANIFEST,
      [T1]: envelope("done"),
      [T2]: envelope("open"),
    });
    await useHarnessTasksStore.getState().ensureTasks(REPO);
    const rows = useHarnessTasksStore.getState().roots[ROOT_KEY]?.rows;
    expect(rows?.map((r) => r.ref.path)).toEqual([
      "docs/11_tracker/T-1.md",
      "docs/11_tracker/T-2.md",
    ]);
  });

  it("invalidatePath: правка .md патчит строку точечно", async () => {
    mockFiles({[T1]: envelope("done")});
    await useHarnessTasksStore.getState().ensureTasks(REPO);
    mockFiles({[T1]: envelope("open")});
    useHarnessTasksStore.getState().invalidatePath(T1);
    await vi.waitFor(() => {
      expect(useHarnessTasksStore.getState().roots[ROOT_KEY]?.rows[0]?.statusCanonical).toBe("open");
    });
  });

  it("invalidatePath: файл без конверта выпадает из списка", async () => {
    mockFiles({[T1]: envelope("done")});
    await useHarnessTasksStore.getState().ensureTasks(REPO);
    mockFiles({[T1]: "конверт удалили"});
    useHarnessTasksStore.getState().invalidatePath(T1);
    await vi.waitFor(() => {
      expect(useHarnessTasksStore.getState().roots[ROOT_KEY]?.rows).toHaveLength(0);
    });
  });

  it("invalidatePath: реестр изменился — корень сбрасывается и перезагружается", async () => {
    mockFiles({[T1]: envelope("done"), [T2]: envelope("open")});
    await useHarnessTasksStore.getState().ensureTasks(REPO);
    // T-1 исчез из реестра — после инвалидации должна остаться только T-2
    useHarnessStore.setState((s) => {
      const index = s.indexes[ROOT_KEY];
      const byUlid = {...index.byUlid};
      delete byUlid["01M43R3ZGSNXQ0KSMZ9JSZEZ5W"];
      return {indexes: {...s.indexes, [ROOT_KEY]: {...index, byUlid}}};
    });
    useHarnessTasksStore.getState().invalidatePath(INDEX_PATH);
    await vi.waitFor(() => {
      const rows = useHarnessTasksStore.getState().roots[ROOT_KEY]?.rows;
      expect(rows?.map((r) => r.ref.path)).toEqual(["docs/11_tracker/T-2.md"]);
    });
  });

  it("refreshRoot: полная перезагрузка корня по кнопке", async () => {
    mockFiles({[T1]: envelope("done")});
    await useHarnessTasksStore.getState().ensureTasks(REPO);
    mockFiles({[T1]: envelope("cancelled")});
    await useHarnessTasksStore.getState().refreshRoot(REPO);
    expect(useHarnessTasksStore.getState().roots[ROOT_KEY]?.rows[0]?.statusCanonical).toBe("cancelled");
  });
});
