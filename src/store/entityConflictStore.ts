import {create} from "zustand";
import {blockAt} from "../lib/entityContext";
import {resolveRegistryForm} from "../lib/entityResolution";
import {compileRegistryForms, matchRegistryForms} from "../lib/registryHighlightExtension";
import {
  ensureEntitiesIndex,
  addEntityToIndex,
  type EntityIndexEntry,
} from "../lib/entitiesIndex";
import {
  computeCoOccurrences,
  ensureRelationsIndex,
  type EntityRelation,
} from "../lib/entityRelations";
import {parseEntityLinks} from "../lib/agent/masking/vasEntityMarkup";
import {buildVasEntityHref} from "../lib/agent/masking/vasEntityLink";
import {getParentDir} from "../lib/utils";
import {getEditor} from "../lib/editorRegistry";
import {useEditorStore} from "./editorStore";
import {useEntitiesIndexStore} from "./entitiesIndexStore";
import {useUiStore} from "./uiStore";

/**
 * Стор конфликтов справочника (Phase 8.5, T6-5; план 20261105_012): скан
 * активного документа — вхождения форм справочника (подсветка T6-3) без
 * якорей; несколько ULID у одной формы → контекст-блок → явные связи →
 * co_occurs → конфликт. Решение фиксируется якорем-чипом (B-6: правка через
 * editor.replace/updateContent открытой вкладки). Авто-якоря — по флагу
 * uiStore.autoAnchors (выключен по умолчанию).
 */

export interface ResolvableOccurrence {
  value: string;
  type: string;
  start: number;
  end: number;
  /** Кандидат, выбранный движком разрешения. */
  entry: EntityIndexEntry;
  via: "relations" | "co_occurs";
}

export interface EntityConflict {
  /** value + отсортированные ULID кандидатов — группировка вхождений. */
  key: string;
  value: string;
  type: string;
  occurrences: Array<{start: number; end: number}>;
  candidates: EntityIndexEntry[];
}

interface DocumentConflicts {
  path: string;
  at: number;
  scanning: boolean;
  error: string | null;
  resolvable: ResolvableOccurrence[];
  conflicts: EntityConflict[];
}

interface EntityConflictState {
  byDoc: Record<string, DocumentConflicts>;
  scan: (path: string, content: string) => Promise<void>;
  /** Поставить якорь на вхождения конфликта, выбрав кандидата. */
  anchorConflict: (path: string, conflict: EntityConflict, ulid: string) => Promise<void>;
  /** Закрепить однозначно разрешённое вхождение. */
  anchorResolvable: (path: string, occurrence: ResolvableOccurrence) => Promise<void>;
  /** «Это отдельная сущность»: новая запись + якорь. */
  createSeparate: (path: string, conflict: EntityConflict) => Promise<void>;
  /** «Всегда связаны по форме»: слить кандидатов в первого (сильнее alias_of). */
  mergeConflict: (path: string, conflict: EntityConflict) => Promise<void>;
  clear: (path: string) => void;
}

const initialDoc: DocumentConflicts = {
  path: "",
  at: 0,
  scanning: false,
  error: null,
  resolvable: [],
  conflicts: [],
};

function normPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** Пакет raw-правок контента (паттерн applyEdits NerButton): с конца. */
function applyAnchorEdits(
  content: string,
  edits: Array<{start: number; end: number; insert: string}>,
): string {
  let next = content;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.insert + next.slice(edit.end);
  }
  return next;
}

/** Записать новый контент в открытую вкладку (редактор или store, B-6). */
function writeTabContent(path: string, next: string): void {
  const editor = getEditor(path);
  if (editor != null) {
    editor.replace(next); // change → store → dirty (паттерн restoreUrls)
  } else {
    useEditorStore.getState().updateContent(path, next);
  }
}

interface ConflictGroups {
  resolvable: ResolvableOccurrence[];
  conflicts: EntityConflict[];
}

/** Ядро скана: чистая функция над документом (тесты — через store.scan). */
function collectConflicts(
  docPath: string,
  content: string,
  entries: readonly EntityIndexEntry[],
  relations: readonly EntityRelation[],
): ConflictGroups {
  const compiled = compileRegistryForms(entries);
  if (compiled == null) return {resolvable: [], conflicts: []};

  const marked = parseEntityLinks(content);
  const overlapsMarked = (start: number, end: number) =>
    marked.some((span) => start < span.end && span.start < end);

  // профиль co_occurs из этого документа: ULID-ы всех размеченных сущностей
  const markedUlids = [...new Set(marked.map((span) => span.ulid))];
  const profile = computeCoOccurrences(new Map([[docPath, markedUlids]]));

  const matches = matchRegistryForms(content, compiled);
  const resolvable: ResolvableOccurrence[] = [];
  const byKey = new Map<string, EntityConflict>();

  for (const match of matches) {
    if (overlapsMarked(match.start, match.end)) continue; // уже размечено (якорь)
    const candidates = entries.filter((entry) => match.ulids.includes(entry.ulid));
    if (candidates.length < 2) continue; // однозначно — не конфликт

    const block = blockAt(content, match.start);
    // соседи контекста: вхождения других форм в этом же блоке
    const contextUlids = new Set<string>();
    for (const other of matchRegistryForms(block.text, compiled)) {
      const otherStart = block.start + other.start;
      const otherEnd = block.start + other.end;
      if (otherStart < match.end && match.start < otherEnd) continue; // само вхождение
      if (match.ulids.some((ulid) => other.ulids.includes(ulid))) continue; // кандидаты
      for (const ulid of other.ulids) contextUlids.add(ulid);
    }

    const resolution = resolveRegistryForm(
      match.value,
      {docPath, contextUlids: [...contextUlids]},
      entries,
      relations,
      profile,
    );
    if (resolution == null || resolution.status === "unique") continue;
    const type = candidates[0]?.type ?? "";
    if (resolution.status === "resolved") {
      resolvable.push({
        value: match.value,
        type,
        start: match.start,
        end: match.end,
        entry: resolution.entry,
        via: resolution.via,
      });
      continue;
    }
    // conflict: группируем по (форма, набор кандидатов)
    const key = `${match.value}|${[...match.ulids].sort().join(",")}`;
    const group = byKey.get(key);
    if (group != null) {
      group.occurrences.push({start: match.start, end: match.end});
    } else {
      byKey.set(key, {
        key,
        value: match.value,
        type,
        occurrences: [{start: match.start, end: match.end}],
        candidates,
      });
    }
  }
  return {resolvable, conflicts: [...byKey.values()]};
}

