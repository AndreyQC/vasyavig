import {useEffect, useMemo, useState} from "react";
import {Button, Icon, Loader, Select, Text, TextInput, Tooltip} from "@gravity-ui/uikit";
import {ArrowRotateRight, Magnifier} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {useEntitiesIndexStore} from "../../store/entitiesIndexStore";
import {customTypeLabel} from "../../lib/entityTypes";
import type {EntityIndexEntry} from "../../lib/entitiesIndex";
import {RegistryEntityEditor} from "./RegistryEntityEditor";
import "./RegistryPanel.css";

/**
 * Панель «Справочник» (Phase 8.5, T6-2; план 20261105_011): единое место
 * правки entities.jsonl — список сущностей (фильтр по типу, поиск),
 * возможные дубли со слиянием (якоря переписываются в открытых вкладках),
 * редактор сущности (canonical/тип/алиасы/связи). Панель — per-root
 * (harness-корни предпочтительны, как в TaskDashboard), сайдбар-режим
 * «registry». Производные коллекции — useMemo, не селекторы (урок §3).
 */

const TYPE_ALL = "__all__";

export function RegistryPanel() {
  const {t, i18n} = useTranslation();
  const roots = useFileStore((s) => s.roots);
  const entries = useEntitiesIndexStore((s) => s.entries);
  const loading = useEntitiesIndexStore((s) => s.loading);
  const error = useEntitiesIndexStore((s) => s.error);
  const load = useEntitiesIndexStore((s) => s.load);

  const harnessRoots = useMemo(() => roots.filter((r) => r.harness), [roots]);
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const rootPath = useMemo(() => {
    const pool = harnessRoots.length > 0 ? harnessRoots : roots;
    return (pool.find((r) => r.path === selectedRoot) ?? pool[0])?.path ?? null;
  }, [harnessRoots, roots, selectedRoot]);

  useEffect(() => {
    if (rootPath != null) void load(rootPath);
  }, [rootPath, load]);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(TYPE_ALL);
  const [selectedUlid, setSelectedUlid] = useState<string | null>(null);

  const typeOptions = useMemo(() => {
    const tokens = [...new Set(entries.map((e) => e.type))].sort();
    return [
      {value: TYPE_ALL, content: t("registry.filterAll")},
      ...tokens.map((token) => ({value: token, content: typeLabel(token, i18n.language, t)})),
    ];
  }, [entries, i18n.language, t]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((entry) => {
        if (typeFilter !== TYPE_ALL && entry.type !== typeFilter) return false;
        if (!q) return true;
        const hay = [entry.canonical, ...entry.forms, ...(entry.aliases ?? [])]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.canonical.localeCompare(b.canonical));
  }, [entries, query, typeFilter]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.ulid === selectedUlid) ?? null,
    [entries, selectedUlid],
  );

  if (roots.length === 0) {
    return (
      <div className="registry-panel">
        <div className="registry-panel__hint">
          <Text variant="body-2" as="div">{t("registry.noWorkspace")}</Text>
        </div>
      </div>
    );
  }

  return (
    <div className="registry-panel">
      <div className="registry-panel__title-row">
        <Text variant="body-2" className="registry-panel__title">{t("registry.title")}</Text>
        <Tooltip content={t("registry.reload")}>
          <Button
            view="flat"
            size="s"
            disabled={!rootPath}
            onClick={() => rootPath && void load(rootPath)}
          >
            <Icon data={ArrowRotateRight} size={14} />
          </Button>
        </Tooltip>
      </div>
      {harnessRoots.length > 1 && (
        <Select
          size="s"
          className="registry-panel__root"
          value={[rootPath ?? ""]}
          onUpdate={(v) => setSelectedRoot(v[0] ?? null)}
          options={harnessRoots.map((r) => ({
            value: r.path,
            content: r.path.split(/[\\/]/).pop() ?? r.path,
          }))}
        />
      )}
      {error != null && (
        <div className="registry-panel__hint registry-panel__hint--error">{t("registry.loadError")}</div>
      )}
      {selectedEntry != null ? (
        <RegistryEntityEditor ulid={selectedEntry.ulid} onClose={() => setSelectedUlid(null)} />
      ) : (
        <>
          {duplicatesCount(entries) > 0 && (
            <DuplicatesSection onSelect={(ulid) => setSelectedUlid(ulid)} />
          )}
          <div className="registry-panel__filters">
            <TextInput
              size="s"
              className="registry-panel__search"
              value={query}
              onUpdate={setQuery}
              placeholder={t("registry.search")}
              startContent={<Icon data={Magnifier} size={14} />}
            />
            <Select
              size="s"
              className="registry-panel__type-filter"
              value={[typeFilter]}
              onUpdate={(v) => setTypeFilter(v[0] ?? TYPE_ALL)}
              options={typeOptions}
            />
          </div>
          {loading ? (
            <div className="registry-panel__hint">
              <Loader size="m" />
            </div>
          ) : visible.length === 0 ? (
            <div className="registry-panel__hint">
              <Text variant="body-2" as="div">{t("registry.empty")}</Text>
              <Text variant="caption-2" color="secondary" as="div">{t("registry.emptyHint")}</Text>
            </div>
          ) : (
            <div className="registry-panel__list">
              {visible.map((entry) => (
                <button
                  key={entry.ulid}
                  type="button"
                  className="registry-panel__row"
                  title={entry.ulid}
                  onClick={() => setSelectedUlid(entry.ulid)}
                >
                  <span className={`registry-panel__type registry-panel__type--${entry.type}`}>
                    {typeLabel(entry.type, i18n.language, t)}
                  </span>
                  <span className="registry-panel__canonical">{entry.canonical}</span>
                  <span className="registry-panel__counts">
                    {t("registry.formsCount", {count: entry.forms.length})}
                    {(entry.aliases?.length ?? 0) > 0 &&
                      ` · ${t("registry.aliasesCount", {count: entry.aliases?.length ?? 0})}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Подпись типа: кастомный — из harness.yaml, системный — i18n (HY-5). */
export function typeLabel(
  token: string,
  lang: string,
  t: (key: string) => string,
): string {
  return customTypeLabel(token, lang) ?? t(`assistant.entityType.${token}`);
}

/** Число групп возможных дублей: одна форма → несколько ULID. */
function duplicatesCount(entries: readonly EntityIndexEntry[]): number {
  return duplicateGroups(entries).length;
}

/**
 * Группы дублей: формы/алиасы, встречающиеся у нескольких записей
 * (однофамильцы-дубли — кандидат на слияние; осознанные однофамильцы
 * остаются как есть, слияние — ручное действие).
 */
export function duplicateGroups(
  entries: readonly EntityIndexEntry[],
): Array<{form: string; entries: EntityIndexEntry[]}> {
  const byForm = new Map<string, Map<string, EntityIndexEntry>>();
  for (const entry of entries) {
    for (const form of new Set([...entry.forms, ...(entry.aliases ?? [])])) {
      const byUlid = byForm.get(form) ?? new Map<string, EntityIndexEntry>();
      byUlid.set(entry.ulid, entry);
      byForm.set(form, byUlid);
    }
  }
  const groups: Array<{form: string; entries: EntityIndexEntry[]}> = [];
  for (const [form, byUlid] of byForm) {
    if (byUlid.size > 1) {
      groups.push({
        form,
        entries: [...byUlid.values()].sort((a, b) => a.canonical.localeCompare(b.canonical)),
      });
    }
  }
  return groups.sort((a, b) => a.form.localeCompare(b.form));
}

/** Секция дублей: выбрать главную запись группы — остальные переезжают в неё. */
function DuplicatesSection({onSelect}: {onSelect: (ulid: string) => void}) {
  const {t} = useTranslation();
  const entries = useEntitiesIndexStore((s) => s.entries);
  const mergeEntries = useEntitiesIndexStore((s) => s.mergeEntries);
  const groups = useMemo(() => duplicateGroups(entries), [entries]);
  const [mains, setMains] = useState<Record<string, string>>({});

  return (
    <div className="registry-panel__duplicates">
      <Text variant="caption-2" color="secondary" as="div">
        {t("registry.duplicatesTitle")}
      </Text>
      {groups.map((group) => {
        const main = mains[group.form] ?? group.entries[0]?.ulid ?? "";
        return (
          <div key={group.form} className="registry-panel__duplicate">
            <span className="registry-panel__duplicate-form" title={group.form}>
              {t("registry.duplicateForm", {form: group.form, count: group.entries.length})}
            </span>
            <Select
              size="s"
              className="registry-panel__duplicate-main"
              value={[main]}
              onUpdate={(v) => setMains((prev) => ({...prev, [group.form]: v[0] ?? main}))}
              options={group.entries.map((e) => ({value: e.ulid, content: e.canonical}))}
            />
            <Button
              size="xs"
              view="outlined"
              onClick={() => {
                for (const entry of group.entries) {
                  if (entry.ulid !== main) void mergeEntries(entry.ulid, main);
                }
              }}
            >
              {t("registry.duplicateMerge")}
            </Button>
            <Button size="xs" view="flat" onClick={() => onSelect(main)}>
              {t("registry.duplicateOpen")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
