import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useEditorStore} from "../../store/editorStore";
import {useFileStore} from "../../store/fileStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getFileName} from "../../lib/utils";
import {pathsLosingRoot} from "../../lib/roots";
import {useMemo} from "react";

/** Удаление корня из workspace при наличии несохранённых вкладок его файлов. */
export function RemoveRootModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingRemoveRootPath);
  const tabs = useEditorStore((s) => s.tabs);
  const roots = useFileStore((s) => s.roots);
  const {confirmRemoveRoot, cancelRemoveRoot} = useFileActions();

  // производная коллекция — useMemo, не селектор (урок §3)
  const dirty = useMemo(() => {
    if (!pendingPath) return [];
    const losing = new Set(pathsLosingRoot(tabs.map((tab) => tab.path), roots, pendingPath));
    return tabs.filter((tab) => tab.dirty && losing.has(tab.path));
  }, [pendingPath, tabs, roots]);

  if (!pendingPath) return null;

  return (
    <Modal open onOpenChange={(open) => !open && cancelRemoveRoot()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.removeRootTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.removeRootText", {name: getFileName(pendingPath)})}
        </Text>
        <ul className="modal-file-list">
          {dirty.map((tab) => (
            <li key={tab.path}>{tab.name}</li>
          ))}
        </ul>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void confirmRemoveRoot(true)}>
            {t("modal.saveAll")}
          </Button>
          <Button view="outlined" onClick={() => void confirmRemoveRoot(false)}>
            {t("modal.discard")}
          </Button>
          <Button view="flat" onClick={cancelRemoveRoot}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
