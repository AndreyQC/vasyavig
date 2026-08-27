import {useEffect, useMemo, useState} from "react";
import {Icon, Text} from "@gravity-ui/uikit";
import {ChevronDown, ChevronRight, FileText, Folder} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getParentDir} from "../../lib/utils";
import type {FileNode} from "../../types";

interface Props {
  node: FileNode;
  depth: number;
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

interface MenuState {
  x: number;
  y: number;
  node: FileNode;
}

export function FileTreeNode({node, depth}: Props) {
  const {t} = useTranslation();
  const isExpanded = useFileStore((s) => s.expandedPaths[node.path] === true);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const showHidden = useFileStore((s) => s.showHidden);
  const toggleDir = useFileStore((s) => s.toggleDir);
  const openFile = useFileStore((s) => s.openFile);
  const selectDir = useFileStore((s) => s.selectDir);
  const {requestCreate, requestDelete, requestRename} = useFileActions();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const children = node.children;
  const visibleChildren = useMemo(
    () => (showHidden ? (children ?? []) : (children ?? []).filter((c) => !isHiddenName(c.name))),
    [children, showHidden],
  );

  // Закрытие контекстного меню по клику вне и по Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!showHidden && isHiddenName(node.name)) {
    return null;
  }

  const isActive = activeFilePath === node.path;

  const handleClick = () => {
    if (node.isDir) {
      toggleDir(node.path);
      selectDir(node.path);
    } else {
      openFile(node.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({x: e.clientX, y: e.clientY, node});
  };

  return (
    <div className="file-tree-node">
      <button
        type="button"
        className={`file-tree-node__row${isActive ? " file-tree-node__row--active" : ""}`}
        style={{paddingLeft: 8 + depth * 16}}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
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
      {menu && (
        <div
          className="file-tree-context-menu"
          style={{left: menu.x, top: menu.y}}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="file-tree-context-menu__item"
            onClick={() => {
              setMenu(null);
              requestCreate(menu.node.isDir ? menu.node.path : getParentDir(menu.node.path));
            }}
          >
            {t("sidebar.createFile")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            onClick={() => {
              setMenu(null);
              requestRename(menu.node.path);
            }}
          >
            {t("sidebar.rename")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item file-tree-context-menu__item--danger"
            onClick={() => {
              setMenu(null);
              requestDelete(menu.node.path);
            }}
          >
            {t("sidebar.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
