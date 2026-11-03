/**
 * Сущности `vas-entity:` в Markup-режиме (Phase 8.5, T3; план 20261105_001,
 * T3-7): CodeMirror-декорации на всю конструкцию `[текст](vas-entity:…)`
 * (паттерн `harnessUlidMarkupExtension`), регистрация CM-view для команд
 * обёртки выделения и снятия разметки. Смещения CodeMirror = raw markdown.
 */

import {RangeSetBuilder, type Extension as CM6Extension} from "@codemirror/state";
import {Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate} from "@codemirror/view";
import {parseEntityLinks} from "./agent/masking/vasEntityMarkup";
import {buildVasEntityHref, parseVasEntityHref} from "./agent/masking/vasEntityLink";
import type {EntityType} from "./agent/masking/types";

const cmViews = new Map<string, EditorView>();

export function registerVasEntityCmView(path: string, view: EditorView): void {
  cmViews.set(path, view);
}

export function unregisterVasEntityCmView(path: string): void {
  cmViews.delete(path);
}

function buildDecorations(state: {doc: {toString(): string}}, path: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const span of parseEntityLinks(state.doc.toString())) {
    builder.add(
      span.start,
      span.end,
      Decoration.mark({
        class: "vas-entity-link",
        attributes: {
          "data-vas-entity": span.ulid,
          "data-vas-type": span.type.toLowerCase(),
          "data-vas-entity-path": path,
        },
      }),
    );
  }
  return builder.finish();
}

/** Extension для `markupConfig.extensions`: path — файл вкладки. */
export function vasEntityMarkupExtension(path: string): CM6Extension[] {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view.state, path);
          registerVasEntityCmView(path, view);
        }

        update(update: ViewUpdate): void {
          if (update.docChanged) {
            this.decorations = buildDecorations(update.state, path);
          }
        }

        destroy(): void {
          unregisterVasEntityCmView(path);
        }
      },
      {decorations: (plugin) => plugin.decorations},
    ),
  ];
}

/**
 * Пометить текущее выделение Markup как сущность (D11). false — нет view,
 * пустое выделение или пересечение со ссылкой-сущностью/обычной ссылкой.
 */
export function markCmSelectionAsEntity(path: string, type: EntityType, ulid: string): boolean {
  const view = cmViews.get(path);
  if (!view) return false;
  const sel = view.state.selection.main;
  if (sel.empty) return false;
  const text = view.state.sliceDoc(sel.from, sel.to);
  if (text.includes("](") || text.includes("[")) return false; // вложенная ссылка
  for (const span of parseEntityLinks(view.state.doc.toString())) {
    if (sel.from < span.end && span.start < sel.to) return false; // пересечение с сущностью
  }
  view.dispatch({
    changes: {from: sel.from, to: sel.to, insert: `[${text}](${buildVasEntityHref(type, ulid)})`},
    selection: {anchor: sel.from},
    scrollIntoView: true,
  });
  return true;
}

/** Снять разметку с чипа в Markup по его DOM-элементу (поповер). */
export function unmarkCmEntityAtDom(path: string, el: HTMLElement): boolean {
  const view = cmViews.get(path);
  if (!view) return false;
  const ulid = el.getAttribute("data-vas-entity");
  const type = el.getAttribute("data-vas-type");
  if (!ulid || !type) return false;
  if (!parseVasEntityHref(buildVasEntityHref(type.toUpperCase() as EntityType, ulid))) return false;
  let pos: number;
  try {
    pos = view.posAtDOM(el);
  } catch {
    return false;
  }
  const span = parseEntityLinks(view.state.doc.toString()).find(
    (s) => pos >= s.start && pos <= s.end,
  );
  if (!span) return false;
  view.dispatch({changes: {from: span.start, to: span.end, insert: span.value}});
  return true;
}
