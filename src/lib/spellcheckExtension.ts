import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, type EditorView} from "prosemirror-view";
import type {Node as PMNode} from "prosemirror-model";
import type {Extension} from "@gravity-ui/markdown-editor";
import {invoke} from "@tauri-apps/api/core";
import {useSpellStore, type BlockErrors, type MisspelledWord} from "../store/spellStore";

const DEBOUNCE_MS = 500;
const REBUILD_META = "vasyavig-spellcheck-rebuild";

const spellcheckKey = new PluginKey<DecorationSet>("vasyavig-spellcheck");

async function invokeCheck(texts: string[], lang: string): Promise<MisspelledWord[][]> {
  return invoke<MisspelledWord[][]>("check_spelling_blocks", {texts, lang});
}

/** Собирает textblock'и документа: позиция + текст. */
function extractBlocks(doc: PMNode): {pos: number; text: string}[] {
  const blocks: {pos: number; text: string}[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      blocks.push({pos, text: node.textContent});
    }
    return true;
  });
  return blocks;
}

/** Строит декорации из результатов проверки в spellStore. */
function buildDecorations(doc: PMNode): DecorationSet {
  const {enabled, blocks} = useSpellStore.getState();
  if (!enabled) return DecorationSet.empty;

  const decos: Decoration[] = [];
  for (const block of blocks) {
    for (const err of block.errors) {
      // pos — позиция перед textblock'ом, текст начинается с pos + 1
      const from = block.pos + 1 + err.start;
      const to = block.pos + 1 + err.end;
      if (from < to && to <= doc.content.size) {
        decos.push(
          Decoration.inline(from, to, {
            class: "spell-error",
            title: `Возможно, опечатка: ${err.word}`,
          }),
        );
      }
    }
  }
  return DecorationSet.create(doc, decos);
}

async function runCheck(view: EditorView) {
  const {enabled, lang} = useSpellStore.getState();
  if (!enabled) {
    useSpellStore.getState().setBlocks([]);
    return;
  }
  const blocks = extractBlocks(view.state.doc);
  try {
    const results = await invokeCheck(
      blocks.map((b) => b.text),
      lang,
    );
    const mapped: BlockErrors[] = blocks.map((b, i) => ({pos: b.pos, errors: results[i] ?? []}));
    useSpellStore.getState().setBlocks(mapped);
  } catch (e) {
    console.warn("spellcheck failed:", e);
  }
}

/**
 * Live-проверка орфографии в WYSIWYG (идея §4.4):
 * debounce 500 мс после правок -> check_spelling_blocks -> wavy-подчёркивания.
 * Декорации мапятся через транзакции, перестраиваются по версии spellStore.
 */
export function spellcheckExtension(): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          key: spellcheckKey,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, old) {
              if (tr.getMeta(REBUILD_META)) {
                return buildDecorations(tr.doc);
              }
              if (!useSpellStore.getState().enabled) {
                return DecorationSet.empty;
              }
              return old.map(tr.mapping, tr.doc);
            },
          },
          props: {
            decorations(state) {
              return spellcheckKey.getState(state);
            },
          },
          view(editorView) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let destroyed = false;

            const scheduleCheck = () => {
              clearTimeout(timer);
              timer = setTimeout(() => {
                if (!destroyed) void runCheck(editorView);
              }, DEBOUNCE_MS);
            };

            scheduleCheck(); // первая проверка при монтировании

            const unsubscribe = useSpellStore.subscribe((s, prev) => {
              if (destroyed) return;
              if (s.enabled !== prev.enabled || s.lang !== prev.lang) {
                scheduleCheck();
              }
              // новые результаты — перестроить декорации через meta-транзакцию
              if (s.version !== prev.version) {
                editorView.dispatch(editorView.state.tr.setMeta(REBUILD_META, true));
              }
            });

            return {
              update(view, prevState) {
                // реагируем только на изменения документа (не на meta-транзакции)
                if (view.state.doc !== prevState.doc) {
                  scheduleCheck();
                }
              },
              destroy() {
                destroyed = true;
                clearTimeout(timer);
                unsubscribe();
              },
            };
          },
        }),
    );
  };
}
