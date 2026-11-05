/**
 * Runtime-подсветка форм справочника в WYSIWYG (Phase 8.5, T6-3; план
 * 20261105_010): декорации над вхождениями форм сущностей `entities.jsonl`
 * в неразмеченном тексте. Размеченные чипы (link-марки) и код-блоки
 * пропускаются. Неоднозначная форма (одна форма → несколько ULID) получает
 * отдельный класс — сигнал для панели конфликтов (T6-5).
 *
 * Механика: одна регулярка на все формы (экранирование, границы слова через
 * lookaround по \p{L}\p{N} — \b не работает с кириллицей); формы короче
 * MIN_FORM_LENGTH пропускаются; склонения — через expandEntityForms (T3d),
 * алиасы — из T6-1. Перестройка: транзакции (как у чипов), флаг в uiStore,
 * изменения файла индекса — через subscribeEntitiesIndex (save/watcher).
 * Кэш скомпилированной регулярки — на каталог. Match регистрозависим:
 * матчится согласованно с matchEntityEntry, ложных срабатываний меньше.
 */

import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet} from "prosemirror-view";
import type {Node as PMNode} from "prosemirror-model";
import type {Extension} from "@gravity-ui/markdown-editor";
import {ensureEntitiesIndex, subscribeEntitiesIndex, type EntityIndexEntry} from "./entitiesIndex";
import {expandEntityForms} from "./agent/masking/declension";
import {useUiStore} from "../store/uiStore";

const LINK_MARK_NAME = "link";
const REBUILD_META = "vasyavig-registry-highlight-rebuild";

/** Формы короче не подсвечиваются («Иван» ловил бы всё подряд). */
export const MIN_FORM_LENGTH = 3;

export interface RegistryCompiled {
  /** Все формы, longest-first: альтернативы с общей приставкой не съедают друг друга. */
  regex: RegExp;
  /** Форма (как в тексте) → ULID'ы записей; больше одного — неоднозначность. */
  byForm: Map<string, string[]>;
  /** Форма → тип записи (lowercase, из первой записи по ulid). */
  typeByForm: Map<string, string>;
}

export interface RegistryMatch {
  start: number;
  end: number;
  value: string;
  ulids: string[];
  type: string;
  /** Одна форма → несколько ULID (однофамильцы/дубли — сигнал T6-5). */
  ambiguous: boolean;
}

