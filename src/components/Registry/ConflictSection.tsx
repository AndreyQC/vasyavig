import {useEffect, useMemo} from "react";
import {Button, Icon, Text, Tooltip} from "@gravity-ui/uikit";
import {ArrowRotateRight} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEntityConflictStore, type EntityConflict, type ResolvableOccurrence} from "../../store/entityConflictStore";
import {useEditorStore} from "../../store/editorStore";
import {useUiStore} from "../../store/uiStore";

/**
 * Секция конфликтов активного документа (T6-5, план 20261105_012): вхождения
 * форм справочника без якорей, где одна форма → несколько ULID. Действия по
 * конфликту: «Это он» (якорь с ULID кандидата), «Отдельная» (новая запись +
 * якорь), «Объединить» (слияние кандидатов в первого). Однозначные по
 * связям/co_occurs вхождения — закрепляются кнопкой или авто-режимом
 * (uiStore.autoAnchors, выключен по умолчанию).
 */
export function ConflictSection() {
  const {t} = useTranslation();
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const byDoc = useEntityConflictStore((s) => s.byDoc);
  const scan = useEntityConflictStore((s) => s.scan);
  const anchorConflict = useEntityConflictStore((s) => s.anchorConflict);
  const anchorResolvable = useEntityConflictStore((s) => s.anchorResolvable);
  const createSeparate = useEntityConflictStore((s) => s.createSeparate);
  const mergeConflict = useEntityConflictStore((s) => s.mergeConflict);
  const autoAnchors = useUiStore((s) => s.autoAnchors);
  const setAutoAnchors = useUiStore((s) => s.setAutoAnchors);

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath), [tabs, activePath]);
  const isMarkdown = activeTab?.kind === "markdown";
  const key = activePath?.replace(/\\/g, "/").toLowerCase() ?? "";
  const state = byDoc[key];

  // скан при появлении markdown-вкладки в панели; дальше — по кнопке
  useEffect(() => {
    if (isMarkdown && activePath != null && state == null) {
      void scan(activePath, activeTab?.content ?? "");
    }
  }, [isMarkdown, activePath, state == null, scan, activeTab?.content]);

  if (!isMarkdown || activePath == null) return null;

  const conflicts = state?.conflicts ?? [];
  const resolvable = state?.resolvable ?? [];

  return (
    <div className="registry-conflicts">
      <div className="registry-conflicts__header">
        <Text variant="caption-2" color="secondary" as="div">
          {t("registry.conflictsTitle", {count: conflicts.length, resolvable: resolvable.length})}
        </Text>
        <Tooltip content={t("registry.rescan")}>
          <Button
            size="xs"
            view="flat"
            disabled={state?.scanning}
            onClick={() => void scan(activePath, activeTab?.content ?? "")}
          >
            <Icon data={ArrowRotateRight} size={12} />
          </Button>
        </Tooltip>
        <Tooltip content={t("registry.autoAnchorsHint")}>
          <Button
            size="xs"
            view={autoAnchors ? "normal" : "flat"}
            onClick={() => setAutoAnchors(!autoAnchors)}
          >
            {t("registry.autoAnchors")}
          </Button>
        </Tooltip>
      </div>
      {state?.scanning && <Text variant="caption-2" color="secondary" as="div">{t("registry.scanning")}</Text>}
      {state?.error != null && (
        <Text variant="caption-2" color="danger" as="div">{t("registry.conflictScanError")}</Text>
      )}
      {!state?.scanning && conflicts.length === 0 && resolvable.length === 0 && (
        <Text variant="caption-2" color="secondary" as="div">{t("registry.conflictsEmpty")}</Text>
      )}
      {resolvable.map((occ, index) => (
        <ResolvableRow
          key={`${occ.start}-${index}`}
          occurrence={occ}
          onAnchor={() => void anchorResolvable(activePath, occ)}
        />
      ))}
      {conflicts.map((conflict) => (
        <ConflictRow
          key={conflict.key}
          conflict={conflict}
          onAnchor={(ulid) => void anchorConflict(activePath, conflict, ulid)}
          onCreateSeparate={() => void createSeparate(activePath, conflict)}
          onMerge={() => void mergeConflict(activePath, conflict)}
        />
      ))}
    </div>
  );
}

function ResolvableRow({occurrence, onAnchor}: {occurrence: ResolvableOccurrence; onAnchor: () => void}) {
  const {t} = useTranslation();
  return (
    <div className="registry-conflicts__row">
      <span className="registry-conflicts__value">{occurrence.value}</span>
      <span className="registry-conflicts__via">
        {t("registry.resolvableVia", {
          canonical: occurrence.entry.canonical,
          via: t(`registry.conflictVia.${occurrence.via}`),
        })}
      </span>
      <Button size="xs" view="outlined" onClick={onAnchor}>
        {t("registry.anchorAction")}
      </Button>
    </div>
  );
}

function ConflictRow({
  conflict,
  onAnchor,
  onCreateSeparate,
  onMerge,
}: {
  conflict: EntityConflict;
  onAnchor: (ulid: string) => void;
  onCreateSeparate: () => void;
  onMerge: () => void;
}) {
  const {t} = useTranslation();
  return (
    <div className="registry-conflicts__conflict">
      <div className="registry-conflicts__row">
        <span className="registry-conflicts__value">
          {t("registry.conflictValue", {value: conflict.value, count: conflict.occurrences.length})}
        </span>
      </div>
      {conflict.candidates.map((candidate) => (
        <div key={candidate.ulid} className="registry-conflicts__row registry-conflicts__row--candidate">
          <span className="registry-conflicts__candidate" title={candidate.ulid}>
            {candidate.canonical}
          </span>
          <Button size="xs" view="outlined" onClick={() => onAnchor(candidate.ulid)}>
            {t("registry.conflictItIs")}
          </Button>
        </div>
      ))}
      <div className="registry-conflicts__row">
        <Button size="xs" view="flat" onClick={onCreateSeparate}>
          {t("registry.conflictSeparate")}
        </Button>
        <Button size="xs" view="flat" onClick={onMerge}>
          {t("registry.conflictMerge")}
        </Button>
      </div>
    </div>
  );
}
