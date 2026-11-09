import {beforeEach, describe, expect, it, vi, type Mock} from "vitest";

vi.mock("../hooks/useTauriFS", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
  saveFileDialog: vi.fn(),
}));

const {readFile, writeFile} = await import("../hooks/useTauriFS");

import {resetEntitiesIndexCache} from "../lib/entitiesIndex";
import {resetRelationsIndexCache} from "../lib/entityRelations";
import {useEditorStore, type EditorTab} from "./editorStore";
import {useEntityConflictStore} from "./entityConflictStore";
import {useUiStore} from "./uiStore";
import {resetRegistryCompiledCache} from "../lib/registryHighlightExtension";
import {resetDeclensionCache} from "../lib/agent/masking/declension";

const DIR = "C:/work/notes";
const DOC = `${DIR}/doc.md`;
// ULID с таймстампом >= 2020 (isPlausibleUlid): 01AAA… отбраковывается как
// «2016 год», и parseEntityLinks не распознаёт чипы (vasEntity.test.ts:47)
const P1 = "01JBBCCCCDDDDDDDDDDDDDDDDD";
const P2 = "01JHKNNNNNNNNNNNNNNNNNNNNN";
const O1 = "01JHKMMMMMMMMMMMMMMMMMMMMM";

const ENTRIES = [
  {ulid: P1, type: "person", canonical: "Иванов Иван Иванович", forms: ["Иванов И. И."]},
  {ulid: P2, type: "person", canonical: "Иванов Пётр Сидорович", forms: ["Иванов И. И."]},
  {ulid: O1, type: "org", canonical: "АО Колос", forms: ["АО Колос"]},
];

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

function seed(relations: Array<Record<string, string>> = []) {
  files.set(norm(`${DIR}/entities.jsonl`), ENTRIES.map((e) => JSON.stringify(e)).join("\n") + "\n");
  files.set(norm(`${DIR}/relations.jsonl`), relations.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const initialEditor = useEditorStore.getState();
const initialUi = useUiStore.getState();

function openTab(content: string): void {
  const tab: EditorTab = {
    path: DOC,
    name: "doc.md",
    kind: "markdown",
    content,
    savedContent: content,
    dirty: false,
    mode: "wysiwyg",
    preview: false,
  };
  useEditorStore.setState({tabs: [tab], activePath: DOC});
}

beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
  wireFs();
  resetEntitiesIndexCache();
  resetRelationsIndexCache();
  resetRegistryCompiledCache();
  resetDeclensionCache();
  useEditorStore.setState(initialEditor, true);
  useUiStore.setState(initialUi, true);
});

