import {useEffect, useState} from "react";
import type {CSSProperties} from "react";
import {Icon, Loader, Text, Tooltip} from "@gravity-ui/uikit";
import {Palette, TrashBin} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getFileName} from "../../lib/utils";
import {ROOT_PALETTE, type RootInfo} from "../../lib/rootColors";
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
 * Контекст-меню заголовка: сменить цвет / убрать из workspace.
 */
export function RootSection({root}: Props) {
  const {t} = useTranslation();
  const tree = useFileStore((s) => s.trees[root.path]);
  const setRootColor = useFileStore((s) => s.setRootColor);
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

  return (
    <section className="root-section" style={style}>
      <div
        className="root-section__header"
        title={root.path}
        onContextMenu={(e) => {
          e.preventDefault();
          setPaletteOpen(false);
          setMenu({x: e.clientX, y: e.clientY});
        }}
      >
        <span className="root-section__chip" />
        <Text variant="subheader-3" ellipsis className="root-section__name">
          {getFileName(root.path)}
        </Text>
        <Tooltip content={t("sidebar.changeColor")}>
          <button
            type="button"
            className="root-section__icon-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
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
            onClick={() => {
              setMenu(null);
              void requestRemoveRoot(root.path);
            }}
          >
            <Icon data={TrashBin} size={14} />
          </button>
        </Tooltip>
      </div>
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
        <Loader size="s" className="root-section__loader" />
      ) : (
        <div className="root-section__tree">
          {tree.map((node) => (
            <FileTreeNode key={node.path} node={node} depth={0} />
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
