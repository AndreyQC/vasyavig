import {Plugin, PluginKey, TextSelection} from "prosemirror-state";
import type {Node as PMNode} from "prosemirror-model";
import type {NodeView, EditorView, ViewMutationRecord} from "prosemirror-view";
import type {Extension} from "@gravity-ui/markdown-editor";
import {onMermaidThemeChange, renderMermaidDiagram} from "./mermaidRenderer";
import {useUiStore} from "../store/uiStore";

/**
 * Mermaid-диаграммы в WYSIWYG (design D2): nodeView на code_block с языком
 * mermaid — SVG-карточка вместо кода; прочие языки — реплика минимального
 * CodeBlockNodeView гравитас (он @internal и не экспортируется; подсветка
 * живёт в lowlight-декорациях и в наш contentDOM попадает независимо).
 *
 * Сериализация не меняется: фенс остаётся фенсом, текст диаграммы — это
 * содержимое ноды; показ диаграммы не делает документ dirty (спека).
 */

/** codeBlockNodeName из @gravity-ui/markdown-editor (пакетом не экспортируется). */
const CODE_BLOCK_NODE_NAME = "code_block";
/** CodeBlockNodeAttr.Lang из @gravity-ui/markdown-editor (не экспортируется). */
const LANG_ATTR = "data-language";
const MERMAID_LANG = "mermaid";

/**
 * Живые PM-view по пути вкладки: кнопка «Диаграмма» должна знать выделение,
 * а публичный API редактора (insert/moveCursor) его не отдаёт.
 */
const viewRegistry = new Map<string, EditorView>();

export function registerMermaidView(path: string, view: EditorView): void {
  viewRegistry.set(path, view);
}

export function unregisterMermaidView(path: string): void {
  viewRegistry.delete(path);
}

/** PM-view вкладки или null (редактор размонтирован / не в WYSIWYG). */
export function getMermaidView(path: string): EditorView | null {
  return viewRegistry.get(path) ?? null;
}

/**
 * Точная вставка mermaid-блока в WYSIWYG: публичный editor.insert() разворачивает
 * одиночный текст-блок фенса в текущий абзац (открытый slice), editor.append()
 * всегда пишет в конец — поэтому строим ноду сами. Курсор внутри кода
 * обрабатывается выбором позиции после блока.
 */
export function insertMermaidBlock(view: EditorView, source: string): boolean {
  if (view.isDestroyed) return false;
  const {schema, tr} = view.state;
  const codeBlock = schema.nodes[CODE_BLOCK_NODE_NAME];
  const paragraph = schema.nodes["paragraph"];
  if (!codeBlock || !paragraph) return false;

  // блок верхнего уровня, содержащий курсор: before(1)/node(1) дают позицию
  // блока в документе (pos - parentOffset — это КОНТЕНТ блока, off-by-one)
  const {$from} = view.state.selection;
  const topLevel = $from.node(1);
  const topStart = $from.before(1);
  const node = codeBlock.create({[LANG_ATTR]: MERMAID_LANG}, schema.text(source));
  const after = paragraph.create();

  let newTr = tr;
  if (topLevel.childCount === 0 && topLevel.type === paragraph) {
    // пустой абзац заменяется блоком (не оставляем дырку над диаграммой)
    newTr = tr.replaceWith(topStart, topStart + topLevel.nodeSize, [node, after]);
  } else {
    newTr = tr.insert(topStart + topLevel.nodeSize, [node, after]);
  }
  const caretPos = Math.min(newTr.doc.content.size, topStart + node.nodeSize + 1);
  newTr.setSelection(TextSelection.near(newTr.doc.resolve(caretPos), 1));
  view.dispatch(newTr.scrollIntoView());
  return true;
}

export function isMermaidCodeBlock(node: PMNode): boolean {
  return node.type.name === CODE_BLOCK_NODE_NAME && String(node.attrs[LANG_ATTR] ?? "") === MERMAID_LANG;
}

/* ---------- DOM-билдеры (чистые, для sanity-теста) ---------- */

export interface CodeBlockDom {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  codeEl: HTMLElement;
}

/** Структура штатного CodeBlockNodeView: pre[data-language] > code.hljs.lang > contentDIV. */
export function buildCodeBlockDom(lang: string): CodeBlockDom {
  const dom = document.createElement("pre");
  const codeEl = document.createElement("code");
  const contentDOM = document.createElement("div");
  codeEl.className = `hljs${lang ? ` ${lang}` : ""}`;
  if (lang) dom.setAttribute(LANG_ATTR, lang);
  codeEl.appendChild(contentDOM);
  dom.appendChild(codeEl);
  return {dom, contentDOM, codeEl};
}

export interface MermaidDom extends CodeBlockDom {
  wrapper: HTMLElement;
  card: HTMLElement;
  errorBanner: HTMLElement;
}

/**
 * Обёртка диаграммы: карточка (SVG/skeleton) + прятаемый код-блок с
 * contentDOM. contentDOM существует всегда — в режиме диаграммы он скрыт
 * (display:none), чтобы prosemirror продолжал владеть текстом ноды.
 */
export function buildMermaidDom(): MermaidDom {
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-node mermaid-node--loading";
  const card = document.createElement("div");
  card.className = "mermaid-node__card";
  card.contentEditable = "false";
  const errorBanner = document.createElement("div");
  errorBanner.className = "mermaid-node__error";
  const code = buildCodeBlockDom(MERMAID_LANG);
  code.dom.classList.add("mermaid-node__code");
  wrapper.append(card, errorBanner, code.dom);
  return {wrapper, card, errorBanner, dom: wrapper, contentDOM: code.contentDOM, codeEl: code.codeEl};
}

