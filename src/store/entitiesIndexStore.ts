import {create} from "zustand";
import {
  ensureEntitiesIndex,
  writeEntitiesIndex,
  type EntityIndexEntry,
} from "../lib/entitiesIndex";
import {
  ensureRelationsIndex,
  mergeRelations,
  relationKey,
  writeRelationsIndex,
  type EntityRelation,
  type RelationsIndexFile,
} from "../lib/entityRelations";
import {buildVasEntityHref} from "../lib/agent/masking/vasEntityLink";
import {subscribeEntitiesIndex, type EntitiesIndexFile} from "../lib/entitiesIndex";
import {useEditorStore} from "./editorStore";
import {getEditor} from "../lib/editorRegistry";

/**
 * Стор справочника (Phase 8.5, T6-2; план 20261105_011): правка
 * `entities.jsonl` / `relations.jsonl` из панели «Справочник» — canonical,
 * тип, алиасы, удаление, слияние дублей, явные связи. Данные — только через
 * этот стор (как у harnessTasksStore, D3): функции T6-1 остаются источником
 * записи, стор — источник состояния UI. Правки якорей в документах — только
 * в открытых вкладках (B-6, паттерн resolveTypeConflict).
 */

interface EntitiesIndexState {
  /** Каталог справочника (harness-корень или workspace-каталог). */
  dir: string | null;
  /** Файл сущностей (путь для инвалидации/отладки). */
  entitiesPath: string | null;
  /** Файл связей. */
  relationsPath: string | null;
  entries: EntityIndexEntry[];
  relations: EntityRelation[];
  loading: boolean;
  error: string | null;
  /** Растёт на каждой мутации/перезагрузке — подписки компонентов. */
  version: number;

  load: (dir: string) => Promise<void>;
  /** canonical/тип/алиасы одной записи (панель, редактор сущности). */
  updateEntry: (
    ulid: string,
    patch: Partial<Pick<EntityIndexEntry, "canonical" | "type" | "aliases">>,
  ) => Promise<void>;
  removeEntry: (ulid: string) => Promise<void>;
  /** Слияние дублей: from переезжает в into (формы+алиасы+связи+якоря). */
  mergeEntries: (fromUlid: string, intoUlid: string) => Promise<void>;
  addRelation: (relation: EntityRelation) => Promise<void>;
  removeRelation: (relation: EntityRelation) => Promise<void>;
}

/**
 * Переписать якоря `vas-entity:<token>:<from>` → `vas-entity:<intoType>:<into>`
 * (слияние дублей T6-2; текст чипа не меняется). Экспорт — для тестов.
 */
