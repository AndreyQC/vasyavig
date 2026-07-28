import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useEditorStore} from "../../store/editorStore";
import {getExtension, replaceExtension} from "../../lib/utils";
import {useSaveActions} from "../../hooks/useSaveActions";

/**
 * Предупреждение при смене формата md ↔ yfm через «Сохранить как» (идея §10.3).
 */
export function SaveConfirmModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingSaveAsPath);
  const activePath = useEditorStore((s) => s.activePath);
  const {confirmSaveAs, cancelSaveAs} = useSaveActions();

  if (!pendingPath || !activePath) return null;

  const oldExt = getExtension(activePath).toUpperCase();
  const newExt = getExtension(pendingPath).toUpperCase();

  return (
    <Modal open onOpenChange={(open) => !open && cancelSaveAs()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.formatTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.formatText", {oldExt: oldExt.toLowerCase(), newExt: newExt.toLowerCase()})}
        </Text>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => confirmSaveAs(pendingPath)}>
            {t("modal.saveAsExt", {ext: newExt})}
          </Button>
          <Button
            view="outlined"
            onClick={() => confirmSaveAs(replaceExtension(pendingPath, getExtension(activePath)))}
          >
            {t("modal.backToExt", {ext: oldExt})}
          </Button>
          <Button view="flat" onClick={cancelSaveAs}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
