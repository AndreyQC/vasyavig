import {useEffect, useMemo, useState} from "react";
import {Button, Icon, Popover, Tooltip} from "@gravity-ui/uikit";
import {PersonMagnifier} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {getEditor} from "../../lib/editorRegistry";
import {getParentDir} from "../../lib/utils";
import {lineOfOffset, useNerSpans} from "../../hooks/useNerSpans";
import {parseEntityLinks} from "../../lib/agent/masking/vasEntityMarkup";
import {buildVasEntityHref} from "../../lib/agent/masking/vasEntityLink";
import {generateUlid} from "../../lib/agent/masking/ulid";
import type {EntityType} from "../../lib/agent/masking/types";
import {ensureEntitiesIndex, matchEntityEntry, type EntityIndexEntry} from "../../lib/entitiesIndex";
import {customTypeLabel, ensureEntityTypes} from "../../lib/entityTypes";

/**
 * Кнопка «NER» в тулбаре markdown-вкладок (T2 + T3; план 20261105_001,
 * T3-10): дропдаун с двумя секциями. «Размечено» — чип-ссылки `vas-entity:`
 * из документа (кнопка «Снять»); «Предложения» — NER-спаны вне разметки:
 * известные словарю identities сущности помечены бейджем эталона и
 * размечаются существующим ULID, новые — свежим ULID. «Разметить все
 * известные» — одним bulk-редактом. Правки — через editor.replace()
 * (паттерн restoreUrls), работают в обоих режимах.
 */
export function NerButton({path}: {path: string}) {
  const {t, i18n} = useTranslation();
  const content = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.content ?? "");
  const spans = useNerSpans(path, content);
  const [indexEntries, setIndexEntries] = useState<EntityIndexEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const dir = getParentDir(path);
    void ensureEntityTypes(dir); // справочник для подписей типов (HY-5)
    void ensureEntitiesIndex(dir).then((file) => {
      if (alive) setIndexEntries(file.entries);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  const markedSpans = useMemo(() => parseEntityLinks(content), [content]);

  /** Предложения: NER-спаны, не накрытые существующей разметкой. */
  const suggestions = useMemo(
    () =>
      spans.filter(
        (span) =>
          !markedSpans.some((marked) => span.start < marked.end && marked.start < span.end),
      ),
    [spans, markedSpans],
  );

  const knownSuggestions = useMemo(
    () => suggestions.map((span) => ({span, known: matchEntityEntry(indexEntries, span.value)})),
    [suggestions, indexEntries],
  );
  const knownCount = knownSuggestions.filter((item) => item.known != null).length;

  /** Пакет raw-правок в контент вкладки через editor.replace(). */
  const applyEdits = (edits: Array<{start: number; end: number; insert: string}>) => {
    const editor = getEditor(path);
    if (!editor || edits.length === 0) return;
    let text = content;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.insert + text.slice(edit.end);
    }
    editor.replace(text);
  };

  const markSuggestion = (
    span: {start: number; end: number; value: string; type: EntityType},
    known: EntityIndexEntry | null,
  ) => {
    // HY-5: токен типа — из известной записи (идентичность важнее догадки NER)
    const token = known?.type ?? span.type.toLowerCase();
    const ulid = known?.ulid ?? generateUlid();
    applyEdits([
      {start: span.start, end: span.end, insert: `[${span.value}](${buildVasEntityHref(token, ulid)})`},
    ]);
  };

  const markAllKnown = () => {
    const edits = knownSuggestions
      .filter((item) => item.known != null)
      .map(({span, known}) => ({
        start: span.start,
        end: span.end,
        insert: `[${span.value}](${buildVasEntityHref((known as EntityIndexEntry).type, (known as EntityIndexEntry).ulid)})`,
      }));
    applyEdits(edits);
  };

  const goTo = (offset: number) => {
    const editor = getEditor(path);
    if (!editor) return;
    editor.moveCursor({line: lineOfOffset(content, offset)});
  };

  const markedCount = markedSpans.length;

  /** Подпись типа: кастом — из harness.yaml, системный — i18n (HY-5). */
  const typeLabel = (token: string): string =>
    customTypeLabel(token, i18n.language) ?? t(`assistant.entityType.${token}`);

  return (
    <Tooltip content={t("tools.nerTooltip")}>
      <span>
        <Popover
          trigger="click"
          toggle
          placement="bottom-start"
          content={
            <div className="ner-panel">
              <div className="ner-panel__title">{t("ner.title")}</div>

              {markedCount > 0 && (
                <div className="ner-panel__section">
                  <div className="ner-panel__section-title">
                    {t("entity.markedSection")} · {markedCount}
                  </div>
                  <div className="ner-panel__list">
                    {markedSpans.map((span, index) => (
                      <div
                        key={`${span.start}-${index}`}
                        className="ner-panel__row"
                      >
                        <button
                          type="button"
                          className="ner-panel__item"
                          onClick={() => goTo(span.start)}
                        >
                          <span className={`ner-panel__type ner-panel__type--${span.type}`}>
                            {typeLabel(span.type)}
                          </span>
                          <span className="ner-panel__value">{span.value}</span>
                          <span className="ner-panel__line">{t("ner.line", {line: lineOfOffset(content, span.start) + 1})}</span>
                        </button>
                        <Button
                          size="xs"
                          view="flat"
                          onClick={() => applyEdits([{start: span.start, end: span.end, insert: span.value}])}
                        >
                          {t("entity.unmark")}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {knownSuggestions.length > 0 ? (
                <div className="ner-panel__section">
                  <div className="ner-panel__section-title">
                    {t("entity.suggestionsSection")} · {knownSuggestions.length}
                    {knownCount > 0 && (
                      <Button size="xs" view="flat" onClick={markAllKnown}>
                        {t("entity.markAllKnown")}
                      </Button>
                    )}
                  </div>
                  <div className="ner-panel__list">
                    {knownSuggestions.map(({span, known}, index) => (
                      <div
                        key={`${span.start}-${index}`}
                        className="ner-panel__row"
                      >
                        <button
                          type="button"
                          className="ner-panel__item"
                          onClick={() => goTo(span.start)}
                        >
                          <span className={`ner-panel__type ner-panel__type--${span.type.toLowerCase()}`}>
                            {typeLabel(span.type.toLowerCase())}
                          </span>
                          <span className="ner-panel__value">{span.value}</span>
                          {known != null && known.canonical !== span.value && (
                            <span className="ner-panel__line">
                              {t("entity.known")}: {known.canonical}
                            </span>
                          )}
                        </button>
                        <Button size="xs" view="outlined" onClick={() => markSuggestion(span, known)}>
                          {t("entity.markAction")}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                markedCount === 0 && <div className="ner-panel__empty">{t("ner.empty")}</div>
              )}
            </div>
          }
        >
          <Button view="flat">
            <Icon data={PersonMagnifier} />
            {t("tools.ner")}
            <span className="harness-links-panel__count">{spans.length + markedCount}</span>
          </Button>
        </Popover>
      </span>
    </Tooltip>
  );
}
