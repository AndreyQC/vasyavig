import {Plugin, PluginKey, TextSelection} from "prosemirror-state";
import type {Extension} from "@gravity-ui/markdown-editor";
import {matchAnchor} from "./anchorMatcher";

/**
 * Клик по якорной ссылке (#...) в WYSIWYG скроллит к соответствующему
 * заголовку. У ProseMirror-документа нет id у заголовков, поэтому навигация
 * браузера не работает — сопоставляем якорь сами (anchorMatcher: github-слаг,
 * транслит, custom-id) и прокручиваем редактор.
 */
export function anchorNavigationExtension(): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          key: new PluginKey("vasyavig-anchor-navigation"),
          props: {
            handleClick(view, _pos, event) {
              const target = event.target as HTMLElement | null;
              const anchorEl = target?.closest?.("a[href]");
              if (!anchorEl) return false;
              const href = anchorEl.getAttribute("href") ?? "";
              if (!href.startsWith("#") || href.length <= 1) return false;

              const headings: string[] = [];
              view.state.doc.descendants((node) => {
                if (node.type.name === "heading") headings.push(node.textContent);
                return true;
              });
              const idx = matchAnchor(headings, href.slice(1));
              if (idx === null) return false;

              let headingPos = -1;
              let seen = -1;
              view.state.doc.descendants((node, pos) => {
                if (node.type.name !== "heading") return true;
                seen++;
                if (seen === idx) {
                  headingPos = pos;
                  return false;
                }
                return true;
              });
              if (headingPos < 0) return false;

              event.preventDefault();
              const dom = view.nodeDOM(headingPos);
              if (dom instanceof HTMLElement) {
                dom.scrollIntoView({behavior: "smooth", block: "start"});
              }
              // курсор к заголовку — чтобы правки после перехода шли туда
              const $pos = view.state.doc.resolve(headingPos + 1);
              view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
              return true;
            },
          },
        }),
    );
  };
}
