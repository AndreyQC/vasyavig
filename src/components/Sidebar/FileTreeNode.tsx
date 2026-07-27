import {useMemo} from "react";
import {Icon, Text} from "@gravity-ui/uikit";
import {ChevronDown, ChevronRight, FileText, Folder} from "@gravity-ui/icons";
import {useFileStore} from "../../store/fileStore";
import type {FileNode} from "../../types";

interface Props {
  node: FileNode;
  depth: number;
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

export function FileTreeNode({node, depth}: Props) {
  const isExpanded = useFileStore((s) => s.expandedPaths[node.path] === true);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const showHidden = useFileStore((s) => s.showHidden);
  const toggleDir = useFileStore((s) => s.toggleDir);
  const openFile = useFileStore((s) => s.openFile);

  const children = node.children;
  const visibleChildren = useMemo(
    () => (showHidden ? (children ?? []) : (children ?? []).filter((c) => !isHiddenName(c.name))),
    [children, showHidden],
  );

  if (!showHidden && isHiddenName(node.name)) {
    return null;
  }

  const isActive = activeFilePath === node.path;

  const handleClick = () => {
    if (node.isDir) {
      toggleDir(node.path);
    } else {
      openFile(node.path);
    }
  };

  return (
    <div className="file-tree-node">
      <button
        type="button"
        className={`file-tree-node__row${isActive ? " file-tree-node__row--active" : ""}`}
        style={{paddingLeft: 8 + depth * 16}}
        onClick={handleClick}
        title={node.path}
      >
        <span className="file-tree-node__chevron">
          {node.isDir && <Icon data={isExpanded ? ChevronDown : ChevronRight} size={14} />}
        </span>
        <Icon data={node.isDir ? Folder : FileText} size={14} />
        <Text variant="body-1" ellipsis className="file-tree-node__name">
          {node.name}
        </Text>
      </button>
      {node.isDir && isExpanded && (
        <div className="file-tree-node__children">
          {visibleChildren.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
