/**
 * ULID-ссылки в Markup-режиме (task 20261027_004, Phase 7 задача 4).
 *
 * CodeMirror 6: подсвечиваем href-токены `harness-ulid:<ULID>[#<anchor>]`
 * (и legacy `harness_ulid:`/`ulid:`) классами `ulid-link`/`ulid-unknown`.
 * Клик открывает документ через тот же `openUlidTarget`; неизвестный ULID —
 * уведомление. Плашечка при наведении — общая (data-атрибуты).
 */
import {
  RangeSetBuilder,
  StateEffect,
  type EditorState,
  type Extension as CM6Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {isPlausibleUlid} from "./harnessEnvelope";
import {openUlidTarget, useHarnessStore} from "../store/harnessStore";
import {getParentDir} from "./utils";
import i18n from "./i18n";

const REBUILD_EFFECT = StateEffect.define<null>();

/** Схемы: текущая `harness-ulid:` + legacy `harness_ulid:` и `ulid:`. */
const ULID_HREF_RE =
  /(?:harness[-_]ulid|ulid):([0-9A-HJKMNP-TV-Z]{26})(?:#([0-9A-HJKMNP-TV-Z]{26}))?/g;

interface TextRange {
  from: number;
  to: number;
}

/** Диапазоны fenced-код-блоков: внутри них ссылки не подсвечиваем. */
function fencedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const fenceRe = /^ {0,3}(```|~~~)[^\n]*$/gm;
  let open: {start: number; marker: string} | null = null;
  for (let m = fenceRe.exec(text); m; m = fenceRe.exec(text)) {
    const marker = m[1];
    if (!open) {
      open = {start: m.index, marker};
    } else if (marker === open.marker) {
      ranges.push({from: open.start, to: m.index + m[0].length});
      open = null;
    }
  }
  if (open) ranges.push({from: open.start, to: text.length});
  return ranges;
}

function inRanges(pos: number, ranges: TextRange[]): boolean {
  return ranges.some((range) => pos >= range.from && pos < range.to);
}

export interface MarkupUlidRange {
  from: number;
  to: number;
  ulid: string;
  anchor?: string;
}

/**
 * Все ULID-href в тексте Markup (offsets CodeMirror). Валидация — форма
 * Crockford + окно таймстемпа; fenced-код-блоки пропускаются.
 */
export function findMarkupUlidRanges(text: string): MarkupUlidRange[] {
  const excluded = fencedCodeRanges(text);
  const ranges: MarkupUlidRange[] = [];
  ULID_HREF_RE.lastIndex = 0;
  for (let m = ULID_HREF_RE.exec(text); m; m = ULID_HREF_RE.exec(text)) {
    if (inRanges(m.index, excluded)) continue;
    const ulid = m[1];
    const anchor = m[2];
    if (!isPlausibleUlid(ulid)) continue;
    if (anchor && !isPlausibleUlid(anchor)) continue;
    const range: MarkupUlidRange = {from: m.index, to: m.index + m[0].length, ulid};
    if (anchor) range.anchor = anchor;
    ranges.push(range);
  }
  return ranges;
}

/** Декорации по документу: известные реестру — `ulid-link`, остальные — `ulid-unknown`. */
export function buildMarkupDecorations(state: EditorState, dir: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = findMarkupUlidRanges(state.doc.toString());
  const {resolveFor} = useHarnessStore.getState();
  for (const range of ranges) {
    const res = resolveFor(dir, range.ulid);
    const known = res.status === "found";
    const attributes: Record<string, string> = {
      "data-ulid-dir": dir,
      "aria-label": known
        ? [res.entry.title ?? res.entry.path, res.entry.type].filter(Boolean).join(" · ")
        : i18n.t("harness.ulidUnknownTooltip"),
    };
    if (known) {
      attributes["data-ulid"] = range.ulid;
    } else {
      attributes["data-ulid-unknown"] = range.ulid;
    }
    if (range.anchor) attributes["data-anchor"] = range.anchor;
    builder.add(
      range.from,
      range.to,
      Decoration.mark({
        class: known ? "ulid-link" : "ulid-unknown",
        attributes,
      }),
    );
  }
  return builder.finish();
}

function createPlugin(dir: string): CM6Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly unsubscribe: () => void;

      constructor(view: EditorView) {
        this.decorations = buildMarkupDecorations(view.state, dir);
        // реестр загрузился/перечитался — пересобрать подсветку
        this.unsubscribe = useHarnessStore.subscribe((s, prev) => {
          if (s.version !== prev.version) {
            view.dispatch({effects: REBUILD_EFFECT.of(null)});
          }
        });
      }

      update(update: ViewUpdate): void {
        const registryChanged = update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(REBUILD_EFFECT)),
        );
        if (update.docChanged || registryChanged) {
          this.decorations = buildMarkupDecorations(update.state, dir);
        }
      }

      destroy(): void {
        this.unsubscribe();
      }
    },
    {decorations: (plugin) => plugin.decorations},
  );
}

/** Клик по подсвеченному токену: известный — открыть, неизвестный — уведомление. */
function createClickHandler(dir: string): CM6Extension {
  return EditorView.domEventHandlers({
    click(event) {
      const el = (event.target as HTMLElement | null)?.closest?.(
        "[data-ulid], [data-ulid-unknown]",
      ) as HTMLElement | null;
      if (!el) return false;
      const ulid = el.getAttribute("data-ulid") ?? el.getAttribute("data-ulid-unknown");
      if (!ulid) return false;
      event.preventDefault();
      const anchor = el.getAttribute("data-anchor") ?? undefined;
      void openUlidTarget(dir, ulid, anchor);
      return true;
    },
  });
}

/**
 * Extension для `markupConfig.extensions`: path — файл вкладки, каталог —
 * база резолва ULID по реестру ближайшего harness-репозитория.
 */
export function harnessUlidMarkupExtension(path: string): CM6Extension[] {
  const dir = getParentDir(path);
  return [createPlugin(dir), createClickHandler(dir)];
}
