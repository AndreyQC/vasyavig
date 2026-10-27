import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet} from "prosemirror-view";
import type {Node as PMNode} from "prosemirror-model";
import type {Extension} from "@gravity-ui/markdown-editor";
import {findUlidMatches} from "./harnessEnvelope";
import {openUlidTarget, useHarnessStore} from "../store/harnessStore";
import {parseUlidHref} from "./harnessUlidLink";
import {getParentDir} from "./utils";
import i18n from "./i18n";

const REBUILD_META = "vasyavig-harness-ulid-rebuild";

const harnessUlidKey = new PluginKey<DecorationSet>("vasyavig-harness-ulid");

/** Имя mark-ноды ссылки в схеме Gravity (`LinkSpecs`). */
const LINK_MARK_NAME = "link";

/**
 * Одна ULID-декорация: ссылка `[имя](harness-ulid:…)` (task 20261027_002, формат C)
 * или голый ULID в тексте (D7). Известные реестру — `ulid-link` с `data-ulid`,
 * неизвестные — `ulid-unknown`. Декорации view-only (урок §12).
 */
function pushUlidDecoration(
  decos: Decoration[],
  dir: string,
  from: number,
  to: number,
  ulid: string,
  anchor?: string,
): void {
  if (to <= from) return;
  const res = useHarnessStore.getState().resolveFor(dir, ulid);
  const attrs: Record<string, string> = {
    class: res.status === "found" ? "ulid-link" : "ulid-unknown",
    "data-ulid-dir": dir,
  };
  if (res.status === "found") {
    attrs["data-ulid"] = ulid;
    attrs["aria-label"] = [res.entry.title ?? res.entry.path, res.entry.type]
      .filter(Boolean)
      .join(" · ");
  } else {
    attrs["data-ulid-unknown"] = ulid;
    attrs["aria-label"] = i18n.t("harness.ulidUnknownTooltip");
  }
  if (anchor) attrs["data-anchor"] = anchor;
  decos.push(Decoration.inline(from, to, attrs));
}

/**
 * Декорации ULID в WYSIWYG (D7 + формат C): ссылки с `href="harness-ulid:…"`
 * подсвечиваются целиком, сырые ULID в тексте — по совпадению. Внутри
 * обычных ссылок и код-блоков ULID не трогаем; внутри инлайн-кода закладки
 * (`ULID` в бэктиках) — оставляем кликабельным.
 */
export function buildUlidDecorations(doc: PMNode, dir: string): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    if (block.type.name === "code_block") return false;
    block.descendants((node, nodePos) => {
      if (!node.isText || !node.text) return true;
      const from = blockPos + 1 + nodePos;
      const link = node.marks.find((mark) => mark.type.name === LINK_MARK_NAME);
      if (link) {
        // обычная ссылка — текст не трогаем (никаких вложенных ссылок)
        const parsed = parseUlidHref(String(link.attrs.href ?? ""));
        if (parsed) {
          pushUlidDecoration(decos, dir, from, from + node.nodeSize, parsed.ulid, parsed.anchor);
        }
        return true;
      }
      for (const match of findUlidMatches(node.text)) {
        pushUlidDecoration(decos, dir, from + match.start, from + match.end, match.ulid);
      }
      return true;
    });
    return false;
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/** Элемент ULID-ссылки/штампа под курсором (декорация или `<a href="harness-ulid:…">`). */
function ulidElementFromEvent(event: Event): HTMLElement | null {
  const target = event.target as HTMLElement | null;
  return (target?.closest?.(
    "a[href^='harness-ulid:'], a[href^='harness_ulid:'], a[href^='ulid:'], [data-ulid], [data-ulid-unknown]",
  ) as HTMLElement | null) ?? null;
}

/**
 * Extension-фабрика: path — файл вкладки (каталог = база резолва ULID по
 * реестру ближайшего harness-репозитория).
 */
export function harnessUlidExtension(path: string): Extension {
  const dir = getParentDir(path);
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          key: harnessUlidKey,
          state: {
            init: (_, state) => buildUlidDecorations(state.doc, dir),
            apply(tr, old) {
              // правка документа или загрузка/сброс реестра — полная пересборка
              // (regex-скан textblock'ов дёшев, debounce не нужен)
              if (tr.docChanged || tr.getMeta(REBUILD_META)) {
                return buildUlidDecorations(tr.doc, dir);
              }
              return old.map(tr.mapping, tr.doc);
            },
          },
          props: {
            decorations(state) {
              return harnessUlidKey.getState(state);
            },
            handleDOMEvents: {
              // `<a href="harness-ulid:…">` в WYSIWYG иначе уводит WebView на неизвестную схему
              click(_view, event) {
                const el = ulidElementFromEvent(event);
                if (!el) return false;
                event.preventDefault();
                const parsed = parseUlidHref(el.getAttribute("href"));
                const ulid =
                  el.getAttribute("data-ulid") ??
                  el.getAttribute("data-ulid-unknown") ??
                  parsed?.ulid;
                if (!ulid) return false;
                const anchor = el.getAttribute("data-anchor") ?? parsed?.anchor ?? undefined;
                void openUlidTarget(dir, ulid, anchor);
                return true;
              },
            },
          },
          view(editorView) {
            // реестр загрузился/сбросился после инициализации — перестроить декорации
            const unsubscribe = useHarnessStore.subscribe((s, prev) => {
              if (s.version !== prev.version) {
                editorView.dispatch(editorView.state.tr.setMeta(REBUILD_META, true));
              }
            });
            return {
              destroy() {
                unsubscribe();
              },
            };
          },
        }),
    );
  };
}
