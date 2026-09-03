// @vitest-environment jsdom
// Санити-проверка механизма: nodeViews из props PM-плагина применяются к ноде image
// в чистом EditorView (без Gravity). Если падает — проблема в самом подходе.
import {describe, expect, it} from "vitest";
import {EditorState, Plugin, PluginKey} from "prosemirror-state";
import {Schema} from "prosemirror-model";
import {EditorView} from "prosemirror-view";

describe("sanity: plugin nodeViews в чистом prosemirror-view", () => {
  it("image-нода рендерится через nodeView из плагина", () => {
    const schema = new Schema({
      nodes: {
        doc: {content: "inline*"},
        text: {group: "inline"},
        image: {
          inline: true,
          attrs: {src: {}},
          group: "inline",
          toDOM: (n) => ["img", n.attrs],
        },
      },
    });
    let nodeViewUsed = false;
    const plugin = new Plugin({
      key: new PluginKey("test-image"),
      props: {
        nodeViews: {
          image: (node: {attrs: Record<string, unknown>}) => {
            nodeViewUsed = true;
            const dom = document.createElement("img");
            dom.setAttribute("src", `rewritten:${node.attrs.src}`);
            return {dom};
          },
        },
      },
    });
    const doc = schema.node("doc", null, [
      schema.text("до "),
      schema.node("image", {src: "raw.png"}),
      schema.text(" после"),
    ]);
    const view = new EditorView(document.createElement("div"), {
      state: EditorState.create({doc, plugins: [plugin]}),
    });
    const img = view.dom.querySelector("img");
    expect(img?.getAttribute("src")).toBe("rewritten:raw.png");
    expect(nodeViewUsed).toBe(true);
  });
});
