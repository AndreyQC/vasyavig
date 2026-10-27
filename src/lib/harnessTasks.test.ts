import {describe, expect, it} from "vitest";
import {
  canonicalStatus,
  createIndexTaskSource,
  DEFAULT_TASK_VOCABULARY,
  loadTaskVocabulary,
  normalizeTaskValue,
  parseTaskVocabulary,
} from "./harnessTasks";
import type {HarnessIndexEntry} from "./harnessIndex";

const REPO = "C:/repos/lm_hrdo_2";

const MANIFEST = `{
  "manifest": 1,
  "kind": "harness",
  "vocabularies": {
    "task": {
      "types": ["tracker", "backlog"],
      "kinds": ["daily-task", "external-tracker-task"],
      "statuses": [
        {"value": "done", "label": {"ru": "Выполнена", "en": "Done"}, "color": "green", "aliases": ["Выполнена"]}
      ]
    }
  }
}`;

const entry = (over: Partial<HarnessIndexEntry>): HarnessIndexEntry => ({
  ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5W",
  path: "docs/11_tracker/T-1.md",
  related: [],
  basedOn: [],
  ...over,
});

/** Проба-фикстура: путь -> содержимое; отсутствующий путь — null. */
function probeOf(files: Record<string, string>) {
  return async (candidate: string) => files[candidate] ?? null;
}

describe("normalizeTaskValue", () => {
  it("срезает кавычки, инлайн-комментарий и трим; пустое — null", () => {
    expect(normalizeTaskValue('  "done" ')).toBe("done");
    expect(normalizeTaskValue("open # open | in_progress | done")).toBe("open");
    expect(normalizeTaskValue('""')).toBeNull();
    expect(normalizeTaskValue("   ")).toBeNull();
    expect(normalizeTaskValue(null)).toBeNull();
    expect(normalizeTaskValue(undefined)).toBeNull();
  });
});

describe("canonicalStatus", () => {
  const vocab = DEFAULT_TASK_VOCABULARY;

  it("канон и алиасы без регистра", () => {
    expect(canonicalStatus("done", vocab)).toBe("done");
    expect(canonicalStatus("Выполнена", vocab)).toBe("done");
    expect(canonicalStatus("В РАБОТЕ", vocab)).toBe("in_progress");
    expect(canonicalStatus("active", vocab)).toBe("in_progress");
  });

  it("пустое — null, неизвестное — как есть", () => {
    expect(canonicalStatus("", vocab)).toBeNull();
    expect(canonicalStatus(null, vocab)).toBeNull();
    expect(canonicalStatus("on hold", vocab)).toBe("on hold");
  });
});

describe("parseTaskVocabulary", () => {
  it("валидный манифест замещает дефолт по полям", () => {
    const vocab = parseTaskVocabulary(MANIFEST);
    expect(vocab?.types).toEqual(["tracker", "backlog"]);
    expect(vocab?.kinds).toEqual(["daily-task", "external-tracker-task"]);
    expect(vocab?.statuses).toHaveLength(1);
    expect(vocab?.statuses[0].color).toBe("green");
  });

  it("битые поля остаются дефолтными, не-JSON — null", () => {
    const broken = parseTaskVocabulary('{"vocabularies": {"task": {"types": "tracker", "statuses": [{"nope": 1}]}}}');
    expect(broken?.types).toEqual(DEFAULT_TASK_VOCABULARY.types);
    expect(broken?.statuses).toEqual(DEFAULT_TASK_VOCABULARY.statuses);
    expect(parseTaskVocabulary("не json")).toBeNull();
    expect(parseTaskVocabulary("{}")).toBeNull();
  });
});

describe("loadTaskVocabulary", () => {
  it("манифест на месте — словарь из него", async () => {
    const vocab = await loadTaskVocabulary(REPO, probeOf({[`${REPO}/harness_manifest.json`]: MANIFEST}));
    expect(vocab.types).toEqual(["tracker", "backlog"]);
  });

  it("манифеста нет — встроенный дефолт", async () => {
    const vocab = await loadTaskVocabulary(REPO, probeOf({}));
    expect(vocab).toEqual(DEFAULT_TASK_VOCABULARY);
  });
});

describe("createIndexTaskSource", () => {
  const entries: HarnessIndexEntry[] = [
    entry({ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5W", path: "docs/11_tracker/T-1.md", type: "tracker", title: "Трекер-задача", updated: "2026-10-20"}),
    entry({ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5X", path: "docs/02_doc.md", type: "doc", title: "Не задача"}),
    entry({ulid: "01M43R3ZGSNXQ0KSMZ9JSZEZ5Y", path: "_docs_/_plans_/b.md", type: "backlog", title: "Бэклог"}),
  ];

  const taskFile = (status: string) =>
    `<!-- [<[task-yaml]]\nkind: external-tracker-task\nstatus: ${status}\ntask: ""\ntracker: T-1\npriority: ""\nassignee: Иванов\n[[task-yaml]>] -->`;

  it("listTaskDocs: фильтр по типам словаря без регистра", () => {
    const source = createIndexTaskSource({getEntries: () => entries});
    const refs = source.listTaskDocs(REPO, DEFAULT_TASK_VOCABULARY);
    expect(refs.map((r) => r.registryType)).toEqual(["tracker", "backlog"]);
    expect(refs[0].repoRoot).toBe(REPO);
  });

  it("listTaskDocs: реестр не загружен — пустой список", () => {
    const source = createIndexTaskSource({getEntries: () => undefined});
    expect(source.listTaskDocs(REPO, DEFAULT_TASK_VOCABULARY)).toEqual([]);
  });

  it("loadTaskDetails: разбор конверта и нормализация значений", async () => {
    const source = createIndexTaskSource({
      getEntries: () => entries,
      readProbe: probeOf({[`${REPO}/docs/11_tracker/T-1.md`]: taskFile("Выполнена # зеркало трекера")}),
    });
    const details = await source.loadTaskDetails(REPO, "docs/11_tracker/T-1.md");
    expect(details).toEqual({
      kind: "external-tracker-task",
      status: "Выполнена",
      task: null,
      tracker: "T-1",
      priority: null,
      assignee: "Иванов",
    });
  });

  it("loadTaskDetails: файла нет или конверта нет — null (кандидат исключается)", async () => {
    const source = createIndexTaskSource({
      getEntries: () => entries,
      readProbe: probeOf({}),
    });
    expect(await source.loadTaskDetails(REPO, "docs/11_tracker/T-1.md")).toBeNull();
  });
});