describe("T6-5: entityConflictStore", () => {
  it("скан находит конфликт: одна форма → два кандидата, без контекста — конфликт", async () => {
    seed();
    openTab("Иванов И. И. пришёл. Иванов И. И. ушёл.");
    await useEntityConflictStore.getState().scan(DOC, useEditorStore.getState().tabs[0].content);
    const state = useEntityConflictStore.getState().byDoc[norm(DOC)];
    expect(state?.conflicts).toHaveLength(1);
    expect(state?.conflicts[0].candidates.map((c) => c.ulid).sort()).toEqual([P1, P2].sort());
    expect(state?.conflicts[0].occurrences).toHaveLength(2);
    expect(state?.resolvable).toHaveLength(0);
  });

  it("якорь по конфликту: вхождения становятся чипами выбранного ULID, документ dirty", async () => {
    seed();
    openTab("Иванов И. И. пришёл. Иванов И. И. ушёл.");
    const store = useEntityConflictStore.getState();
    await store.scan(DOC, useEditorStore.getState().tabs[0].content);
    const conflict = useEntityConflictStore.getState().byDoc[norm(DOC)]!.conflicts[0];
    await store.anchorConflict(DOC, conflict, P1);
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe(
      `[Иванов И. И.](vas-entity:person:${P1}) пришёл. [Иванов И. И.](vas-entity:person:${P1}) ушёл.`,
    );
    expect(tab.dirty).toBe(true);
    // переразбор после якоря: конфликтов больше нет
    expect(useEntityConflictStore.getState().byDoc[norm(DOC)]!.conflicts).toHaveLength(0);
  });

  it("явная связь кандидата с контекстом → вхождение однозначно; авто-якоря ставят чип сами", async () => {
    seed([{from: P2, to: O1, kind: "member_of", confidence: "explicit"}]);
    useUiStore.getState().setAutoAnchors(true);
    openTab("Иванов И. И. из АО Колос подтвердил.");
    await useEntityConflictStore.getState().scan(DOC, useEditorStore.getState().tabs[0].content);
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe(`[Иванов И. И.](vas-entity:person:${P2}) из АО Колос подтвердил.`);
    const state = useEntityConflictStore.getState().byDoc[norm(DOC)];
    expect(state?.conflicts).toHaveLength(0);
    expect(state?.resolvable).toHaveLength(0); // закреплено автоматически
  });

  it("авто-якоря выключены: однозначное вхождение ждёт ручного «Закрепить»", async () => {
    seed([{from: P2, to: O1, kind: "member_of", confidence: "explicit"}]);
    openTab("Иванов И. И. из АО Колос подтвердил.");
    await useEntityConflictStore.getState().scan(DOC, useEditorStore.getState().tabs[0].content);
    const state = useEntityConflictStore.getState().byDoc[norm(DOC)];
    expect(useEditorStore.getState().tabs[0].content).not.toContain("vas-entity");
    expect(state?.resolvable).toHaveLength(1);
    expect(state?.resolvable[0].entry.ulid).toBe(P2);
    expect(state?.resolvable[0].via).toBe("relations");
  });

  it("размеченные вхождения не конфликтуют (пересечение с якорем пропускается)", async () => {
    seed();
    openTab(`[Иванов И. И.](vas-entity:person:${P1}) и Иванов И. И. — разные?`);
    await useEntityConflictStore.getState().scan(DOC, useEditorStore.getState().tabs[0].content);
    const state = useEntityConflictStore.getState().byDoc[norm(DOC)];
    // второе вхождение тоже конфликтует (форма общая), первое — под якорем
    expect(state?.conflicts).toHaveLength(1);
    expect(state?.conflicts[0].occurrences).toHaveLength(1);
  });

  it("D-7: конфликт по склонению (форма только генерируется, не хранится) виден", async () => {
    // «Ивановым И. И.» — творительный падеж, который declension выводит и из
    // «Иванов Иван Иванович», и из «Иванов Иван Иваныч»; в stored-формах его
    // нет. Резолвер перематчинговал по stored → matchesOfForm=[] → вхождение
    // молча пропускалось (флагман T6-5). Фикс: кандидаты из компилята.
    // NB: forms: [] индекс отбраковывает (entitiesIndex.ts:55) — stored-форма
    // = сам канон, склонённой формы в списке нет.
    const Q1 = "01JHKQQQQQQQQQQQQQQQQQQQ";
    const Q2 = "01JHKRRRRRRRRRRRRRRRRRRR";
    files.set(
      norm(`${DIR}/entities.jsonl`),
      [
        {ulid: Q1, type: "person", canonical: "Иванов Иван Иванович", forms: ["Иванов Иван Иванович"]},
        {ulid: Q2, type: "person", canonical: "Иванов Иван Иваныч", forms: ["Иванов Иван Иваныч"]},
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    files.set(norm(`${DIR}/relations.jsonl`), "");
    openTab("Отчёт согласован с Ивановым И. И. вчера.");
    await useEntityConflictStore.getState().scan(DOC, useEditorStore.getState().tabs[0].content);
    const state = useEntityConflictStore.getState().byDoc[norm(DOC)];
    expect(state?.conflicts).toHaveLength(1);
    expect(state?.conflicts[0].value).toBe("Ивановым И. И.");
    expect(state?.conflicts[0].candidates.map((c) => c.ulid).sort()).toEqual([Q1, Q2].sort());
  });

  it("D-8: вхождение формы внутри fenced-кода не конфликтует", async () => {
    seed();
    openTab("Иванов И. И. вне фенса.\n\n```\nИванов И. И. внутри фенса\n```\n");
    await useEntityConflictStore.getState().scan(DOC, useEditorStore.getState().tabs[0].content);
    const state = useEntityConflictStore.getState().byDoc[norm(DOC)];
    expect(state?.conflicts).toHaveLength(1);
    expect(state?.conflicts[0].occurrences).toHaveLength(1); // только проза (было 2 — D-8)
  });

  it("D-10: авто-якоря не лезут в fenced-код (без рекурсивного цикла)", async () => {
    seed([{from: P2, to: O1, kind: "member_of", confidence: "explicit"}]);
    useUiStore.getState().setAutoAnchors(true);
    openTab("Иванов И. И. из АО Колос подтвердил.\n\n```\nИванов И. И.\n```\n");
    await useEntityConflictStore.getState().scan(DOC, useEditorStore.getState().tabs[0].content);
    const tab = useEditorStore.getState().tabs[0];
    // проза заякорена ровно одним слоем; строка внутри фенса не тронута
    expect(tab.content).toBe(
      `[Иванов И. И.](vas-entity:person:${P2}) из АО Колос подтвердил.\n\n\`\`\`\nИванов И. И.\n\`\`\`\n`,
    );
    expect(tab.content.match(/vas-entity:/g)).toHaveLength(1); // не 50 слоёв (D-10)
  });
});
