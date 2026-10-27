import {useEffect, useMemo, useState} from "react";
import {Button, Icon, Loader, Select, Text, TextInput, Tooltip} from "@gravity-ui/uikit";
import {ArrowRotateRight, Magnifier} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {useHarnessTasksStore} from "../../store/harnessTasksStore";
import {normalizeJoin} from "../../lib/utils";
import {normalizePath} from "../../lib/roots";
import type {TaskRow} from "../../lib/harnessTasks";
import {HARNESS_ICON} from "../harnessIcon";

/**
 * Дашборд задач task-yaml (план 20261027_005, §5): кандидаты — из реестра
 * (фильтр по типам словаря), статусы — из шапок файлов, переход — открытие
 * документа вкладкой. Данные — только через harnessTasksStore: смена
 * источника на БД UI не коснётся (D3).
 */

const FILTER_ALL = "__all__";

export function TaskDashboard() {
  const {t, i18n} = useTranslation();
  const roots = useFileStore((s) => s.roots);
  const tasksRoots = useHarnessTasksStore((s) => s.roots);
  const tasksVersion = useHarnessTasksStore((s) => s.version);
  const ensureTasks = useHarnessTasksStore((s) => s.ensureTasks);
  const refreshTasks = useHarnessTasksStore((s) => s.refreshRoot);

  // производные коллекции — useMemo, не селектор (урок §3)
  const harnessRoots = useMemo(() => roots.filter((r) => r.harness), [roots]);

  const [selected, setSelected] = useState<string | null>(null);
  // выбранный корень мог быть удалён — падаем на первый harness-корень
  const rootPath = useMemo(() => {
    const picked = harnessRoots.find((r) => r.path === selected) ?? harnessRoots[0];
    return picked?.path ?? null;
  }, [harnessRoots, selected]);

  useEffect(() => {
    if (rootPath) void ensureTasks(rootPath);
  }, [rootPath, tasksVersion, ensureTasks]);

  const [status, setStatus] = useState(FILTER_ALL);
  const [kind, setKind] = useState(FILTER_ALL);
  const [assignee, setAssignee] = useState(FILTER_ALL);
  const [query, setQuery] = useState("");

  const data = rootPath ? tasksRoots[normalizePath(rootPath)] : undefined;
  const rows = data?.rows ?? [];

  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.details.assignee) set.add(row.details.assignee);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const kinds = useMemo(() => {
    const set = new Set<string>(data?.vocab.kinds ?? []);
    for (const row of rows) {
      if (row.details.kind) set.add(row.details.kind);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows, data]);

  const statusDefs = useMemo(() => {
    const map = new Map(data?.vocab.statuses.map((s) => [s.value, s]) ?? []);
    return map;
  }, [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        const canon = row.statusCanonical;
        if (status !== FILTER_ALL) {
          // «Без статуса» — только пустые; иначе — точное совпадение канона
          if (status === "__none__" ? canon !== null : canon !== status) return false;
        }
        if (kind !== FILTER_ALL && row.details.kind !== kind) return false;
        if (assignee !== FILTER_ALL && row.details.assignee !== assignee) return false;
        if (q) {
          const hay = `${row.ref.title ?? ""} ${row.details.task ?? ""} ${row.details.tracker ?? ""} ${row.ref.path}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const upd = (b.ref.updated ?? "").localeCompare(a.ref.updated ?? "");
        if (upd !== 0) return upd;
        return (a.ref.title ?? a.ref.path).localeCompare(b.ref.title ?? b.ref.path);
      });
  }, [rows, status, kind, assignee, query]);

  if (harnessRoots.length === 0) {
    return (
      <div className="task-dashboard">
        <div className="task-dashboard__hint">
          <Icon data={HARNESS_ICON} size={18} />
          <Text variant="body-2" as="div">{t("harness.tasks.noRepo")}</Text>
        </div>
      </div>
    );
  }

  const statusLabel = (row: TaskRow): string => {
    const canon = row.statusCanonical;
    if (!canon) return t("harness.tasks.statusNone");
    return statusDefs.get(canon)?.label[i18n.language === "en" ? "en" : "ru"] ?? canon;
  };
  const statusColor = (row: TaskRow): string => {
    const canon = row.statusCanonical;
    return (canon && statusDefs.get(canon)?.color) || "neutral";
  };

  const openRow = (row: TaskRow) => {
    if (!rootPath) return;
    void useFileStore.getState().openFile(normalizeJoin(rootPath, row.ref.path));
  };

  return (
    <div className="task-dashboard">
      <div className="task-dashboard__filters">
        {harnessRoots.length > 1 && (
          <Select
            size="s"
            className="task-dashboard__root"
            value={[rootPath ?? ""]}
            onUpdate={(v) => setSelected(v[0] ?? null)}
            options={harnessRoots.map((r) => ({value: r.path, content: r.path.split(/[\\/]/).pop() ?? r.path}))}
          />
        )}
        <Select
          size="s"
          className="task-dashboard__filter"
          value={[status]}
          onUpdate={(v) => setStatus(v[0] ?? FILTER_ALL)}
          options={[
            {value: FILTER_ALL, content: t("harness.tasks.statusAll")},
            {value: "__none__", content: t("harness.tasks.statusNone")},
            ...[...statusDefs.values()].map((s) => ({value: s.value, content: s.label[i18n.language === "en" ? "en" : "ru"]})),
          ]}
        />
        <Select
          size="s"
          className="task-dashboard__filter"
          value={[kind]}
          onUpdate={(v) => setKind(v[0] ?? FILTER_ALL)}
          options={[
            {value: FILTER_ALL, content: t("harness.tasks.kindAll")},
            ...kinds.map((k) => ({value: k, content: k})),
          ]}
        />
        <Select
          size="s"
          className="task-dashboard__filter"
          value={[assignee]}
          onUpdate={(v) => setAssignee(v[0] ?? FILTER_ALL)}
          options={[
            {value: FILTER_ALL, content: t("harness.tasks.assigneeAll")},
            ...assignees.map((a) => ({value: a, content: a})),
          ]}
        />
        <TextInput
          size="s"
          className="task-dashboard__search"
          value={query}
          onUpdate={setQuery}
          placeholder={t("harness.tasks.search")}
          startContent={<Icon data={Magnifier} size={14} />}
        />
        <Tooltip content={t("harness.tasks.refresh")}>
          <Button
            view="flat"
            size="s"
            disabled={!rootPath}
            onClick={() => rootPath && void refreshTasks(rootPath)}
          >
            <Icon data={ArrowRotateRight} size={14} />
          </Button>
        </Tooltip>
      </div>
      {!data ? (
        <div className="task-dashboard__hint">
          <Loader size="m" />
        </div>
      ) : visible.length === 0 ? (
        <div className="task-dashboard__hint">
          <Text variant="body-2" as="div">{t("harness.tasks.empty")}</Text>
          <Text variant="caption-2" color="secondary" as="div">{t("harness.tasks.emptyHint")}</Text>
        </div>
      ) : (
        <div className="task-dashboard__list">
          {visible.map((row) => (
            <button
              key={row.ref.path}
              type="button"
              className="task-dashboard__row"
              title={row.ref.path}
              onClick={() => openRow(row)}
            >
              <span className="task-dashboard__row-top">
                <span className={`task-dashboard__badge task-dashboard__badge--${statusColor(row)}`}>
                  {statusLabel(row)}
                </span>
                {row.details.kind && <span className="task-dashboard__kind">{row.details.kind}</span>}
                <Text variant="body-2" ellipsis className="task-dashboard__title">
                  {row.ref.title ?? row.details.task ?? row.ref.path}
                </Text>
              </span>
              <span className="task-dashboard__row-bottom">
                {row.details.assignee && <span>{row.details.assignee}</span>}
                <span className="task-dashboard__path">{row.ref.path}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
