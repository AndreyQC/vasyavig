import {Plugin, PluginKey} from "prosemirror-state";
import type {Node as PMNode} from "prosemirror-model";
import type {NodeView} from "prosemirror-view";
import type {Extension} from "@gravity-ui/markdown-editor";
import {resolveImageDisplayUrl} from "./resolveImageSrc";

/**
 * Отображение локальных картинок в WYSIWYG (phase 5).
 *
 * NodeView перехватывает рендер image-ноды (дефолтный toDOM — ['img', attrs])
 * и подставляет asset-URL в src для показа. Атрибуты документа не меняются:
 * сериализация идёт из сырого src, вкладка не становится dirty (идея
 * src/renderSrc из gramax). НЕ через normalizeLink — он кругооборотит в
 * сохраняемый markup (урок phase 4).
 *
 * baseDir фиксируется на файл (редактор создаётся per-file, deps [path]);
 * rootPath читается лениво — папка может быть открыта после файла.
 */
export function imageSrcExtension(baseDir: string, getRootPath: () => string | null): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          key: new PluginKey("vasyavig-image-src"),
          props: {
            nodeViews: {
              image(node: PMNode): NodeView {
                const dom = document.createElement("img");
                const sync = (n: PMNode) => {
                  for (const attr of ["alt", "title", "loading"] as const) {
                    const value = n.attrs[attr];
                    if (value != null && value !== "") dom.setAttribute(attr, String(value));
                    else dom.removeAttribute(attr);
                  }
                  const raw = String(n.attrs.src ?? "");
                  dom.setAttribute("src", resolveImageDisplayUrl(raw, baseDir, getRootPath()) ?? raw);
                };
                sync(node);
                return {
                  dom,
                  update(n) {
                    if (n.type.name !== "image") return false;
                    sync(n);
                    return true;
                  },
                  // рендер полностью под нашим контролем; DOM-мутации (браузер
                  // перезаписал атрибуты) не должны трактоваться как правки
                  ignoreMutation: () => true,
                };
              },
            },
          },
        }),
    );
  };
}