function escapeRegex(form: string): string {
  return form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codePoints(form: string): number {
  return [...form].length;
}

/**
 * Скомпилировать формы записей в одну регулярку. Формы записи: алиасы
 * (T6-1) + наблюдаемые формы + сгенерированные склонения (T3d). Возвращает
 * null, если подсвечивать нечего (пустой справочник/все формы короче порога).
 */
export function compileRegistryForms(
  entries: readonly EntityIndexEntry[],
): RegistryCompiled | null {
  const ulidsByForm = new Map<string, Set<string>>();
  const typeByForm = new Map<string, string>();
  for (const entry of entries) {
    const forms = new Set<string>([
      ...(entry.aliases ?? []),
      ...expandEntityForms(entry.canonical, entry.type, entry.forms),
    ]);
    for (const form of forms) {
      if (codePoints(form) < MIN_FORM_LENGTH) continue;
      if (/\n|\r/.test(form)) continue;
      const ulids = ulidsByForm.get(form) ?? new Set<string>();
      ulids.add(entry.ulid);
      ulidsByForm.set(form, ulids);
      if (!typeByForm.has(form)) typeByForm.set(form, entry.type);
    }
  }
  if (ulidsByForm.size === 0) return null;
  const byForm = new Map<string, string[]>();
  for (const [form, ulids] of ulidsByForm) byForm.set(form, [...ulids].sort());
  // longest-first: «Иванов И. И.» важнее «Иванов», совпадающего по позиции.
  // Флаг u обязателен: без него \p{L} — литерал «p{L}», границы слова молча
  // перестают работать (тест «Иван» ≠ «Иванович» это ловит).
  const alternatives = [...byForm.keys()].sort((a, b) => codePoints(b) - codePoints(a));
  const regex = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternatives.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`,
    "gu",
  );
  return {regex, byForm, typeByForm};
}

/** Найти вхождения форм справочника в тексте (координаты в этом тексте). */
export function matchRegistryForms(text: string, compiled: RegistryCompiled): RegistryMatch[] {
  const matches: RegistryMatch[] = [];
  compiled.regex.lastIndex = 0;
  for (;;) {
    const found = compiled.regex.exec(text);
    if (found == null) break;
    if (found[0] === "") {
      compiled.regex.lastIndex += 1; // защита от нулевого совпадения — цикл
      continue;
    }
    const value = found[0];
    const ulids = [...(compiled.byForm.get(value) ?? [])].sort();
    if (ulids.length === 0) continue;
    matches.push({
      start: found.index,
      end: found.index + value.length,
      value,
      ulids,
      type: compiled.typeByForm.get(value) ?? "",
      ambiguous: ulids.length > 1,
    });
  }
  return matches;
}

/** Кэш скомпилированных форм на каталог (пересборка — только при смене индекса). */
const compiledCache = new Map<string, RegistryCompiled | null>();

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getCompiled(dir: string): RegistryCompiled | null {
  return compiledCache.get(normalizeDir(dir)) ?? null;
}

/** Пересобрать кэш форм каталога (загрузка индекса / изменение файла). */
export function refreshRegistryCompiled(
  dir: string,
  entries: readonly EntityIndexEntry[],
): RegistryCompiled | null {
  const compiled = compileRegistryForms(entries);
  compiledCache.set(normalizeDir(dir), compiled);
  return compiled;
}

/** Тестовый хук: сброс кэша форм. */
export function resetRegistryCompiledCache(): void {
  compiledCache.clear();
}

/**
 * Непрерывные цепочки текстовых узлов без link-марок. Узлы цепочки идут
 * вплотную (nodePos.prev + len == nodePos.next) — их текст конкатенируется
 * в координатах контента блока; лист-нода (hardbreak и т.п.) рвёт цепочку.
 */
function collectTextRuns(block: PMNode): Array<{base: number; text: string}> {
  const runs: Array<{base: number; text: string}> = [];
  let current: {base: number; text: string} | null = null;
  block.descendants((node, pos) => {
    if (!node.isText) {
      current = null; // лист/не-текст рвёт непрерывность
      return true;
    }
    if (node.marks.some((mark) => mark.type.name === LINK_MARK_NAME)) {
      current = null;
      return true;
    }
    if (current != null && current.base + current.text.length === pos) {
      current.text += node.text ?? "";
    } else {
      current = {base: pos, text: node.text ?? ""};
      runs.push(current);
    }
    return true;
  });
  return runs;
}

/**
 * Декорации подсветки по вхождениям форм справочника (пересборка на правки —
 * дёшево, как у чипов). Выключено флагом uiStore → пусто.
 */
export function buildRegistryDecorations(
  doc: PMNode,
  compiled: RegistryCompiled | null,
): DecorationSet {
  if (compiled == null || !useUiStore.getState().registryHighlight) {
    return DecorationSet.empty;
  }
  const decos: Decoration[] = [];
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    if (block.type.name === "code_block") return false;
    for (const run of collectTextRuns(block)) {
      for (const match of matchRegistryForms(run.text, compiled)) {
        const from = blockPos + 1 + run.base + match.start;
        const to = blockPos + 1 + run.base + match.end;
        decos.push(
          Decoration.inline(from, to, {
            class: match.ambiguous
              ? "vas-registry-match vas-registry-ambiguous"
              : "vas-registry-match",
            "data-vas-registry-ulid": match.ulids[0] ?? "",
            "data-vas-registry-ulids": match.ulids.join(","),
            "data-vas-type": match.type,
          }),
        );
      }
    }
    return false;
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

const registryHighlightKey = new PluginKey<DecorationSet>("vasyavig-registry-highlight");

/**
 * Extension-фабрика для `wysiwygConfig.extensions`: dir — каталог вкладки
 * (идентификатор кэша форм и файла индекса). Перестройка: транзакции с
 * правками, meta-транзакции при смене флага/индекса.
 */
export function registryHighlightExtension(dir: string): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          key: registryHighlightKey,
          state: {
            init: (_, state) => buildRegistryDecorations(state.doc, getCompiled(dir)),
            apply(tr, old) {
              if (tr.docChanged || tr.getMeta(REBUILD_META)) {
                return buildRegistryDecorations(tr.doc, getCompiled(dir));
              }
              return old.map(tr.mapping, tr.doc);
            },
          },
          props: {
            decorations(state) {
              return registryHighlightKey.getState(state);
            },
          },
          view(editorView) {
            let destroyed = false;
            let indexPath: string | null = null;
            const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

            const rebuild = () => {
              if (!destroyed) {
                editorView.dispatch(editorView.state.tr.setMeta(REBUILD_META, true));
              }
            };
            const reload = () => {
              void ensureEntitiesIndex(dir).then((file) => {
                indexPath = norm(file.path);
                refreshRegistryCompiled(dir, file.entries);
                rebuild();
              });
            };

            reload(); // формы каталога при монтировании

            const unsubUi = useUiStore.subscribe((s, prev) => {
              if (s.registryHighlight !== prev.registryHighlight) rebuild();
            });
            const unsubIndex = subscribeEntitiesIndex((path) => {
              if (indexPath != null && norm(path) === indexPath) reload();
            });

            return {
              destroy() {
                destroyed = true;
                unsubUi();
                unsubIndex();
              },
            };
          },
        }),
    );
  };
}
