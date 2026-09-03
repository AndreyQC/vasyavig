import {useEffect, useRef, useState} from "react";
import {Button, Icon, Text, Tooltip} from "@gravity-ui/uikit";
import {ArrowRotateRight, Eye, EyeSlash, FilePlus, FolderPlus, Folders, ListUl, TrashBin} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {useFileActions} from "../../hooks/useFileActions";

/**
 * Шапка сайдбара — уровень workspace (design D8), закреплена над скроллом
 * дерева. «Добавить папку» + меню workspace (открыть/новый), ниже — действия
 * над деревом.
 */
export function SidebarHeader() {
  const {t} = useTranslation();
  const addFolder = useFileStore((s) => s.addFolder);
  const refreshTree = useFileStore((s) => s.refreshTree);
  const collapseAll = useFileStore((s) => s.collapseAll);
  const toggleShowHidden = useFileStore((s) => s.toggleShowHidden);
  const showHidden = useFileStore((s) => s.showHidden);
  const hasRoots = useFileStore((s) => s.roots.length > 0);
  const firstRootPath = useFileStore((s) => (s.roots.length > 0 ? s.roots[0].path : null));
  const activeDirPath = useFileStore((s) => s.activeDirPath);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const {requestCreate, requestDelete, requestOpenWorkspace, requestNewWorkspace} = useFileActions();

  const [wsMenu, setWsMenu] = useState<{x: number; y: number} | null>(null);
  const wsMenuBtnRef = useRef<HTMLButtonElement>(null);

  // Закрытие меню workspace по клику вне и по Escape.
  useEffect(() => {
    if (!wsMenu) return;
    const close = () => setWsMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWsMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [wsMenu]);

  const toggleWsMenu = () => {
    if (wsMenu) {
      setWsMenu(null);
      return;
    }
    const rect = wsMenuBtnRef.current?.getBoundingClientRect();
    setWsMenu({x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4});
  };

  const handleCreate = () => {
    const dir = activeDirPath ?? firstRootPath;
    if (dir) requestCreate(dir);
  };

  const handleDelete = () => {
    const target = activeFilePath ?? activeDirPath;
    if (target) requestDelete(target);
  };

  return (
    <div className="sidebar-header">
      <div className="sidebar-header__row">
        <Button view="outlined" className="sidebar-header__add" onClick={() => void addFolder()}>
          <Icon data={FolderPlus} />
          {t("sidebar.addFolder")}
        </Button>
        <Tooltip content={t("sidebar.workspaceMenu")}>
          <Button
            ref={wsMenuBtnRef}
            view={wsMenu ? "normal" : "flat"}
            size="m"
            onClick={toggleWsMenu}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Icon data={Folders} />
          </Button>
        </Tooltip>
      </div>
      <div className="sidebar-header__actions">
        <Tooltip content={t("sidebar.createFile")}>
          <Button view="flat" size="m" disabled={!hasRoots} onClick={handleCreate}>
            <Icon data={FilePlus} />
          </Button>
        </Tooltip>
        <Tooltip content={t("sidebar.delete")}>
          <Button view="flat" size="m" disabled={!activeFilePath && !activeDirPath} onClick={handleDelete}>
            <Icon data={TrashBin} />
          </Button>
        </Tooltip>
        <Tooltip content={t("sidebar.refresh")}>
          <Button view="flat" size="m" disabled={!hasRoots} onClick={() => void refreshTree()}>
            <Icon data={ArrowRotateRight} />
          </Button>
        </Tooltip>
        <Tooltip content={t("sidebar.collapseAll")}>
          <Button view="flat" size="m" disabled={!hasRoots} onClick={collapseAll}>
            <Icon data={ListUl} />
          </Button>
        </Tooltip>
        <Tooltip content={t(showHidden ? "sidebar.hideHidden" : "sidebar.showHidden")}>
          <Button view={showHidden ? "normal" : "flat"} size="m" onClick={toggleShowHidden}>
            <Icon data={showHidden ? Eye : EyeSlash} />
          </Button>
        </Tooltip>
      </div>
      {!hasRoots && (
        <Text variant="caption-2" color="secondary">
          {t("sidebar.emptyWorkspaceHint")}
        </Text>
      )}
      {wsMenu && (
        <div
          className="file-tree-context-menu"
          style={{left: wsMenu.x, top: wsMenu.y}}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="file-tree-context-menu__item"
            onClick={() => {
              setWsMenu(null);
              void requestOpenWorkspace();
            }}
          >
            {t("sidebar.openWorkspace")}
          </button>
          <button
            type="button"
            className="file-tree-context-menu__item"
            onClick={() => {
              setWsMenu(null);
              void requestNewWorkspace();
            }}
          >
            {t("sidebar.newWorkspace")}
          </button>
        </div>
      )}
    </div>
  );
}