export function retargetVasEntityHrefs(
  content: string,
  fromUlid: string,
  intoType: string,
  intoUlid: string,
): string {
  const re = new RegExp(`vas-entity:([a-z_]+):(${fromUlid})`, "gi");
  return content.replace(re, `vas-entity:${intoType.toLowerCase()}:${intoUlid}`);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Замена canonical (панель, T6-2): у «чистой» записи (наблюдаемых форм нет —
 * только сам канон, «В справочник» T6-4) старый канон не остаётся формой; у
 * размеченной — остаётся наблюдаемой формой (он был в документах), новый
 * канон входит в forms по инварианту формата (canonical ⊆ forms).
 */
export function renameCanonical(entry: EntityIndexEntry, canonical: string): EntityIndexEntry {
  const old = entry.canonical;
  const rest = entry.forms.filter((f) => f !== old);
  return {
    ...entry,
    canonical,
    forms:
      rest.length === 0 ? sortedUnique([canonical]) : sortedUnique([old, canonical, ...rest]),
  };
}

export const useEntitiesIndexStore = create<EntitiesIndexState>((set, get) => ({
  dir: null,
  entitiesPath: null,
  relationsPath: null,
  entries: [],
  relations: [],
  loading: false,
  error: null,
  version: 0,

  load: async (dir) => {
    set((s) => ({loading: true, error: null, version: s.version + 1}));
    try {
      const entitiesFile = await ensureEntitiesIndex(dir);
      const relationsFile = await ensureRelationsIndex(dir);
      set({
        dir,
        entitiesPath: entitiesFile.path,
        relationsPath: relationsFile.path,
        entries: entitiesFile.entries,
        relations: relationsFile.relations,
        loading: false,
      });
    } catch (e) {
      set({loading: false, error: String(e)});
    }
  },

  updateEntry: async (ulid, patch) => {
    const {dir} = get();
    if (dir == null) return;
    const file: EntitiesIndexFile = await ensureEntitiesIndex(dir);
    const entries = file.entries.map((entry) => {
      if (entry.ulid !== ulid) return entry;
      const next: EntityIndexEntry = {...entry};
      if (patch.canonical != null && patch.canonical !== entry.canonical) {
        return renameCanonical(next, patch.canonical);
      }
      if (patch.type != null) next.type = patch.type.toLowerCase();
      if (patch.aliases != null) next.aliases = sortedUnique(patch.aliases);
      return next;
    });
    await writeEntitiesIndex(file, entries);
    set((s) => ({entries, version: s.version + 1}));
  },

  removeEntry: async (ulid) => {
    const {dir} = get();
    if (dir == null) return;
    const file = await ensureEntitiesIndex(dir);
    const entries = file.entries.filter((e) => e.ulid !== ulid);
    await writeEntitiesIndex(file, entries);
    // висячие связи удалённой записи — тоже прочь (панель не показывает их)
    const relationsFile = await ensureRelationsIndex(dir);
    const relations = relationsFile.relations.filter(
      (rel) => rel.from !== ulid && rel.to !== ulid,
    );
    if (relations.length !== relationsFile.relations.length) {
      await writeRelationsIndex(relationsFile, relations);
    }
    set((s) => ({entries, relations, version: s.version + 1}));
  },

  mergeEntries: async (fromUlid, intoUlid) => {
    const {dir} = get();
    if (dir == null || fromUlid === intoUlid) return;
    const file = await ensureEntitiesIndex(dir);
    const from = file.entries.find((e) => e.ulid === fromUlid);
    const into = file.entries.find((e) => e.ulid === intoUlid);
    if (from == null || into == null) return;

    // 1) индекс: формы+алиасы переезжают, запись from удаляется
    const entries = file.entries
      .filter((e) => e.ulid !== fromUlid)
      .map((entry) =>
        entry.ulid === intoUlid
          ? {
              ...entry,
              forms: sortedUnique([entry.canonical, ...entry.forms, from.canonical, ...from.forms]),
              aliases: sortedUnique([...(entry.aliases ?? []), ...(from.aliases ?? [])]),
            }
          : entry,
      );
    await writeEntitiesIndex(file, entries);

    // 2) связи: концы from → into; self-loops после переписки — прочь
    const relationsFile: RelationsIndexFile = await ensureRelationsIndex(dir);
    const retargeted = relationsFile.relations
      .map((rel) => ({
        ...rel,
        from: rel.from === fromUlid ? intoUlid : rel.from,
        to: rel.to === fromUlid ? intoUlid : rel.to,
      }))
      .filter((rel) => rel.from !== rel.to);
    const relations = mergeRelations([], retargeted); // дедуп по (from,to,kind), explicit сильнее
    await writeRelationsIndex(relationsFile, relations);

    // 3) якоря в открытых вкладках (B-6): href на ULID from → into
    const token = into.type;
    const tabs = useEditorStore.getState().tabs;
    for (const tab of tabs) {
      if (!tab.content.includes(fromUlid)) continue;
      const next = retargetVasEntityHrefs(tab.content, fromUlid, token, intoUlid);
      if (next === tab.content) continue;
      const editor = getEditor(tab.path);
      if (editor != null) {
        editor.replace(next); // change → store → dirty (паттерн restoreUrls)
      } else {
        useEditorStore.getState().updateContent(tab.path, next);
      }
    }

    set((s) => ({entries, relations, version: s.version + 1}));
  },

  addRelation: async (relation) => {
    const {dir} = get();
    if (dir == null) return;
    const relationsFile = await ensureRelationsIndex(dir);
    // дедуп по (from,to,kind): явная связь не дублируется и вытесняет inferred
    const relations = mergeRelations(relationsFile.relations, [relation]);
    await writeRelationsIndex(relationsFile, relations);
    set((s) => ({relations, version: s.version + 1}));
  },

  removeRelation: async (relation) => {
    const {dir} = get();
    if (dir == null) return;
    const relationsFile = await ensureRelationsIndex(dir);
    const relations = relationsFile.relations.filter(
      (rel) => relationKey(rel) !== relationKey(relation),
    );
    await writeRelationsIndex(relationsFile, relations);
    set((s) => ({relations, version: s.version + 1}));
  },
}));

/**
 * Файл индекса изменился (save-хук документа, watcher): перечитать для
 * активного каталога. Подписка — на уровне модуля стора (одна на всё
 * приложение); собственные записи стора тоже проходят через
 * writeEntitiesIndex → перезагрузка идемпотентна (кэш уже свежий).
 */
subscribeEntitiesIndex((path) => {
  const {dir, entitiesPath} = useEntitiesIndexStore.getState();
  if (dir == null || entitiesPath == null) return;
  if (path.replace(/\\/g, "/").toLowerCase() !== entitiesPath.replace(/\\/g, "/").toLowerCase()) {
    return;
  }
  void useEntitiesIndexStore.getState().load(dir);
});

/** Ссылка-якорь сущности (для переписки/подсказок UI). */
export function vasEntityHrefOf(entry: EntityIndexEntry): string {
  return buildVasEntityHref(entry.type, entry.ulid);
}
