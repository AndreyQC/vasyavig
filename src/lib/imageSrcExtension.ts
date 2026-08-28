import {Plugin, PluginKey} from "prosemirror-state";
import type {Node as PMNode} from "prosemirror-model";
import type {NodeView} from "prosemirror-view";
import type {Extension} from "@gravity-ui/markdown-editor";
import {resolveImageDisplayUrl} from "./resolveImageSrc";

/**
 * Отображение локальных картинок в WYSIWYG (phase 5).
 *
 * 1. NodeView перехватывает рендер image-ноды (дефолтный toDOM — ['img', attrs])
 *    и подставляет asset-URL в src для показа. Атрибуты документа не меняются:
 *    сериализация идёт из сырого src, вкладка не становится dirty (идея
 *    src/renderSrc из gramax). НЕ через normalizeLink — он кругооборотит в
 *    сохраняемый markup (урок phase 4).
 *
 * 2. Переопределение сериализатора: штатный пишет dest через state.esc()
 *    (`\_`-экранирование) и голым текстом — путь с пробелами/скобками
 *    ломается при переключении WYSIWYG -> Markup и сохранении. Наш вариант
 *    оборачивает такие dest в <...> (как format_url в anydoc) и экранирует
 *    только действительно опасные для dest символы.
 *
 * baseDir фиксируется на файл (редактор создаётся per-file, deps [path]);
 * rootPath читается лениво — папка может быть открыта после файла.
 */

/** imageNodeName из @gravity-ui/markdown-editor (пакетом не экспортируется). */
const IMAGE_NODE_NAME = "image";

/** Экранирование символов, ломающих markdown-destination. */
function escapeDest(src: string): string {
  return src.replace(/[\\<>]/g, "\\$&");
}

/** Title-обёртка как state.quote() сериализатора Gravity (в d.ts не экспортирован). */
function quoteTitle(title: string): string {
  const wrap = !title.includes('"') ? '""' : !title.includes("'") ? "''" : "()";
  return wrap[0] + title + wrap[1];
}

export function imageSrcExtension(baseDir: string, getRootPath: () => string | null): Extension {
  return (builder) => {
    builder.overrideNodeSerializerSpec(
      IMAGE_NODE_NAME,
      () =>
        (state, node) => {
          const {attrs} = node;
          let result = "![";
          if (attrs.alt) result += state.esc(attrs.alt);
          result += "](";
          if (attrs.src) {
            const src = String(attrs.src);
            result += /[()\s]/.test(src) ? `<${escapeDest(src)}>` : escapeDest(src);
          }
          if (attrs.title) result += ` ${quoteTitle(String(attrs.title))}`;
          result += ")";
          state.write(result);
        },
    );
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
