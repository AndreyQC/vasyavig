import {Button, Icon, Tooltip} from "@gravity-ui/uikit";
import {ArrowRotateRight, Eye, EyeSlash, FolderOpen, ListUl} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";

export function SidebarHeader() {
  const {t} = useTranslation();
  const openFolder = useFileStore((s) => s.openFolder);
  const refreshTree = useFileStore((s) => s.refreshTree);
  const collapseAll = useFileStore((s) => s.collapseAll);
  const toggleShowHidden = useFileStore((s) => s.toggleShowHidden);
  const showHidden = useFileStore((s) => s.showHidden);
  const hasRoot = useFileStore((s) => s.rootPath !== null);

  return (
    <div className="sidebar-header">
      <Button view="outlined" width="max" onClick={openFolder}>
        <Icon data={FolderOpen} />
        {t("sidebar.openFolder")}
      </Button>
      <div className="sidebar-header__actions">
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
