import {beforeEach, describe, expect, it, vi, type Mock} from "vitest";

vi.mock("../hooks/useTauriFS", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
  // editorStore тянет saveFileDialog из того же модуля
  saveFileDialog: vi.fn(),
}));

const {readFile, writeFile} = await import("../hooks/useTauriFS");

import {resetEntitiesIndexCache} from "../lib/entitiesIndex";
import {resetRelationsIndexCache} from "../lib/entityRelations";
import {useEditorStore, type EditorTab} from "./editorStore";
import {
  retargetVasEntityHrefs,
  renameCanonical,
  useEntitiesIndexStore,
} from "./entitiesIndexStore";

const DIR = "C:/work/notes";
const ENTITIES_PATH = `${DIR}/entities.jsonl`;
const RELATIONS_PATH = `${DIR}/relations.jsonl`;

const P1 = "01AAAAAAAAAAAAAAAAAAAAAAAA"; // from (дубль)
const P2 = "01BBBBBBBBBBBBBBBBBBBBBBBB"; // into (главная)
const P3 = "01CCCCCCCCCCCCCCCCCCCCCCCC";
const O1 = "01DDDDDDDDDDDDDDDDDDDDDDDD";
const O2 = "01EEEEEEEEEEEEEEEEEEEEEEEE";

const P1_ENTRY = {
  ulid: P1,
  type: "person",
  canonical: "Иванов И. И.",
  forms: ["Иванов И. И.", "Иванову И. И."],
  aliases: ["John Smith"],
};
const P2_ENTRY = {
  ulid: P2,
  type: "person",
  canonical: "Иванов Иван Иванович",
  forms: ["Иванов Иван Иванович"],
};
const P3_ENTRY = {ulid: P3, type: "person", canonical: "Петров П. П.", forms: ["Петров П. П."]};
const O1_ENTRY = {ulid: O1, type: "org", canonical: "ООО Ромашка", forms: ["ООО Ромашка"]};
const O2_ENTRY = {ulid: O2, type: "org", canonical: "АО Колос", forms: ["АО Колос"]};

const RELATIONS = [
  {from: P1, to: O1, kind: "works_at", confidence: "explicit"},
  {from: P1, to: O2, kind: "co_occurs", confidence: "inferred"},
  {from: P2, to: O1, kind: "works_at", confidence: "inferred"}, // после переписки — дедуп с явной
  {from: P1, to: P3, kind: "alias_of", confidence: "explicit"},
];

// in-memory FS
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

