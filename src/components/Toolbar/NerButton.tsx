import {useEffect, useMemo, useState} from "react";
import {Button, Icon, Popover, Tooltip} from "@gravity-ui/uikit";
import {PersonMagnifier} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useFileStore} from "../../store/fileStore";
import {getEditor} from "../../lib/editorRegistry";
import {getParentDir} from "../../lib/utils";
import {lineOfOffset, useNerSpans} from "../../hooks/useNerSpans";
import {parseEntityLinks} from "../../lib/agent/masking/vasEntityMarkup";
import {buildVasEntityHref} from "../../lib/agent/masking/vasEntityLink";
import {generateUlid} from "../../lib/agent/masking/ulid";
import type {EntityType} from "../../lib/agent/masking/types";
import {
  addEntityToIndex,
  ensureEntitiesIndex,
  matchEntityEntry,
  type EntityIndexEntry,
} from "../../lib/entitiesIndex";
import {customTypeLabel, ensureEntityTypes} from "../../lib/entityTypes";
import {useEntityScanStore} from "../../store/entityScanStore";
import {findHarnessRoot} from "../../lib/harnessIndex";

/**
 * Кнопка «NER» в тулбаре markdown-вкладок (T2 + T3; план 20261105_001,
 * T3-10): дропдаун с двумя секциями. «Размечено» — чип-ссылки `vas-entity:`
 * из документа (кнопка «Снять»); «Предложения» — NER-спаны вне разметки:
 * известные словарю identities сущности помечены бейджем эталона и
 * размечаются существующим ULID, новые — свежим ULID. «Разметить все
 * известные» — одним bulk-редактом. T6-4: у предложений действие
 * «В справочник» (запись entities.jsonl без разметки документа) и
 * «Создать отдельную» для совпавших с известной формой (однофамилец).
 * Правки — через editor.replace() (паттерн restoreUrls), работают в обоих
 * режимах.
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

  /**
   * D-1: перечитать словарь сущностей. Снимок из mount-time устаревает после
   * сохранения вкладки (watcher инвалидирует кэш), поэтому перед действием
   * индекс берётся заново — иначе разметка склонения не найдёт только что
   * сохранённую запись и создаст дубль ULID.
   */
  const reloadIndex = async (): Promise<EntityIndexEntry[]> => {
    const file = await ensureEntitiesIndex(getParentDir(path));
    setIndexEntries(file.entries);
    return file.entries;
  };

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
    () => suggestions.map((span) => ({span, known: matchEntityEntry(indexEntries, span.value, undefined, {fuzzy: true})})),
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

  const markSuggestion = async (
    span: {start: number; end: number; value: string; type: EntityType},
    known: EntityIndexEntry | null,
  ) => {
    // D-1: сверка со свежим индексом (запись могла появиться после открытия).
    const entries = await reloadIndex();
    const resolved = matchEntityEntry(entries, span.value, undefined, {fuzzy: true}) ?? known;
    // HY-5: токен типа — из известной записи (идентичность важнее догадки NER)
    const token = resolved?.type ?? span.type.toLowerCase();
    const ulid = resolved?.ulid ?? generateUlid();
    applyEdits([
      {start: span.start, end: span.end, insert: `[${span.value}](${buildVasEntityHref(token, ulid)})`},
    ]);
  };

  const markAllKnown = async () => {
    const entries = await reloadIndex();
    const edits = knownSuggestions
      .map(({span}) => ({
        span,
        known: matchEntityEntry(entries, span.value, undefined, {fuzzy: true}),
      }))
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

  /**
   * T6-4: NER-предложение → запись справочника, документ не меняется.
   * Неизвестное значение — «В справочник»; совпавшее с известной записью —
   * «Создать отдельную» (однофамилец; связь/конфликт — T6-5). После записи
   * индекс перечитывается: предложение станет known (форма теперь в справочнике).
   */
  const addToRegistry = async (span: {value: string; type: EntityType}) => {
    await addEntityToIndex(getParentDir(path), {type: span.type, canonical: span.value});
    await reloadIndex();
  };

  const markedCount = markedSpans.length;

  /** Подпись типа: кастом — из harness.yaml, системный — i18n (HY-5). */
  const typeLabel = (token: string): string =>
    customTypeLabel(token, i18n.language) ?? t(`assistant.entityType.${token}`);

  // Re-markup уровня репо (T3b, B-4): скан по harness-корню документа
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void findHarnessRoot(getParentDir(path)).then((root) => {
      if (alive) setRepoRoot(root);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  const rootKey = repoRoot?.replace(/\\/g, "/") ?? null;
  const scanState = useEntityScanStore((s) => (rootKey ? s.byRoot[rootKey] : undefined));
  const scanRepo = useEntityScanStore((s) => s.scan);
  const rebuildIndex = useEntityScanStore((s) => s.rebuildIndex);
  const resolveChanged = useEntityScanStore((s) => s.resolveChanged);
  const removeMissing = useEntityScanStore((s) => s.removeMissing);
  const resolveTypeConflict = useEntityScanStore((s) => s.resolveTypeConflict);
  const removeUnused = useEntityScanStore((s) => s.removeUnused);
  const [showAllKnown, setShowAllKnown] = useState(false);
  const [confirmUnused, setConfirmUnused] = useState<string | null>(null);

  /** Открыть документ репо вкладкой (неоднозначная форма — разрешение в панели). */
  const openDoc = (docPath?: string) => {
    if (docPath == null) return;
    // D-14 (приёмка 20261108_001): openTab с content: "" создавал пустую
    // вкладку под именем реального файла (риск data-loss при сохранении).
    // openFile читает файл с диска и открывает вкладку с реальным контентом.
    void useFileStore.getState().openFile(docPath);
  };

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

              {repoRoot != null && (
                <div className="ner-panel__section ner-panel__section--repo">
                  <div className="ner-panel__section-title">
                    {t("entity.repoSection")}
                    <Button size="xs" view="flat" disabled={scanState?.scanning} onClick={() => void scanRepo(repoRoot)}>
                      {t("entity.repoScan")}
                    </Button>
                  </div>
                  {scanState?.error != null && (
                    <div className="ner-panel__empty">
                      {scanState.error === "open_required"
                        ? t("entity.repoOpenRequired")
                        : t("entity.repoScanError")}
                    </div>
                  )}
                  {scanState?.diff != null && (
                    <>
                      <div className="ner-panel__empty">
                        {t("entity.repoSummary", {
                          docs: scanState.scannedDocs,
                          changed: scanState.diff.changed.length,
                          missing: scanState.diff.missing.length,
                          known: scanState.diff.unknownKnown.length,
                        })}
                        {" · "}
                        <button type="button" className="ner-panel__rebuild" onClick={() => void rebuildIndex(repoRoot)}>
                          {t("entity.repoRebuild")}
                        </button>
                      </div>
                      {scanState.diff.changed.map((change) => (
                        <div key={change.ulid} className="ner-panel__row">
                          <span className="ner-panel__item">
                            <span className={`ner-panel__type ner-panel__type--${change.type}`}>
                              {typeLabel(change.type)}
                            </span>
                            <span className="ner-panel__value">{change.value}</span>
                            <span className="ner-panel__line">{t("entity.known")}: {change.canonical}</span>
                          </span>
                          <Button size="xs" view="flat" onClick={() => void resolveChanged(repoRoot, change, "same")}>
                            {t("entity.changeSame")}
                          </Button>
                          <Button size="xs" view="outlined" onClick={() => void resolveChanged(repoRoot, change, "new")}>
                            {t("entity.changeNew")}
                          </Button>
                        </div>
                      ))}
                      {scanState.diff.missing.map((missing) => (
                        <div key={missing.ulid} className="ner-panel__row">
                          <span className="ner-panel__item">
                            <span className={`ner-panel__type ner-panel__type--${missing.type}`}>
                              {typeLabel(missing.type)}
                            </span>
                            <span className="ner-panel__value">{missing.canonical}</span>
                            <span className="ner-panel__line">{t("entity.repoMissing")}</span>
                          </span>
                          <Button size="xs" view="flat" onClick={() => void removeMissing(repoRoot, missing.ulid)}>
                            {t("entity.repoRemove")}
                          </Button>
                        </div>
                      ))}
                      {scanState.diff.typeConflicts.length > 0 && (
                        <div className="ner-panel__section">
                          <div className="ner-panel__section-title">
                            {t("entity.repoConflicts")} · {scanState.diff.typeConflicts.length}
                          </div>
                          {scanState.diff.typeConflicts.map((conflict) => (
                            <div key={conflict.ulid} className="ner-panel__row">
                              <span className="ner-panel__item">
                                <span className="ner-panel__value">{conflict.ulid.slice(0, 8)}…</span>
                                <span className="ner-panel__line">{conflict.types.join(" / ")}</span>
                              </span>
                              {conflict.types.map((type) => (
                                <Button
                                  key={type}
                                  size="xs"
                                  view="outlined"
                                  onClick={() => void resolveTypeConflict(repoRoot, conflict.ulid, type)}
                                >
                                  {typeLabel(type)}
                                </Button>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      {(showAllKnown ? scanState.diff.unknownKnown : scanState.diff.unknownKnown.slice(0, 20)).map((unknown, index) => (
                        <div key={`${unknown.ulid}-${unknown.doc}-${index}`} className="ner-panel__row">
                          <button
                            type="button"
                            className="ner-panel__item"
                            onClick={() => {
                              // D-14: то же — чтение файла вместо пустой вкладки.
                              void useFileStore.getState().openFile(unknown.doc);
                            }}
                          >
                            <span className={`ner-panel__type ner-panel__type--${unknown.type}`}>
                              {typeLabel(unknown.type)}
                            </span>
                            <span className="ner-panel__value">{unknown.value}</span>
                            <span className="ner-panel__line">{t("entity.known")}: {unknown.canonical}</span>
                          </button>
                        </div>
                      ))}
                      {!showAllKnown && scanState.diff.unknownKnown.length > 20 && (
                        <Button size="xs" view="flat" onClick={() => setShowAllKnown(true)}>
                          {t("entity.showAll", {count: scanState.diff.unknownKnown.length})}
                        </Button>
                      )}

                      {(scanState.formsDiff?.ambiguous.length ?? 0) > 0 && (
                        <div className="ner-panel__section">
                          <div className="ner-panel__section-title">
                            {t("entity.repoAmbiguous")} · {scanState.formsDiff!.ambiguous.length}
                          </div>
                          {scanState.formsDiff!.ambiguous.map((group) => (
                            <div key={group.value} className="ner-panel__row">
                              <button
                                type="button"
                                className="ner-panel__item"
                                title={t("entity.repoAmbiguousOpenDoc")}
                                onClick={() => openDoc(group.occurrences[0]?.doc)}
                              >
                                <span className={`ner-panel__type ner-panel__type--${group.type}`}>
                                  {typeLabel(group.type)}
                                </span>
                                <span className="ner-panel__value">{group.value}</span>
                                <span className="ner-panel__line">
                                  {group.ulids
                                    .map((ulid) => indexEntries.find((e) => e.ulid === ulid)?.canonical ?? ulid.slice(0, 8))
                                    .join(" / ")}
                                </span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {(scanState.formsDiff?.unused.length ?? 0) > 0 && (
                        <div className="ner-panel__section">
                          <div className="ner-panel__section-title">
                            {t("entity.repoUnused")} · {scanState.formsDiff!.unused.length}
                          </div>
                          {scanState.formsDiff!.unused.map((unused) => (
                            <div key={unused.ulid} className="ner-panel__row">
                              <span className="ner-panel__item">
                                <span className={`ner-panel__type ner-panel__type--${unused.type}`}>
                                  {typeLabel(unused.type)}
                                </span>
                                <span className="ner-panel__value">{unused.canonical}</span>
                              </span>
                              <Button
                                size="xs"
                                view={confirmUnused === unused.ulid ? "outlined-danger" : "flat"}
                                onClick={() => {
                                  if (confirmUnused !== unused.ulid) {
                                    setConfirmUnused(unused.ulid); // риск 2: могут быть ложными — подтверждение
                                    return;
                                  }
                                  setConfirmUnused(null);
                                  void removeUnused(repoRoot, unused.ulid);
                                }}
                              >
                                {confirmUnused === unused.ulid ? t("entity.repoUnusedConfirm") : t("entity.repoRemove")}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {scanState == null && <div className="ner-panel__empty">{t("entity.repoIdle")}</div>}
                </div>
              )}

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
                    <Button size="xs" view="flat" onClick={() => void markAllKnown()}>
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
                        <Button size="xs" view="outlined" onClick={() => void markSuggestion(span, known)}>
                          {t("entity.markAction")}
                        </Button>
                        <Button size="xs" view="flat" onClick={() => void addToRegistry(span)}>
                          {known == null ? t("entity.toRegistry") : t("entity.createSeparate")}
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
          <Button
            view="flat"
            // D-1: открытие панели — повод перечитать словарь сущностей.
            onClick={() => void reloadIndex()}
          >
            <Icon data={PersonMagnifier} />
            {t("tools.ner")}
            <span className="harness-links-panel__count">{spans.length + markedCount}</span>
          </Button>
        </Popover>
      </span>
    </Tooltip>
  );
}
