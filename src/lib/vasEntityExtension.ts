/**
 * Сущности `vas-entity:` в WYSIWYG (Phase 8.5, T3; план 20261105_001,
 * T3-6): декорации над link-марками с href `vas-entity:<type>:<ULID>`
 * (паттерн `harnessUlidExtension`), регистрация PM-view для команд разметки
 * (паттерн mermaid: публичный editor.insert() не годится для обёртки
 * выделения, урок §13). Декорации view-only (урок §12).
 */

import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet} from "prosemirror-view";
import type {Node as PMNode} from "prosemirror-model";
import type {EditorView as PMEditorView} from "prosemirror-view";
import type {Extension} from "@gravity-ui/markdown-editor";
import {buildVasEntityHref, parseVasEntityHref} from "./agent/masking/vasEntityLink";

const LINK_MARK_NAME = "link";

const pmViews = new Map<string, PMEditorView>();

export function registerVasEntityView(path: string, view: PMEditorView): void {
  pmViews.set(path, view);
}

export function unregisterVasEntityView(path: string): void {
  pmViews.delete(path);
}

/** Чип над каждым текстом ссылки-сущности (пересборка на правки — дёшево). */
function buildDecorations(doc: PMNode, path: string): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    if (block.type.name === "code_block") return false;
    block.descendants((node, nodePos) => {
      if (!node.isText) return true;
      const link = node.marks.find((mark) => mark.type.name === LINK_MARK_NAME);
      if (!link) return true;
      const parsed = parseVasEntityHref(String(link.attrs.href ?? ""));
      if (!parsed) return true;
      const from = blockPos + 1 + nodePos;
      decos.push(
        Decoration.inline(from, from + node.nodeSize, {
          class: "vas-entity-link",
          "data-vas-entity": parsed.ulid,
          "data-vas-type": parsed.type.toLowerCase(),
          "data-vas-entity-path": path,
        }),
      );
      return true;
    });
    return false;
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * Extension-фабрика для `wysiwygConfig.extensions`: path — файл вкладки
 * (идентификатор для команд и поповера).
 */
export function vasEntityExtension(path: string): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          key: new PluginKey("vasyavig-vas-entity"),
          state: {
            init: (_, state) => buildDecorations(state.doc, path),
            apply(tr, old) {
              if (tr.docChanged) return buildDecorations(tr.doc, path);
              return old.map(tr.mapping, tr.doc);
            },
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
          view(editorView) {
            registerVasEntityView(path, editorView);
            return {
              destroy() {
                unregisterVasEntityView(path);
              },
            };
          },
        }),
    );
  };
}

/**
 * Пометить текущее выделение WYSIWYG как сущность (D11). false — нет view,
 * пустое выделение или пересечение со ссылкой (вложенные ссылки невозможны).
 */
export function markPmSelectionAsEntity(path: string, type: string, ulid: string): boolean {
  const view = pmViews.get(path);
  if (!view) return false;
  const {from, to} = view.state.selection;
  if (to <= from) return false;
  let blocked = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.marks.some((mark) => mark.type.name === LINK_MARK_NAME)) blocked = true;
    return !blocked;
  });
  if (blocked) return false;
  const mark = view.state.schema.marks[LINK_MARK_NAME].create({
    href: buildVasEntityHref(type, ulid),
  });
  view.dispatch(view.state.tr.addMark(from, to, mark).scrollIntoView());
  return true;
}

/** Снять разметку с чипа в WYSIWYG по его DOM-элементу (поповер). */
export function unmarkPmEntityAtDom(path: string, el: HTMLElement): boolean {
  const view = pmViews.get(path);
  if (!view) return false;
  const ulid = el.getAttribute("data-vas-entity");
  const type = el.getAttribute("data-vas-type");
  if (!ulid || !type) return false;
  if (!parseVasEntityHref(buildVasEntityHref(type, ulid))) return false;
  try {
    const from = view.posAtDOM(el, 0);
    const to = view.posAtDOM(el, el.childNodes.length);
    view.dispatch(view.state.tr.removeMark(from, to, view.state.schema.marks[LINK_MARK_NAME]));
    return true;
  } catch {
    return false; // DOM и документ разошлись (перестроение)
  }
}

import {markCmSelectionAsEntity, unmarkCmEntityAtDom} from "./vasEntityMarkupExtension";
import {getEditor} from "./editorRegistry";

/**
 * Обёртка текущего выделения сущностью в активном режиме редактора (D11):
 * WYSIWYG — link-марка через PM-view, Markup — CM-транзакция (смещения raw).
 */
export function markSelectionAsEntity(path: string, type: string, ulid: string): boolean {
  const editor = getEditor(path);
  if (!editor) return false;
  editor.focus();
  return editor.currentMode === "markup"
    ? markCmSelectionAsEntity(path, type, ulid)
    : markPmSelectionAsEntity(path, type, ulid);
}

/** Снятие разметки по DOM-элементу чипа (поповер) в активном режиме. */
export function unmarkEntityAtDom(path: string, el: HTMLElement): boolean {
  const editor = getEditor(path);
  if (!editor) return false;
  return editor.currentMode === "markup"
    ? unmarkCmEntityAtDom(path, el)
    : unmarkPmEntityAtDom(path, el);
}
