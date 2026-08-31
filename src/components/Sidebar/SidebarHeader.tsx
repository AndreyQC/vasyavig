import {Button, Icon, Text, Tooltip} from "@gravity-ui/uikit";
import {ArrowRotateRight, Eye, EyeSlash, FilePlus, FolderOpen, ListUl, TrashBin} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getFileName} from "../../lib/utils";

export function SidebarHeader() {
  const {t} = useTranslation();
  const openFolder = useFileStore((s) => s.openFolder);
  const refreshTree = useFileStore((s) => s.refreshTree);
  const collapseAll = useFileStore((s) => s.collapseAll);
  const toggleShowHidden = useFileStore((s) => s.toggleShowHidden);
  const showHidden = useFileStore((s) => s.showHidden);
  const hasRoot = useFileStore((s) => s.rootPath !== null);
  const rootPath = useFileStore((s) => s.rootPath);
  const activeDirPath = useFileStore((s) => s.activeDirPath);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const {requestCreate, requestDelete} = useFileActions();

  const handleCreate = () => {
    const dir = activeDirPath ?? useFileStore.getState().rootPath;
    if (dir) requestCreate(dir);
  };

  const handleDelete = () => {
    const target = activeFilePath ?? activeDirPath;
    if (target) requestDelete(target);
  };

  return (
    <div className="sidebar-header">
      {rootPath && (
        <div className="sidebar-header__current-dir">
          <Text variant="caption-2" color="secondary">
            {t("sidebar.currentDirectory")}
          </Text>
          <Tooltip content={rootPath}>
            <Text variant="body-2" ellipsis className="sidebar-header__current-dir-name">
              {getFileName(rootPath)}
            </Text>
          </Tooltip>
        </div>
      )}
      <Button view="outlined" width="max" onClick={openFolder}>
        <Icon data={FolderOpen} />
        {t("sidebar.openFolder")}
      </Button>
      <div className="sidebar-header__actions">
        <Tooltip content={t("sidebar.createFile")}>
          <Button view="flat" size="m" disabled={!hasRoot} onClick={handleCreate}>
            <Icon data={FilePlus} />
          </Button>
        </Tooltip>
        <Tooltip content={t("sidebar.delete")}>
          <Button view="flat" size="m" disabled={!activeFilePath && !activeDirPath} onClick={handleDelete}>
            <Icon data={TrashBin} />
          </Button>
        </Tooltip>
        <Tooltip content={t("sidebar.refresh")}>
          <Button view="flat" size="m" disabled={!hasRoot} onClick={refreshTree}>
            <Icon data={ArrowRotateRight} />
          </Button>
        </Tooltip>
        <Tooltip content={t("sidebar.collapseAll")}>
          <Button view="flat" size="m" disabled={!hasRoot} onClick={collapseAll}>
            <Icon data={ListUl} />
          </Button>
        </Tooltip>
        <Tooltip content={t(showHidden ? "sidebar.hideHidden" : "sidebar.showHidden")}>
          <Button view={showHidden ? "normal" : "flat"} size="m" onClick={toggleShowHidden}>
            <Icon data={showHidden ? Eye : EyeSlash} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
