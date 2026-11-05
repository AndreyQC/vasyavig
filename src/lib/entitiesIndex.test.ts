import {beforeEach, describe, expect, it, vi, type Mock} from "vitest";

vi.mock("../hooks/useTauriFS", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
}));

const {readFile, writeFile} = await import("../hooks/useTauriFS");

import {
  addEntityToIndex,
  ensureEntitiesIndex,
  invalidateEntitiesIndex,
  parseEntitiesJsonl,
  resetEntitiesIndexCache,
  subscribeEntitiesIndex,
} from "./entitiesIndex";

const DIR = "C:/work/notes";
const INDEX_PATH = `${DIR}/entities.jsonl`;
const P1 = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const P2 = "01BBBBBBBBBBBBBBBBBBBBBBBB";

// in-memory FS: путь-независимое сравнение (Windows-регистр/разделители)
const files = new Map<string, string>();
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

function wireFs() {
  (readFile as Mock).mockImplementation(async (path: string) => {
    const hit = files.get(norm(path));
    if (hit == null) throw new Error("not found");
    return hit;
  });
  (writeFile as Mock).mockImplementation(async (path: string, text: string) => {
    files.set(norm(path), text);
  });
}

beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
  wireFs();
  resetEntitiesIndexCache();
});

describe("T6-4: addEntityToIndex", () => {
  it("создаёт запись с свежим ULID и пишет файл без harness-якоря", async () => {
    const entry = await addEntityToIndex(DIR, {type: "PERSON", canonical: "Петров П. П."});
    expect(entry.ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(entry.type).toBe("person");
    expect(entry.canonical).toBe("Петров П. П.");
    const written = parseEntitiesJsonl(files.get(norm(INDEX_PATH)) ?? "");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ulid: entry.ulid, type: "person", canonical: "Петров П. П."});
    expect(written[0].forms).toContain("Петров П. П.");
  });

  it("копит записи: два вызова — две записи (документ не трогается)", async () => {
    await addEntityToIndex(DIR, {type: "person", canonical: "Петров П. П."});
    await addEntityToIndex(DIR, {type: "org", canonical: "Ромашка"});
    const written = parseEntitiesJsonl(files.get(norm(INDEX_PATH)) ?? "");
    expect(written.map((e) => e.canonical).sort()).toEqual(["Петров П. П.", "Ромашка"].sort());
    expect(new Set(written.map((e) => e.ulid)).size).toBe(2);
  });

  it("harness-репо: запись идёт в harness_docs/harness_index/entities.jsonl", async () => {
    files.set(norm(`${DIR}/harness.yaml`), "project:\n  id: lm_hrdo_2\n");
    await addEntityToIndex(DIR, {type: "person", canonical: "Петров П. П."});
    const expected = `${DIR}/harness_docs/harness_index/entities.jsonl`;
    expect(files.has(norm(expected))).toBe(true);
    expect(files.has(norm(INDEX_PATH))).toBe(false);
  });
});

describe("T6-3: подписка на изменения файла индекса", () => {
  it("writeEntitiesIndex (через addEntityToIndex) уведомляет подписчиков по пути файла", async () => {
    const events: string[] = [];
    const unsub = subscribeEntitiesIndex((path) => events.push(norm(path)));
    await addEntityToIndex(DIR, {type: "person", canonical: "Петров П. П."});
    expect(events).toEqual([norm(INDEX_PATH)]);
    unsub();
    await addEntityToIndex(DIR, {type: "person", canonical: "Сидоров С. С."});
    expect(events).toHaveLength(1); // после отписки — тишина
  });

  it("invalidateEntitiesIndex уведомляет и сбрасывает кэш (watcher)", async () => {
    files.set(
      norm(INDEX_PATH),
      `${JSON.stringify({ulid: P1, type: "person", canonical: "Иванов", forms: ["Иванов"]})}\n`,
    );
    await ensureEntitiesIndex(DIR);
    const events: string[] = [];
    const unsub = subscribeEntitiesIndex((path) => events.push(norm(path)));
    invalidateEntitiesIndex(INDEX_PATH);
    expect(events).toEqual([norm(INDEX_PATH)]);
    // кэш сброшен: перечитывает диск и видит обновлённое содержимое
    files.set(
      norm(INDEX_PATH),
      `${JSON.stringify({ulid: P2, type: "org", canonical: "Ромашка", forms: ["Ромашка"]})}\n`,
    );
    const file = await ensureEntitiesIndex(DIR);
    expect(file.entries.map((e) => e.ulid)).toEqual([P2]);
    unsub();
  });

  it("invalidate по чужому пути не уведомляет", async () => {
    files.set(norm(INDEX_PATH), "");
    await ensureEntitiesIndex(DIR);
    const events: string[] = [];
    const unsub = subscribeEntitiesIndex((path) => events.push(norm(path)));
    invalidateEntitiesIndex("C:/elsewhere/entities.jsonl");
    expect(events).toHaveLength(0);
    unsub();
  });
});
