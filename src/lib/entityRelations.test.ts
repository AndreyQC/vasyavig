import {beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {
  computeCoOccurrences,
  ensureRelationsIndex,
  invalidateRelationsIndex,
  mergeRelations,
  parseRelationsJsonl,
  relationKey,
  relationsFor,
  resetRelationsIndexCache,
  resolveByCoOccurrence,
  resolveByRelations,
  serializeRelationsJsonl,
  writeRelationsIndex,
  type EntityRelation,
} from "./entityRelations";
import {
  matchEntityEntry,
  mergeEntitiesIndex,
  parseEntitiesJsonl,
  serializeEntitiesJsonl,
} from "./entitiesIndex";

vi.mock("../hooks/useTauriFS", () => ({
  readFile: vi.fn(async () => {
    throw new Error("not found");
  }),
  writeFile: vi.fn(async () => {}),
}));

const {readFile, writeFile} = await import("../hooks/useTauriFS");

const P1 = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const P2 = "01BBBBBBBBBBBBBBBBBBBBBBBB";
const O1 = "01CCCCCCCCCCCCCCCCCCCCCCCC";

describe("D-9: инвалидация кэша relations между ключами каталогов", () => {
  const ROOT = "C:/repo";
  const DOC_DIR = "C:/repo/docs/sub";
  const REL = `${ROOT}/harness_docs/harness_index/relations.jsonl`;
  const files = new Map<string, string>();
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

  beforeEach(() => {
    files.clear();
    files.set(norm(`${ROOT}/harness.yaml`), "vocabularies: {}\n");
    resetRelationsIndexCache();
    (readFile as Mock).mockImplementation(async (path: string) => {
      const hit = files.get(norm(path));
      if (hit == null) throw new Error("not found");
      return hit;
    });
    (writeFile as Mock).mockImplementation(async (path: string, text: string) => {
      files.set(norm(path), text);
    });
  });

  it("запись через ключ корня видна скану из ключа каталога документа", async () => {
    // Скан создаёт запись кэша ДО появления файла (пустая), панель пишет
    // связь под другим ключом того же файла. Кэш-запись скана не должна
    // оставаться устаревшей до перезапуска.
    const stale = await ensureRelationsIndex(DOC_DIR);
    expect(stale.relations).toEqual([]);

    const rootFile = await ensureRelationsIndex(ROOT);
    expect(rootFile.path.replace(/\\/g, "/").toLowerCase()).toBe(norm(REL));
    const rel: EntityRelation = {from: P1, to: O1, kind: "works_at", confidence: "explicit"};
    await writeRelationsIndex(rootFile, [rel]);

    const reread = await ensureRelationsIndex(DOC_DIR);
    expect(reread.relations).toEqual([rel]); // до фикса — [] (stale-кэш)
  });

  it("invalidateRelationsIndex сбрасывает только ключи этого файла", async () => {
    const OTHER = "C:/plain"; // вне harness-корня — свой relations.jsonl
    files.set(norm(`${OTHER}/relations.jsonl`), "");
    await ensureRelationsIndex(DOC_DIR);
    const other = await ensureRelationsIndex(OTHER);
    invalidateRelationsIndex(REL);
    const stillCached = await ensureRelationsIndex(OTHER);
    expect(stillCached).toBe(other); // ключ OTHER жив (свой путь)
    const refreshed = await ensureRelationsIndex(DOC_DIR);
    expect(refreshed.relations).toEqual([]); // ключ DOC_DIR сброшен → перечитан
  });
});

describe("T6-1: алиасы в справочнике", () => {
  it("читает aliases и не ломается на старых файлах без поля", () => {
    const old = parseEntitiesJsonl(
      JSON.stringify({ulid: P1, type: "person", canonical: "Иванов И. И.", forms: ["Иванов И. И."]}),
    );
    expect(old[0].aliases).toEqual([]);

    const withAlias = parseEntitiesJsonl(
      JSON.stringify({
        ulid: P1,
        type: "person",
        canonical: "Иванов Иван Иваныч",
        forms: ["Иванов Иван Иваныч"],
        aliases: ["John Smith"],
      }),
    );
    expect(withAlias[0].aliases).toEqual(["John Smith"]);
  });

  it("merge сохраняет ручные алиасы существующей записи", () => {
    const existing = [
      {ulid: P1, type: "person", canonical: "Иванов Иван Иваныч", forms: ["Иванов Иван Иваныч"], aliases: ["John Smith"]},
    ];
    const incoming = [
      {ulid: P1, type: "person", canonical: "Иванов Иван Иваныч", forms: ["Иванову И. И."]},
    ];
    const {entries} = mergeEntitiesIndex(existing, incoming);
    expect(entries[0].aliases).toEqual(["John Smith"]);
    expect(entries[0].forms).toContain("Иванову И. И.");
  });

  it("пустые aliases не пишутся в файл (совместимость с T3-форматом)", () => {
    const text = serializeEntitiesJsonl([
      {ulid: P1, type: "person", canonical: "Иванов", forms: ["Иванов"]},
    ]);
    expect(text).not.toContain("aliases");
  });

  it("алиас матчится раньше наблюдаемой формы", () => {
    const entries = [
      {ulid: P1, type: "person", canonical: "Иванов Иван Иваныч", forms: ["Иванов Иван Иваныч"], aliases: ["John Smith"]},
      {ulid: P2, type: "person", canonical: "John Smith", forms: ["John Smith"]},
    ];
    expect(matchEntityEntry(entries, "John Smith")?.ulid).toBe(P1);
  });
});

describe("T6-1: связи", () => {
  const relations: EntityRelation[] = [
    {from: P1, to: O1, kind: "works_at", confidence: "explicit"},
    {from: P2, to: O1, kind: "works_at", confidence: "inferred"},
  ];

  it("разбор и сериализация Round-trip", () => {
    const text = serializeRelationsJsonl(relations);
    const parsed = parseRelationsJsonl(text);
    expect(parsed).toHaveLength(2);
    expect(parsed.find((r) => r.from === P1)?.kind).toBe("works_at");
    expect(parsed.find((r) => r.from === P1)?.confidence).toBe("explicit");
  });

  it("битые строки пропускаются", () => {
    const parsed = parseRelationsJsonl('{"from":"a","to":"b","kind":"nope"}\nnot json\n');
    expect(parsed).toEqual([]);
  });

  it("merge: явная связь не вытесняется выведенной", () => {
    const merged = mergeRelations(
      [{from: P1, to: O1, kind: "works_at", confidence: "inferred"}],
      [{from: P1, to: O1, kind: "works_at", confidence: "explicit"}],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe("explicit");
  });

  it("merge: разные виды связи — разные записи", () => {
    const merged = mergeRelations(
      [{from: P1, to: O1, kind: "works_at", confidence: "explicit"}],
      [{from: P1, to: O1, kind: "member_of", confidence: "explicit"}],
    );
    expect(merged).toHaveLength(2);
  });

  it("relationsFor находит входящие и исходящие рёбра", () => {
    expect(relationsFor(relations, O1)).toHaveLength(2);
    expect(relationsFor(relations, P1)).toHaveLength(1);
  });

  it("resolveByRelations: явная связь с контекстом побеждает", () => {
    expect(resolveByRelations([P1, P2], [O1], relations)).toBe(P1);
  });

  it("resolveByRelations: без связей — null", () => {
    expect(resolveByRelations([P1, P2], [O1], [])).toBeNull();
  });
});

describe("T6-1: профиль co_occurs", () => {
  const docs = new Map<string, string[]>([
    ["a.md", [P1, O1]],
    ["b.md", [P1, O1]],
    ["c.md", [P2]],
  ]);

  it("считает совместные появления и документы", () => {
    const profile = computeCoOccurrences(docs);
    expect(profile.byEntity[P1][O1]).toBe(2);
    expect(profile.docs[`${P1}|${O1}`]).toEqual(["a.md", "b.md"]);
  });

  it("resolveByCoOccurrence выбирает кандидата по связи с контекстом", () => {
    const profile = computeCoOccurrences(docs);
    // В документе «a.md» с ООО Ромашка соседствует только первый Иванов.
    const winner = resolveByCoOccurrence([P1, P2], [O1], "a.md", profile);
    expect(winner).toBe(P1);
  });

  it("resolveByCoOccurrence: без общего контекста — null", () => {
    const profile = computeCoOccurrences(docs);
    expect(resolveByCoOccurrence([P1, P2], [P2], "a.md", profile)).toBeNull();
  });

  it("relationKey различает виды связи", () => {
    expect(relationKey({from: P1, to: O1, kind: "works_at", confidence: "explicit"})).not.toBe(
      relationKey({from: P1, to: O1, kind: "member_of", confidence: "explicit"}),
    );
  });
});
