import {useEffect, useMemo, useState} from "react";
import type {CSSProperties} from "react";
import {Button, Icon, Text} from "@gravity-ui/uikit";
import {GraphNode, Xmark} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useFileStore} from "../../store/fileStore";
import {useUiStore} from "../../store/uiStore";
import {useFileActions} from "../../hooks/useFileActions";
import {resolveRoot} from "../../lib/roots";
import type {RootColor} from "../../lib/rootColors";
import {HARNESS_ICON} from "../harnessIcon";

interface TabMenuState {
  x: number;
  y: number;
  path: string;
}

/**
 * Горизонтальные табы открытых файлов: точка ● у «грязных», крестик закрытия.
 * Фон вкладки — тинт цвета корня файла (вне корней — нейтральный серый),
 * активная вкладка — широкая рамка насыщенного цвета корня (спека folder-colors).
 * Цвет всегда производен от (путь → корень), в табах не хранится (design D2).
 * Файлы harness-репозитория помечены значком (план 20261027_005, D10).
 *
 * Вкладка «Граф» (план 20261028_001, Q1) — не файл, а панель в главной
 * области: своя вкладка в той же полосе, закрывается крестиком.
 */
export function EditorTabs() {
  const {t} = useTranslation();
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const roots = useFileStore((s) => s.roots);
  const graphTabOpen = useUiStore((s) => s.graphTabOpen);
  const mainPane = useUiStore((s) => s.mainPane);
  const openGraphTab = useUiStore((s) => s.openGraphTab);
  const closeGraphTab = useUiStore((s) => s.closeGraphTab);
  const {requestCloseTab} = useFileActions();
  const [menu, setMenu] = useState<TabMenuState | null>(null);

  // Закрытие контекстного меню вкладки по клику вне и по Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /**
   * Закрыть набор вкладок (план 20261028_004, D2): чистые закрываются сразу,
   * первая dirty — через промпт; остальные dirty после подтверждения
   * (повторный вызов команды). Несколько промптов подряд не наслаиваем.
   */
  const closeMany = (targets: string[]) => {
    const editor = useEditorStore.getState();
    let firstDirtyAsked = false;
    for (const path of targets) {
      const tab = editor.tabs.find((t) => t.path === path);
      if (!tab) continue;
      if (tab.dirty && !firstDirtyAsked) {
        firstDirtyAsked = true;
        requestCloseTab(path);
      } else if (!tab.dirty) {
        editor.closeTab(path);
      }
    }
  };

  // производная коллекция — useMemo, не селектор (урок §3)
  const tabRoots = useMemo(() => {
    const map = new Map<string, {color: RootColor; harness: boolean}>();
    for (const tab of tabs) {
      const root = resolveRoot(tab.path, roots);
      map.set(tab.path, {color: root?.color ?? "neutral", harness: root?.harness ?? false});
    }
    return map;
  }, [tabs, roots]);

  if (tabs.length === 0 && !graphTabOpen) return null;

  return (
    <div className="editor-tabs">
      {tabs.map((tab) => {
        const info = tabRoots.get(tab.path) ?? {color: "neutral" as RootColor, harness: false};
        const style = {
          "--tint": `var(--root-tint-${info.color})`,
          "--accent": `var(--root-accent-${info.color})`,
        } as CSSProperties;
        const isActive = mainPane === "doc" && tab.path === activePath;
        return (
          <div
            key={tab.path}
            className={`editor-tabs__tab${isActive ? " editor-tabs__tab--active" : ""}`}
            style={style}
            title={tab.path}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                requestCloseTab(tab.path);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({x: e.clientX, y: e.clientY, path: tab.path});
            }}
          >
            <button
              type="button"
              className={`editor-tabs__label${tab.preview ? " editor-tabs__label--preview" : ""}`}
              onClick={() => {
                setActiveTab(tab.path);
                useUiStore.getState().setMainPane("doc");
              }}
            >
              {info.harness && (
                <span className="editor-tabs__harness" aria-label={t("sidebar.harnessRepo")}>
                  <Icon data={HARNESS_ICON} size={12} />
                </span>
              )}
              <Text variant="body-1" ellipsis>
                {tab.name}
              </Text>
              {tab.dirty && <span className="editor-tabs__dirty">●</span>}
            </button>
            <Button
              view="flat"
              size="s"
              className="editor-tabs__close"
              onClick={() => requestCloseTab(tab.path)}
              title={t("tabs.close")}
            >
              <Icon data={Xmark} size={12} />
            </Button>
          </div>
        );
      })}
      {graphTabOpen && (
        <div
          className={`editor-tabs__tab editor-tabs__tab--graph${
            mainPane === "graph" ? " editor-tabs__tab--active" : ""
          }`}
          style={{"--accent": "var(--g-color-line-brand)"} as CSSProperties}
          title={t("harness.graph.tabTitle")}
        >
          <button type="button" className="editor-tabs__label" onClick={openGraphTab}>
            <span className="editor-tabs__harness" aria-label={t("harness.graph.tabTitle")}>
              <Icon data={GraphNode} size={12} />
            </span>
            <Text variant="body-1" ellipsis>
              {t("harness.graph.tab")}
            </Text>
          </button>
          <Button
            view="flat"
            size="s"
            className="editor-tabs__close"
            onClick={closeGraphTab}
            title={t("tabs.close")}
          >
            <Icon data={Xmark} size={12} />
          </Button>
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
              requestCloseTab(menu.path);
            }}
          >
            {t("tabs.close")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            disabled={tabs.length <= 1}
            onClick={() => {
              setMenu(null);
              closeMany(tabs.filter((t2) => t2.path !== menu.path).map((t2) => t2.path));
            }}
          >
            {t("tabs.closeOthers")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            disabled={tabs.findIndex((t2) => t2.path === menu.path) >= tabs.length - 1}
            onClick={() => {
              setMenu(null);
              const index = tabs.findIndex((t2) => t2.path === menu.path);
              closeMany(tabs.slice(index + 1).map((t2) => t2.path));
            }}
          >
            {t("tabs.closeRight")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            onClick={() => {
              setMenu(null);
              closeMany(tabs.map((t2) => t2.path));
            }}
          >
            {t("tabs.closeAll")}
          </button>
        </div>
      )}
    </div>
  );
}
