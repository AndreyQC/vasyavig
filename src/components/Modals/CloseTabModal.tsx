import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useEditorStore} from "../../store/editorStore";
import {useFileActions} from "../../hooks/useFileActions";

/** Подтверждение закрытия вкладки с несохранёнными изменениями. */
export function CloseTabModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingClosePath);
  const tabs = useEditorStore((s) => s.tabs);
  const {confirmCloseTab, cancelCloseTab} = useFileActions();

  if (!pendingPath) return null;
  const name = tabs.find((tab) => tab.path === pendingPath)?.name ?? pendingPath;

  return (
    <Modal open onOpenChange={(open) => !open && cancelCloseTab()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.closeTabTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.closeTabText", {name})}
        </Text>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void confirmCloseTab(true)}>
            {t("modal.save")}
          </Button>
          <Button view="outlined" onClick={() => confirmCloseTab(false)}>
            {t("modal.dontSave")}
          </Button>
          <Button view="flat" onClick={cancelCloseTab}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