function seed() {
  files.set(
    norm(ENTITIES_PATH),
    [P1_ENTRY, P2_ENTRY, P3_ENTRY, O1_ENTRY, O2_ENTRY].map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  files.set(norm(RELATIONS_PATH), RELATIONS.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const initialEditor = useEditorStore.getState();

function openTab(path: string, content: string): void {
  const tab: EditorTab = {
    path,
    name: "doc.md",
    kind: "markdown",
    content,
    savedContent: content,
    dirty: false,
    mode: "wysiwyg",
    preview: false,
  };
  useEditorStore.setState({tabs: [tab]});
}

beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
  wireFs();
  resetEntitiesIndexCache();
  resetRelationsIndexCache();
  useEditorStore.setState(initialEditor, true);
  useEntitiesIndexStore.setState(useEntitiesIndexStore.getState(), true);
});

async function loadedStore() {
  seed();
  await useEntitiesIndexStore.getState().load(DIR);
  return useEntitiesIndexStore.getState();
}

describe("T6-2: entitiesIndexStore", () => {
  it("load читает entities.jsonl и relations.jsonl рядом с каталогом", async () => {
    const state = await loadedStore();
    expect(state.dir).toBe(DIR);
    expect(state.entitiesPath).toBe(ENTITIES_PATH);
    expect(state.relationsPath).toBe(RELATIONS_PATH);
    expect(state.entries.map((e) => e.ulid)).toEqual([P1, P2, P3, O1, O2]);
    expect(state.relations).toHaveLength(4);
  });

  it("updateEntry: у «чистой» записи канон переименовывается без следа в forms", async () => {
    await loadedStore();
    await useEntitiesIndexStore.getState().updateEntry(P2, {canonical: "И. И. Иванов"});
    const state = useEntitiesIndexStore.getState();
    const entry = state.entries.find((e) => e.ulid === P2)!;
    expect(entry.canonical).toBe("И. И. Иванов");
    expect(entry.forms).toEqual(["И. И. Иванов"]);
    const onDisk = files.get(norm(ENTITIES_PATH)) ?? "";
    expect(onDisk).toContain("И. И. Иванов");
    expect(onDisk).not.toContain("Иванов Иван Иванович");
  });

  it("updateEntry: у размеченной записи старый канон остаётся наблюдаемой формой", async () => {
    await loadedStore();
    await useEntitiesIndexStore.getState().updateEntry(P1, {canonical: "Иванов Иван Иванович"});
    const entry = useEntitiesIndexStore.getState().entries.find((e) => e.ulid === P1)!;
    expect(entry.canonical).toBe("Иванов Иван Иванович");
    expect(entry.forms).toEqual(["Иванов И. И.", "Иванов Иван Иванович", "Иванову И. И."].sort());
  });

  it("updateEntry: aliases заменяются с дедупом и пишутся на диск", async () => {
    await loadedStore();
    await useEntitiesIndexStore.getState().updateEntry(P1, {aliases: ["John Smith", "J. Smith", "John Smith"]});
    const entry = useEntitiesIndexStore.getState().entries.find((e) => e.ulid === P1)!;
    expect(entry.aliases).toEqual(["J. Smith", "John Smith"]);
    expect(files.get(norm(ENTITIES_PATH)) ?? "").toContain("J. Smith");
  });

  it("removeEntry удаляет запись и её связи", async () => {
    await loadedStore();
    await useEntitiesIndexStore.getState().removeEntry(P3);
    const state = useEntitiesIndexStore.getState();
    expect(state.entries.some((e) => e.ulid === P3)).toBe(false);
    expect(state.relations.some((r) => r.from === P3 || r.to === P3)).toBe(false);
  });

  it("retargetVasEntityHrefs переписывает токен и ULID, текст чипа не трогает", () => {
    const content = "см. [Иванову И. И.](vas-entity:person:" + P1 + ") и [И. И.](vas-entity:PERSON:" + P1 + ")";
    const next = retargetVasEntityHrefs(content, P1, "person", P2);
    expect(next).not.toContain(P1);
    expect(next).toContain(`vas-entity:person:${P2}`);
    expect(next).toContain("[Иванову И. И.]");
    expect(next).toContain("[И. И.]");
  });

  it("renameCanonical: чистая запись — формы заменяются; наблюдаемая — старый канон остаётся", () => {
    const pure = renameCanonical({ulid: P2, type: "person", canonical: "Иванов", forms: ["Иванов"]}, "И. И. Иванов");
    expect(pure.forms).toEqual(["И. И. Иванов"]);
    const observed = renameCanonical({ulid: P1, type: "person", canonical: "Иванов И. И.", forms: ["Иванов И. И.", "Иванову И. И."]}, "Иванов");
    expect(observed.forms).toEqual(["Иванов", "Иванов И. И.", "Иванову И. И."].sort());
  });

  it("mergeEntries: формы/алиасы переезжают, запись from удаляется, связи переписываются с дедупом", async () => {
    await loadedStore();
    await useEntitiesIndexStore.getState().mergeEntries(P1, P2);
    const state = useEntitiesIndexStore.getState();

    expect(state.entries.some((e) => e.ulid === P1)).toBe(false);
    const into = state.entries.find((e) => e.ulid === P2)!;
    expect(into.forms).toEqual(
      ["Иванов Иван Иванович", "Иванов И. И.", "Иванову И. И."].sort(),
    );
    expect(into.aliases).toEqual(["John Smith"]);

    // связи: явная P2→O1 вытесняет inferred-дубликат; alias_of переписан на P2→P3
    expect(state.relations.some((r) => r.from === P1 || r.to === P1)).toBe(false);
    const worksAt = state.relations.filter((r) => r.kind === "works_at" && r.to === O1);
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0].from).toBe(P2);
    expect(worksAt[0].confidence).toBe("explicit");
    const aliasOf = state.relations.find((r) => r.kind === "alias_of")!;
    expect(aliasOf).toMatchObject({from: P2, to: P3});
    // co_occurs переписан (выведенное свидетельство сохраняется)
    expect(state.relations.some((r) => r.kind === "co_occurs" && r.from === P2)).toBe(true);

    // файлы на диске
    expect(files.get(norm(ENTITIES_PATH)) ?? "").not.toContain(P1);
    expect(files.get(norm(RELATIONS_PATH)) ?? "").not.toContain(`"from":"${P1}"`);
  });

  it("mergeEntries переписывает якоря в открытых вкладках (updateContent, вкладка dirty)", async () => {
    await loadedStore();
    const docPath = `${DIR}/doc.md`;
    const content = `Начало. См. [Иванову И. И.](vas-entity:person:${P1}), затем [ООО Ромашка](vas-entity:org:${O1}).`;
    openTab(docPath, content);

    await useEntitiesIndexStore.getState().mergeEntries(P1, P2);
    const tab = useEditorStore.getState().tabs.find((t) => t.path === docPath)!;
    expect(tab.content).toContain(`vas-entity:person:${P2}`);
    expect(tab.content).not.toContain(P1);
    expect(tab.content).toContain(`vas-entity:org:${O1}`);
    expect(tab.content).toContain("[Иванову И. И.]");
    expect(tab.dirty).toBe(true);
  });

  it("addRelation: дедуп по ключу, явная связь вытесняет выведенную", async () => {
    await loadedStore();
    const store = useEntitiesIndexStore.getState();
    await store.addRelation({from: P3, to: O1, kind: "works_at", confidence: "inferred"});
    await store.addRelation({from: P3, to: O1, kind: "works_at", confidence: "inferred"});
    let state = useEntitiesIndexStore.getState();
    expect(state.relations.filter((r) => r.from === P3)).toHaveLength(1);

    await store.addRelation({from: P3, to: O1, kind: "works_at", confidence: "explicit"});
    state = useEntitiesIndexStore.getState();
    const edge = state.relations.find((r) => r.from === P3)!;
    expect(edge.confidence).toBe("explicit");
    expect(files.get(norm(RELATIONS_PATH)) ?? "").toContain('"explicit"');
  });

  it("removeRelation удаляет ребро по ключу", async () => {
    await loadedStore();
    const store = useEntitiesIndexStore.getState();
    await store.removeRelation({from: P1, to: O1, kind: "works_at", confidence: "explicit"});
    const state = useEntitiesIndexStore.getState();
    expect(state.relations.some((r) => r.from === P1 && r.to === O1)).toBe(false);
    const written = (files.get(norm(RELATIONS_PATH)) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(written).not.toContainEqual({from: P1, to: O1, kind: "works_at", confidence: "explicit"});
    expect(written).toContainEqual({from: P2, to: O1, kind: "works_at", confidence: "inferred"});
  });
});
