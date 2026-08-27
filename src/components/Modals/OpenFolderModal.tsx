import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useEditorStore} from "../../store/editorStore";
import {useFileActions} from "../../hooks/useFileActions";

/** Открытие новой папки при наличии несохранённых вкладок. */
export function OpenFolderModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingOpenFolderPath);
  const tabs = useEditorStore((s) => s.tabs);
  const {confirmOpenFolder, cancelOpenFolder} = useFileActions();

  if (!pendingPath) return null;
  const dirty = tabs.filter((tab) => tab.dirty);

  return (
    <Modal open onOpenChange={(open) => !open && cancelOpenFolder()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.openFolderTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.openFolderText")}
        </Text>
        <ul className="modal-file-list">
          {dirty.map((tab) => (
            <li key={tab.path}>{tab.name}</li>
          ))}
        </ul>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void confirmOpenFolder(true)}>
            {t("modal.saveAll")}
          </Button>
          <Button view="outlined" onClick={() => confirmOpenFolder(false)}>
            {t("modal.discard")}
          </Button>
          <Button view="flat" onClick={cancelOpenFolder}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
