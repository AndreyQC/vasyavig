import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet} from "prosemirror-view";
import type {Node as PMNode} from "prosemirror-model";
import type {Extension} from "@gravity-ui/markdown-editor";
import {findUlidMatches} from "./harnessEnvelope";
import {openUlidTarget, useHarnessStore} from "../store/harnessStore";
import {getParentDir} from "./utils";
import i18n from "./i18n";

const REBUILD_META = "vasyavig-harness-ulid-rebuild";

const harnessUlidKey = new PluginKey<DecorationSet>("vasyavig-harness-ulid");

/**
 * Декорации ULID-штампов в WYSIWYG (task 20261025_001, план D7): правдоподобные
 * ULID в текстовых блоках подчёркиваются — известные реестру как ссылки
 * (клик -> открыть документ), неизвестные тихой пунктирной подсветкой.
 * Декорации view-only: документ и сериализация не затрагиваются (урок §12 —
 * «наши» DOM-записи вне contentDOM PM не интересуют, здесь и того меньше).
 */
export function buildUlidDecorations(doc: PMNode, dir: string): DecorationSet {
  const {resolveFor} = useHarnessStore.getState();
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    for (const match of findUlidMatches(text)) {
      // pos — позиция перед textblock'ом, текст начинается с pos + 1 (как spellcheck)
      const from = pos + 1 + match.start;
      const to = pos + 1 + match.end;
      if (from < to && to <= doc.content.size) {
        const res = resolveFor(dir, match.ulid);
        if (res.status === "found") {
          const meta = [res.entry.title ?? res.entry.path, res.entry.type]
            .filter(Boolean)
            .join(" · ");
          decos.push(
            Decoration.inline(from, to, {
              class: "ulid-link",
              "data-ulid": match.ulid,
              title: meta,
            }),
          );
        } else {
          decos.push(
            Decoration.inline(from, to, {
              class: "ulid-unknown",
              title: i18n.t("harness.ulidUnknownTooltip"),
            }),
          );
        }
      }
    }
    return true;
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
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
            handleClick(_view, _pos, event) {
              const target = event.target as HTMLElement | null;
              const link = target?.closest?.(".ulid-link[data-ulid]") as HTMLElement | null;
              if (!link) return false;
              const ulid = link.getAttribute("data-ulid");
              if (ulid) void openUlidTarget(dir, ulid);
              return true; // переход по ссылке — каретку не двигаем
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