export const useEntityConflictStore = create<EntityConflictState>((set, get) => ({
  byDoc: {},

  scan: async (path, content) => {
    const key = normPath(path);
    set((s) => ({
      byDoc: {...s.byDoc, [key]: {...(s.byDoc[key] ?? initialDoc), path, scanning: true, error: null}},
    }));
    try {
      const dir = getParentDir(path);
      const entitiesFile = await ensureEntitiesIndex(dir);
      const relationsFile = await ensureRelationsIndex(dir);
      const groups = collectConflicts(normPath(path), content, entitiesFile.entries, relationsFile.relations);
      // авто-якоря (выключены по умолчанию): однозначные вхождения закрепляются сами.
      // Guard: вставка, которая уже стоит на месте, не повторяется — иначе при
      // нераспознанной ссылке якорь ставился бы на каждый скан (бесконечный цикл).
      const {autoAnchors} = useUiStore.getState();
      if (autoAnchors && groups.resolvable.length > 0) {
        const edits = groups.resolvable
          .map((occ) => ({
            start: occ.start,
            end: occ.end,
            insert: `[${occ.value}](${buildVasEntityHref(occ.entry.type, occ.entry.ulid)})`,
          }))
          .filter((edit) => content.slice(edit.start, edit.end) !== edit.insert);
        if (edits.length > 0) {
          const next = applyAnchorEdits(content, edits);
          if (next !== content) {
            writeTabContent(path, next);
            await get().scan(path, next); // переразбор после правки
            return;
          }
        }
      }
      set((s) => ({
        byDoc: {
          ...s.byDoc,
          [key]: {
            path,
            at: Date.now(),
            scanning: false,
            error: null,
            resolvable: groups.resolvable,
            conflicts: groups.conflicts,
          },
        },
      }));
    } catch (e) {
      set((s) => ({
        byDoc: {
          ...s.byDoc,
          [key]: {...(s.byDoc[key] ?? initialDoc), path, scanning: false, error: String(e)},
        },
      }));
    }
  },

  anchorConflict: async (path, conflict, ulid) => {
    const entry = conflict.candidates.find((c) => c.ulid === ulid);
    if (entry == null) return;
    const content = useEditorStore.getState().tabs.find((t) => t.path === path)?.content;
    if (content == null) return;
    const edits = conflict.occurrences.map((occ) => ({
      start: occ.start,
      end: occ.end,
      insert: `[${conflict.value}](${buildVasEntityHref(entry.type, entry.ulid)})`,
    }));
    const next = applyAnchorEdits(content, edits);
    if (next === content) return;
    writeTabContent(path, next);
    await get().scan(path, next);
  },

  anchorResolvable: async (path, occurrence) => {
    const content = useEditorStore.getState().tabs.find((t) => t.path === path)?.content;
    if (content == null) return;
    const next = applyAnchorEdits(content, [
      {
        start: occurrence.start,
        end: occurrence.end,
        insert: `[${occurrence.value}](${buildVasEntityHref(occurrence.entry.type, occurrence.entry.ulid)})`,
      },
    ]);
    if (next === content) return;
    writeTabContent(path, next);
    await get().scan(path, next);
  },

  createSeparate: async (path, conflict) => {
    const dir = getParentDir(path);
    // тип первого кандидата — тот же слот справочника, что у однофамильцев
    const created = await addEntityToIndex(dir, {
      type: conflict.type,
      canonical: conflict.value,
    });
    const content = useEditorStore.getState().tabs.find((t) => t.path === path)?.content;
    if (content == null) return;
    // вхождение смещается не было: правка только в индексе, якорь по старым позициям
    const next = applyAnchorEdits(content, [
      {
        start: conflict.occurrences[0]?.start ?? 0,
        end: conflict.occurrences[0]?.end ?? 0,
        insert: `[${conflict.value}](${buildVasEntityHref(created.type, created.ulid)})`,
      },
    ]);
    writeTabContent(path, next);
    await get().scan(path, next);
  },

  mergeConflict: async (path, conflict) => {
    const dir = getParentDir(path);
    const main = conflict.candidates[0];
    if (main == null) return;
    const indexStore = useEntitiesIndexStore.getState();
    await indexStore.load(dir); // dir конфликта — слияние через общий стор
    for (const candidate of conflict.candidates.slice(1)) {
      await useEntitiesIndexStore.getState().mergeEntries(candidate.ulid, main.ulid);
    }
    await get().scan(path, useEditorStore.getState().tabs.find((t) => t.path === path)?.content ?? "");
  },

  clear: (path) => {
    const key = normPath(path);
    set((s) => {
      const next = {...s.byDoc};
      delete next[key];
      return {byDoc: next};
    });
  },
}));
