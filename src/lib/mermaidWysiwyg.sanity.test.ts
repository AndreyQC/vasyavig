// @vitest-environment jsdom
// Санити nodeView-механизма mermaid (паттерн pluginNodeViews.sanity.test.ts):
// чистый EditorView без Gravity. Рендерер замокан — проверяем структуру DOM
// и переключение view при смене языка, а не сам mermaid.
import {afterEach, describe, expect, it, vi} from "vitest";
import {EditorState, Plugin, PluginKey, TextSelection} from "prosemirror-state";
import {Schema, Node as PMNode} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import type {NodeView} from "prosemirror-view";

vi.mock("./mermaidRenderer", () => ({
  renderMermaidDiagram: vi.fn(async () => ({svg: "<svg>ok</svg>"})),
  onMermaidThemeChange: vi.fn(() => () => {}),
}));

const {mermaidNodeViews, insertMermaidBlock} = await import("./mermaidWysiwygExtension");

const schema = new Schema({
  nodes: {
    doc: {content: "block+"},
    text: {group: "inline"},
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
    },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: {"data-language": {default: ""}},
      toDOM: () => ["pre", 0],
    },
  },
});

const views: EditorView[] = [];

function makeView(lang: string, text: string): EditorView {
  const plugin = new Plugin({
    key: new PluginKey("sanity-mermaid"),
    props: {nodeViews: mermaidNodeViews("/doc.md")},
  });
  const node = schema.node("code_block", {"data-language": lang}, text ? schema.text(text) : undefined);
  const doc = schema.node("doc", null, [node]);
  const view = new EditorView(document.createElement("div"), {state: EditorState.create({doc, plugins: [plugin]})});
  views.push(view);
  return view;
}

function firstBlock(view: EditorView): PMNode {
  let node: PMNode | undefined;
  view.state.doc.forEach((n) => {
    if (!node) node = n;
  });
  return node!;
}

/** nodeView классы хранят update стрелкой — достаём через объект. */
function asUpdatable(view: NodeView): {update?: (n: PMNode) => boolean} {
  return view as unknown as {update?: (n: PMNode) => boolean};
}

afterEach(() => {
  for (const v of views) v.destroy();
  views.length = 0;
});

describe("sanity: mermaid nodeViews в чистом prosemirror-view", () => {
  it("mermaid-блок: обёртка .mermaid-node с contentDOM и код-блоком внутри", () => {
    const view = makeView("mermaid", "graph TD; A-->B");
    const wrapper = view.dom.querySelector(".mermaid-node");
    expect(wrapper).not.toBeNull();
    // скрытый носитель текста ноды: pre > code.hljs.mermaid > div(contentDOM)
    expect(wrapper?.querySelector("pre > code.hljs.mermaid > div")).not.toBeNull();
  });

  it("обычный блок: структура штатного CodeBlockNodeView (pre>code.hljs>div), без обёртки mermaid", () => {
    const view = makeView("javascript", "const a = 1;");
    const pre = view.dom.querySelector("pre[data-language='javascript']");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code.hljs.javascript > div")).not.toBeNull();
    expect(view.dom.querySelector(".mermaid-node")).toBeNull();
  });

  it("fallback view не принимает ноду, сменившую язык на mermaid (пересоздание)", () => {
    const view = makeView("javascript", "const a = 1;");
    const jsNode = firstBlock(view);
    const nodeView = asUpdatable(mermaidNodeViews("/doc.md")["code_block"]!(jsNode, view, () => 0));
    const mermaidNode = jsNode.type.create({"data-language": "mermaid"}, schema.text("graph TD; A-->B"));
    expect(nodeView.update?.(mermaidNode)).toBe(false);
  });

  it("fallback view обновляется при смене обычного языка (класс code меняется)", () => {
    const view = makeView("javascript", "const a = 1;");
    const jsNode = firstBlock(view);
    const nodeView = mermaidNodeViews("/doc.md")["code_block"]!(jsNode, view, () => 0);
    const pyNode = jsNode.type.create({"data-language": "python"}, schema.text("x = 1"));
    expect(asUpdatable(nodeView).update?.(pyNode)).toBe(true);
    expect(nodeView.dom.querySelector("code.hljs.python")).not.toBeNull();
  });

  it("ignoreMutation: свои DOM-записи игнорируются, ввод в contentDOM — нет (урок дрожания)", async () => {
    const view = makeView("mermaid", "graph TD; A-->B");
    const nodeView = mermaidNodeViews("/doc.md")["code_block"]!(firstBlock(view), view, () => 0);
    const card = nodeView.dom.querySelector(".mermaid-node__card")!;
    const contentDOM = nodeView.contentDOM!;

    // ждём замоканный рендер, чтобы card наполнился (SVG)
    await vi.waitFor(() => {
      expect(card.innerHTML).not.toBe("");
    });

    const ignore = (
      nodeView as unknown as {ignoreMutation?: (m: MutationRecord) => boolean}
    ).ignoreMutation;
    expect(ignore).toBeTypeOf("function");
    // наши записи (SVG в card, классы обёртки) — PM игнорирует
    expect(ignore!({target: card} as unknown as MutationRecord)).toBe(true);
    expect(ignore!({target: card.firstChild!} as unknown as MutationRecord)).toBe(true);
    // пользовательский ввод внутри contentDOM читает PM
    expect(ignore!({target: contentDOM} as unknown as MutationRecord)).toBe(false);
    expect(
      ignore!({target: contentDOM.firstChild ?? contentDOM} as unknown as MutationRecord),
    ).toBe(false);
  });

  it("insertMermaidBlock: пустой абзац заменяется mermaid-блоком + абзацем, курсор вне кода", () => {
    const view = new EditorView(document.createElement("div"), {
      state: EditorState.create({
        doc: schema.node("doc", null, [schema.node("paragraph", null)]),
        plugins: [],
      }),
    });
    views.push(view);

    expect(insertMermaidBlock(view, "graph TD;\n    A --> B;")).toBe(true);

    const blocks = view.state.doc.content.content;
    expect(blocks[0].type.name).toBe("code_block");
    expect(blocks[0].attrs["data-language"]).toBe("mermaid");
    expect(blocks[0].textContent).toBe("graph TD;\n    A --> B;");
    expect(blocks[1].type.name).toBe("paragraph");
    expect(blocks).toHaveLength(2);
    expect(view.state.selection.$from.parent.type.spec.code).toBeFalsy();
  });

  it("insertMermaidBlock: блок вставляется после абзаца с текстом и внутрь кода не пишет", () => {
    const view = new EditorView(document.createElement("div"), {
      state: EditorState.create({
        doc: schema.node("doc", null, [
          schema.node("paragraph", null, schema.text("текст")),
          schema.node("code_block", {"data-language": "javascript"}, schema.text("const a = 1;")),
        ]),
        plugins: [],
      }),
    });
    views.push(view);
    // курсор внутрь js-кода (абзац «текст» занимает 0..7, контент кода с 8)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)));

    expect(insertMermaidBlock(view, "graph TD;")).toBe(true);

    const names = view.state.doc.content.content.map((n) => n.type.name);
    expect(names).toEqual(["paragraph", "code_block", "code_block", "paragraph"]);
    const mermaidBlocks = view.state.doc.content.content.filter(
      (n) => n.type.name === "code_block" && n.attrs["data-language"] === "mermaid",
    );
    expect(mermaidBlocks).toHaveLength(1);
    expect(mermaidBlocks[0].textContent).toBe("graph TD;");
    // исходный js-блок не тронут и остался первым из код-блоков
    expect(view.state.doc.content.content[1].textContent).toBe("const a = 1;");
  });
});