/* ---------- nodeViews ---------- */

/** Реплика CodeBlockNodeView для не-mermaid языков (см. модульный комментарий). */
class FallbackCodeNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private codeEl: HTMLElement;
  private lang: string;

  constructor(node: PMNode) {
    this.lang = String(node.attrs[LANG_ATTR] ?? "");
    const built = buildCodeBlockDom(this.lang);
    this.dom = built.dom;
    this.contentDOM = built.contentDOM;
    this.codeEl = built.codeEl;
  }

  update = (node: PMNode): boolean => {
    if (node.type.name !== CODE_BLOCK_NODE_NAME) return false;
    // смена языка на mermaid — пересоздание view (PM сам вызовет фабрику)
    if (String(node.attrs[LANG_ATTR] ?? "") === MERMAID_LANG) return false;
    const lang = String(node.attrs[LANG_ATTR] ?? "");
    if (lang !== this.lang) {
      this.lang = lang;
      this.codeEl.className = `hljs${lang ? ` ${lang}` : ""}`;
      if (lang) this.dom.setAttribute(LANG_ATTR, lang);
      else this.dom.removeAttribute(LANG_ATTR);
    }
    return true;
  };

  // наши записи в dom (класс языка) — не «внешние правки»; пользовательский
  // ввод внутри contentDOM читает PM (урок phase 5: imageSrcExtension)
  ignoreMutation = (mutation: ViewMutationRecord): boolean => !this.contentDOM.contains(mutation.target);
}

/** SVG-карточка диаграммы; редактирование — двойной клик (модалка, design D3). */
class MermaidNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private ownerPath: string;
  private built: MermaidDom;
  private renderedSource: string | null = null;
  private renderToken = 0;
  private unsubscribeTheme: () => void;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ownerPath: string) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ownerPath = ownerPath;
    this.built = buildMermaidDom();
    this.dom = this.built.wrapper;
    this.contentDOM = this.built.contentDOM;
    this.dom.addEventListener("dblclick", this.onDblClick);
    this.unsubscribeTheme = onMermaidThemeChange(() => void this.render());
    void this.render();
  }

  update = (node: PMNode): boolean => {
    if (node.type.name !== CODE_BLOCK_NODE_NAME) return false;
    if (String(node.attrs[LANG_ATTR] ?? "") !== MERMAID_LANG) return false; // пересоздание → fallback
    this.node = node;
    if (node.textContent !== this.renderedSource) void this.render();
    return true;
  };

  // инъекция SVG/классов — наши DOM-записи: без этого PM считает их внешними
  // правками и пересоздаёт view в бесконечном цикле (дрожание, см. lesson §10
  // и ignoreMutation в imageSrcExtension). Ввод внутри contentDOM — не наш.
  ignoreMutation = (mutation: ViewMutationRecord): boolean => !this.contentDOM.contains(mutation.target);

  destroy = () => {
    this.unsubscribeTheme();
    this.dom.removeEventListener("dblclick", this.onDblClick);
    this.renderToken++; // гонки рендера после destroy игнорируются
  };

  private onDblClick = (e: MouseEvent) => {
    e.preventDefault();
    useUiStore.getState().setPendingMermaidEdit({
      source: this.node.textContent,
      ownerPath: this.ownerPath,
      apply: (next) => this.applySource(next),
    });
  };

  private async render() {
    const source = this.node.textContent;
    const token = ++this.renderToken;
    this.renderedSource = source;
    this.built.wrapper.className = "mermaid-node mermaid-node--loading";
    const result = await renderMermaidDiagram(source);
    if (token !== this.renderToken || this.view.isDestroyed) return;
    if ("svg" in result) {
      this.built.card.innerHTML = result.svg; // вывод mermaid (securityLevel strict), не пользовательский HTML
      this.built.errorBanner.textContent = "";
      this.built.wrapper.className = "mermaid-node mermaid-node--diagram";
    } else {
      this.built.card.innerHTML = "";
      this.built.errorBanner.textContent = result.error;
      this.built.wrapper.className = "mermaid-node mermaid-node--error";
    }
  }

  /** Перенос правки из модалки в документ: обычная транзакция (undo/dirty работают). */
  private applySource(next: string) {
    if (this.view.isDestroyed) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    const {schema, tr} = this.view.state;
    const newNode = this.node.type.create(this.node.attrs, schema.text(next));
    const newTr = tr.replaceWith(pos, pos + this.node.nodeSize, newNode);
    newTr.setSelection(TextSelection.near(newTr.doc.resolve(pos + newNode.nodeSize)));
    this.view.dispatch(newTr);
  }
}

/** Фабрика nodeViews для code_block (экспортирована для sanity-теста). */
export function mermaidNodeViews(
  ownerPath: string,
): Record<string, (node: PMNode, view: EditorView, getPos: () => number | undefined) => NodeView> {
  return {
    [CODE_BLOCK_NODE_NAME]: (node, view, getPos) =>
      isMermaidCodeBlock(node)
        ? new MermaidNodeView(node, view, getPos, ownerPath)
        : new FallbackCodeNodeView(node),
  };
}

/** Расширение: nodeView на code_block (Priority.Highest — урок §10). */
export function mermaidWysiwygExtension(ownerPath: string): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          key: new PluginKey("vasyavig-mermaid-wysiwyg"),
          view(view) {
            registerMermaidView(ownerPath, view);
            return {
              destroy() {
                unregisterMermaidView(ownerPath);
              },
            };
          },
          props: {
            nodeViews: mermaidNodeViews(ownerPath),
          },
        }),
      builder.Priority.Highest,
    );
  };
}
