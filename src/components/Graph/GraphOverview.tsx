import {useMemo, type ReactNode} from "react";
import {Icon, Text} from "@gravity-ui/uikit";
import {ChevronDown, ChevronRight, Link} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useGraphPanelStore} from "../../store/graphPanelStore";
import {buildForest, type DocumentGraph, type GraphTreeNode} from "../../lib/harnessGraph";
import {openGraphDocument} from "./graphActions";

interface Props {
  repoRoot: string | null;
  graph: DocumentGraph | undefined;
}

/**
 * Обзор репозитория (план 20261028_001, D5b/D8): раскрывающееся дерево по
 * порождённым (`based_on`) с фильтрами проекта/типа и поиском. Документы без
 * связей по умолчанию скрыты (Q5) — они включаются переключателем.
 * Рендерятся только раскрытые ветки: реестр — 1814 записей.
 */
export function GraphOverview({repoRoot, graph}: Props) {
  const {t} = useTranslation();
  const project = useGraphPanelStore((s) => s.project);
  const type = useGraphPanelStore((s) => s.type);
  const query = useGraphPanelStore((s) => s.query);
  const onlyLinked = useGraphPanelStore((s) => s.onlyLinked);
  const expanded = useGraphPanelStore((s) => s.expanded);
  const toggleExpanded = useGraphPanelStore((s) => s.toggleExpanded);

  const forest = useMemo(() => {
    if (!graph) return [];
    return buildForest(graph, {project, type, query, onlyLinked});
  }, [graph, project, type, query, onlyLinked]);

  if (!repoRoot || !graph) {
    return (
      <div className="graph-empty">
        <Text variant="body-2" as="div">{t("harness.graph.noRepo")}</Text>
      </div>
    );
  }

  if (forest.length === 0) {
    return (
      <div className="graph-empty">
        <Text variant="body-2" as="div">{t("harness.graph.emptyOverview")}</Text>
        <Text variant="caption-2" color="secondary" as="div">
          {t("harness.graph.emptyOverviewHint")}
        </Text>
      </div>
    );
  }

  const renderNode = (item: GraphTreeNode, depth: number): ReactNode => {
    const hasChildren = item.children.length > 0;
    const isOpen = expanded[item.node.ulid] === true;
    return (
      <div key={item.node.ulid} className="graph-tree__branch">
        <div
          className="graph-tree__row"
          style={{paddingLeft: 8 + depth * 14}}
          title={item.node.path}
        >
          <button
            type="button"
            className="graph-tree__chevron"
            onClick={() => hasChildren && toggleExpanded(item.node.ulid)}
            aria-label={isOpen ? t("harness.graph.collapseNode") : t("harness.graph.expandNode")}
            disabled={!hasChildren}
          >
            {hasChildren && <Icon data={isOpen ? ChevronDown : ChevronRight} size={14} />}
          </button>
          <button
            type="button"
            className="graph-tree__label"
            onClick={() => openGraphDocument(repoRoot, item.node)}
          >
            <span className="graph-tree__type">{item.node.type}</span>
            <Text variant="body-2" ellipsis className="graph-tree__title">
              {item.node.title}
            </Text>
          </button>
          {hasChildren && !isOpen && (
            <span className="graph-tree__kids">{item.children.length}</span>
          )}
          {item.relatedCount > 0 && (
            <span className="graph-tree__related" title={t("harness.graph.related")}>
              <Icon data={Link} size={12} />
              {item.relatedCount}
            </span>
          )}
        </div>
        {isOpen && hasChildren && (
          <div className="graph-tree__children">
            {item.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <div className="graph-tree">{forest.map((item) => renderNode(item, 0))}</div>;
}
