import {useMemo, type ReactNode} from "react";
import {Icon, Text} from "@gravity-ui/uikit";
import {ArrowUpLeft, ArrowUpRight, Bars, Link} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {repoRelativePath} from "../../lib/harnessIndex";
import {neighborsOf, type DocumentGraph, type DocumentNode, type RelatedDirection} from "../../lib/harnessGraph";
import {openGraphDocument} from "./graphActions";

interface Props {
  repoRoot: string | null;
  graph: DocumentGraph | undefined;
}

/**
 * «Вокруг документа» (план 20261028_001, D5a): основания (`based_on`),
 * порождённые документы и связанные (`related`, симметрично — D4) для
 * документа активной вкладки. Каждый узел открывается вкладкой.
 */
export function GraphAround({repoRoot, graph}: Props) {
  const {t} = useTranslation();
  const activePath = useEditorStore((s) => s.activePath);

  const node = useMemo<DocumentNode | undefined>(() => {
    if (!repoRoot || !graph || !activePath) return undefined;
    const rel = repoRelativePath(repoRoot, activePath);
    if (!rel) return undefined;
    const ulid = graph.byPath[rel];
    return ulid ? graph.nodes[ulid] : undefined;
  }, [repoRoot, graph, activePath]);

  if (!repoRoot || !graph) {
    return (
      <div className="graph-empty">
        <Icon data={Bars} size={18} />
        <Text variant="body-2" as="div">{t("harness.graph.noRepo")}</Text>
      </div>
    );
  }

  if (!activePath) {
    return (
      <div className="graph-empty">
        <Text variant="body-2" as="div">{t("harness.graph.noCurrentDoc")}</Text>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="graph-empty">
        <Text variant="body-2" as="div">{t("harness.graph.notInRegistry")}</Text>
        <Text variant="caption-2" color="secondary" as="div">{activePath}</Text>
      </div>
    );
  }

  const around = neighborsOf(graph, node.ulid);

  const renderRow = (target: DocumentNode, extra?: ReactNode) => (
    <button
      key={target.ulid}
      type="button"
      className="graph-node"
      title={target.path}
      onClick={() => openGraphDocument(repoRoot, target)}
    >
      <span className="graph-node__type">{target.type}</span>
      <Text variant="body-2" ellipsis className="graph-node__title">
        {target.title}
      </Text>
      {extra}
    </button>
  );

  const dirLabel: Record<RelatedDirection, string> = {
    out: t("harness.graph.dirOut"),
    in: t("harness.graph.dirIn"),
    both: t("harness.graph.dirBoth"),
  };

  const sections = [
    {key: "bases", title: t("harness.graph.bases"), nodes: around.bases},
    {key: "children", title: t("harness.graph.children"), nodes: around.children},
  ];

  return (
    <div className="graph-around">
      <div className="graph-around__current">
        <Text variant="caption-2" color="secondary" as="div">
          {t("harness.graph.currentDoc")}
        </Text>
        <Text variant="body-2" as="div">
          {node.title}
          <span className="graph-around__current-type"> · {node.type}</span>
        </Text>
        <Text variant="caption-2" color="secondary" ellipsis as="div" className="graph-around__path">
          {node.path}
        </Text>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="graph-section">
          <div className="graph-section__head">
            <Text variant="caption-2" color="secondary">
              {section.title}
            </Text>
            <span className="graph-section__count">{section.nodes.length}</span>
          </div>
          {section.nodes.length === 0 ? (
            <Text variant="caption-2" color="secondary" as="div" className="graph-section__empty">
              —
            </Text>
          ) : (
            section.nodes.map((n) => renderRow(n))
          )}
        </div>
      ))}

      <div className="graph-section">
        <div className="graph-section__head">
          <Text variant="caption-2" color="secondary">
            {t("harness.graph.related")}
          </Text>
          <span className="graph-section__count">{around.related.length}</span>
        </div>
        {around.related.length === 0 ? (
          <Text variant="caption-2" color="secondary" as="div" className="graph-section__empty">
            —
          </Text>
        ) : (
          around.related.map((link) =>
            renderRow(
              link.node,
              <span className={`graph-node__dir graph-node__dir--${link.direction}`}>
                <Icon
                  data={link.direction === "in" ? ArrowUpLeft : link.direction === "both" ? Link : ArrowUpRight}
                  size={12}
                />
                {dirLabel[link.direction]}
              </span>,
            ),
          )
        )}
      </div>
    </div>
  );
}
