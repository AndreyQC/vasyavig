import {useEffect, useMemo} from "react";
import {
  Button,
  Icon,
  Loader,
  SegmentedRadioGroup,
  Select,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@gravity-ui/uikit";
import {ArrowRotateRight, ChevronsCollapseVertical, Magnifier} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useHarnessStore} from "../../store/harnessStore";
import {useHarnessGraphStore} from "../../store/harnessGraphStore";
import {useGraphPanelStore, type GraphView} from "../../store/graphPanelStore";
import {useHarnessRepos} from "../../hooks/useHarnessRepos";
import {repoRelativePath} from "../../lib/harnessIndex";
import {listProjects, listTypes} from "../../lib/harnessGraph";
import {normalizePath} from "../../lib/roots";
import {GraphAround} from "./GraphAround";
import {GraphOverview} from "./GraphOverview";
import "./Graph.css";

const FILTER_ALL = "__all__";

/** Короткое имя репозитория для выпадающего списка. */
function repoName(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Панель графа документов (план 20261028_001): живёт во вкладке «Граф»
 * главной панели. Слева — управление (репозиторий, фильтры, поиск), справа —
 * демонстрация: «Вокруг документа» или обзорное дерево.
 */
export function DocumentGraphPanel() {
  const {t} = useTranslation();
  const repos = useHarnessRepos();
  const activePath = useEditorStore((s) => s.activePath);

  const repoRoot = useGraphPanelStore((s) => s.repoRoot);
  const setRepoRoot = useGraphPanelStore((s) => s.setRepoRoot);
  const view = useGraphPanelStore((s) => s.view);
  const setView = useGraphPanelStore((s) => s.setView);
  const project = useGraphPanelStore((s) => s.project);
  const setProject = useGraphPanelStore((s) => s.setProject);
  const type = useGraphPanelStore((s) => s.type);
  const setType = useGraphPanelStore((s) => s.setType);
  const query = useGraphPanelStore((s) => s.query);
  const setQuery = useGraphPanelStore((s) => s.setQuery);
  const onlyLinked = useGraphPanelStore((s) => s.onlyLinked);
  const setOnlyLinked = useGraphPanelStore((s) => s.setOnlyLinked);
  const collapseAll = useGraphPanelStore((s) => s.collapseAll);

  const graphs = useHarnessGraphStore((s) => s.graphs);
  const ensureGraph = useHarnessGraphStore((s) => s.ensureGraph);
  const syncGraph = useHarnessGraphStore((s) => s.syncGraph);
  const harnessVersion = useHarnessStore((s) => s.version);

  // Активный документ задаёт репозиторий панели: открыли файл из другого
  // репозитория — граф переключился на него.
  useEffect(() => {
    if (!activePath) return;
    const owner = repos
      .filter((r) => repoRelativePath(r, activePath))
      .sort((a, b) => b.length - a.length)[0];
    if (owner) setRepoRoot(owner);
  }, [activePath, repos, setRepoRoot]);

  // Выбранный репозиторий: из стора, иначе первый найденный в workspace.
  const activeRepo = useMemo(() => {
    if (repoRoot && repos.some((r) => normalizePath(r) === normalizePath(repoRoot))) {
      return repoRoot;
    }
    return repos[0] ?? null;
  }, [repoRoot, repos]);

  useEffect(() => {
    if (!activeRepo) return;
    void ensureGraph(activeRepo);
  }, [activeRepo, ensureGraph]);

  // Реестр обновился (watcher) — пересчитываем граф.
  useEffect(() => {
    if (!activeRepo) return;
    syncGraph(activeRepo);
  }, [activeRepo, harnessVersion, syncGraph]);

  const graph = activeRepo ? graphs[normalizePath(activeRepo)]?.graph : undefined;
  const projects = useMemo(() => (graph ? listProjects(graph) : []), [graph]);
  const types = useMemo(() => (graph ? listTypes(graph) : []), [graph]);

  if (repos.length === 0) {
    return (
      <div className="graph-panel">
        <div className="graph-empty">
          <Text variant="body-2" as="div">{t("harness.graph.noRepo")}</Text>
          <Text variant="caption-2" color="secondary" as="div">
            {t("harness.graph.noRepoHint")}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-panel">
      <div className="graph-panel__controls">
        {repos.length > 1 && (
          <Select
            size="s"
            className="graph-panel__control"
            value={[activeRepo ?? ""]}
            onUpdate={(v) => v[0] && setRepoRoot(v[0])}
            options={repos.map((r) => ({value: r, content: repoName(r)}))}
          />
        )}

        <Select
          size="s"
          className="graph-panel__control"
          value={[project ?? FILTER_ALL]}
          onUpdate={(v) => setProject(v[0] === FILTER_ALL ? null : (v[0] ?? null))}
          options={[
            {value: FILTER_ALL, content: t("harness.graph.allProjects")},
            ...projects.map((p) => ({value: p, content: p})),
          ]}
        />

        <Select
          size="s"
          className="graph-panel__control"
          value={[type ?? FILTER_ALL]}
          onUpdate={(v) => setType(v[0] === FILTER_ALL ? null : (v[0] ?? null))}
          options={[
            {value: FILTER_ALL, content: t("harness.graph.allTypes")},
            ...types.map((x) => ({value: x, content: x})),
          ]}
        />

        <TextInput
          size="s"
          className="graph-panel__control"
          value={query}
          onUpdate={setQuery}
          placeholder={t("harness.graph.search")}
          startContent={<Icon data={Magnifier} size={14} />}
        />

        <div className="graph-panel__switch">
          <Switch
            size="s"
            checked={onlyLinked}
            onUpdate={(v) => setOnlyLinked(v)}
            title={t("harness.graph.onlyLinked")}
          />
          <Text variant="body-2">{t("harness.graph.onlyLinked")}</Text>
        </div>

        <div className="graph-panel__actions">
          <Tooltip content={t("harness.graph.refresh")}>
            <Button
              view="flat"
              size="s"
              disabled={!activeRepo}
              onClick={() => activeRepo && void ensureGraph(activeRepo)}
            >
              <Icon data={ArrowRotateRight} size={14} />
            </Button>
          </Tooltip>
          <Tooltip content={t("harness.graph.collapseAll")}>
            <Button view="flat" size="s" onClick={collapseAll}>
              <Icon data={ChevronsCollapseVertical} size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="graph-panel__demo">
        <div className="graph-panel__demo-head">
          <SegmentedRadioGroup
            size="s"
            value={view}
            onUpdate={(v) => setView(v as GraphView)}
          >
            <SegmentedRadioGroup.Option value="around" content={t("harness.graph.around")} />
            <SegmentedRadioGroup.Option value="overview" content={t("harness.graph.overview")} />
          </SegmentedRadioGroup>
          {!graph && <Loader size="s" />}
        </div>
        <div className="graph-panel__demo-body">
          {view === "around" ? (
            <GraphAround repoRoot={activeRepo} graph={graph} />
          ) : (
            <GraphOverview repoRoot={activeRepo} graph={graph} />
          )}
        </div>
      </div>
    </div>
  );
}
