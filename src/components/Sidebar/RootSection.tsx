import {useEffect, useState} from "react";
import type {CSSProperties} from "react";
import {Icon, Loader, Text, Tooltip} from "@gravity-ui/uikit";
import {ChevronDown, ChevronRight, Palette, TrashBin} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {useUiStore} from "../../store/uiStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getFileName} from "../../lib/utils";
import {ROOT_PALETTE, type RootInfo} from "../../lib/rootColors";
import {HARNESS_ICON} from "../harnessIcon";
import {FileTreeNode} from "./FileTreeNode";

interface Props {
  root: RootInfo;
}

interface MenuState {
  x: number;
  y: number;
}

/**
 * Секция дерева одного корня workspace (design D8): заголовок с именем и
 * цветовым chip'ом, фон секции — тинт цвета корня (спека folder-colors).
 * План 20261028_002: клик по заголовку сворачивает секцию в одну строку
 * (псевдоним/имя), в развёрнутой секции под именем виден полный путь;
 * контекст-меню — псевдоним, выше/ниже, цвет, убрать из workspace.
 */
export function RootSection({root}: Props) {
  const {t} = useTranslation();
  const tree = useFileStore((s) => s.trees[root.path]);
  const setRootColor = useFileStore((s) => s.setRootColor);
  const moveRoot = useFileStore((s) => s.moveRoot);
  const toggleRootCollapsed = useFileStore((s) => s.toggleRootCollapsed);
  const collapsed = useFileStore((s) => Boolean(s.collapsedRoots[root.path]));
  const index = useFileStore((s) => s.roots.findIndex((r) => r.path === root.path));
  const rootsCount = useFileStore((s) => s.roots.length);
  const setPendingAliasPath = useUiStore((s) => s.setPendingAliasPath);
  const {requestRemoveRoot} = useFileActions();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Закрытие контекстного меню/палитры по клику вне и по Escape.
  useEffect(() => {
    if (!menu && !paletteOpen) return;
    const close = () => {
      setMenu(null);
      setPaletteOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, paletteOpen]);

  const style = {
    "--tint": `var(--root-tint-${root.color})`,
    "--accent": `var(--root-accent-${root.color})`,
  } as CSSProperties;

  // Тултип плашки всегда показывает реальное имя и полный путь (D2), даже
  // когда показан псевдоним.
  const headerTitle = root.alias ? `${root.alias} — ${root.path}` : root.path;

  return (
    <section className={`root-section${collapsed ? " root-section--collapsed" : ""}`} style={style}>
      <div
        className="root-section__header"
        title={headerTitle}
        onClick={() => {
          setMenu(null);
          setPaletteOpen(false);
          toggleRootCollapsed(root.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setPaletteOpen(false);
          setMenu({x: e.clientX, y: e.clientY});
        }}
      >
        <span className="root-section__chip" />
        <Icon data={collapsed ? ChevronRight : ChevronDown} size={12} className="root-section__chevron" />
        {root.harness && (
          <Tooltip content={t("sidebar.harnessRepo")}>
            <span className="root-section__harness">
              <Icon data={HARNESS_ICON} size={14} />
            </span>
          </Tooltip>
        )}
        <Text variant="subheader-3" ellipsis className="root-section__name">
          {root.alias ?? getFileName(root.path)}
        </Text>
        <Tooltip content={t("sidebar.changeColor")}>
          <button
            type="button"
            className="root-section__icon-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMenu(null);
              setPaletteOpen((open) => !open);
            }}
          >
            <Icon data={Palette} size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t("sidebar.removeRoot")}>
          <button
            type="button"
            className="root-section__icon-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMenu(null);
              void requestRemoveRoot(root.path);
            }}
          >
            <Icon data={TrashBin} size={14} />
          </button>
        </Tooltip>
      </div>
      {!collapsed && (
        <Text variant="caption-2" color="secondary" ellipsis className="root-section__path">
          {root.path}
        </Text>
      )}
      {paletteOpen && (
        <div className="root-color-picker" onMouseDown={(e) => e.stopPropagation()}>
          {ROOT_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={`root-color-picker__swatch${color === root.color ? " root-color-picker__swatch--current" : ""}`}
              style={{"--accent": `var(--root-accent-${color})`} as CSSProperties}
              title={color}
              aria-label={t("sidebar.changeColor")}
              onClick={() => {
                setRootColor(root.path, color);
                setPaletteOpen(false);
              }}
            />
          ))}
        </div>
      )}
      {tree === undefined ? (
        collapsed ? null : (
          <Loader size="s" className="root-section__loader" />
        )
      ) : (
        !collapsed && (
          <div className="root-section__tree">
            {tree.map((node) => (
              <FileTreeNode key={node.path} node={node} depth={0} />
            ))}
          </div>
        )
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
              setPendingAliasPath(root.path);
            }}
          >
            {t("sidebar.setAlias")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            disabled={index <= 0}
            onClick={() => {
              setMenu(null);
              moveRoot(root.path, "up");
            }}
          >
            {t("sidebar.moveUp")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            disabled={index === -1 || index >= rootsCount - 1}
            onClick={() => {
              setMenu(null);
              moveRoot(root.path, "down");
            }}
          >
            {t("sidebar.moveDown")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            onClick={() => {
              setMenu(null);
              setPaletteOpen(true);
            }}
          >
            {t("sidebar.changeColor")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item file-tree-context-menu__item--danger"
            onClick={() => {
              setMenu(null);
              void requestRemoveRoot(root.path);
            }}
          >
            {t("sidebar.removeRoot")}
          </button>
        </div>
      )}
    </section>
  );
}
