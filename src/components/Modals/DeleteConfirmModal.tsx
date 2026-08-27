import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getFileName} from "../../lib/utils";

/** Подтверждение безвозвратного удаления файла/папки. */
export function DeleteConfirmModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingDeletePath);
  const {confirmDelete, cancelDelete} = useFileActions();

  if (!pendingPath) return null;
  const name = getFileName(pendingPath);

  return (
    <Modal open onOpenChange={(open) => !open && cancelDelete()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.deleteTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.deleteText", {name})}
        </Text>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void confirmDelete()}>
            {t("modal.deleteConfirm")}
          </Button>
          <Button view="flat" onClick={cancelDelete}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
