import {useEffect, useState} from "react";
import {Button, Modal, Text, TextInput} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getFileName} from "../../lib/utils";

/** Переименование файла/папки: ввод нового имени. */
export function RenameModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingRenamePath);
  const {confirmRename, cancelRename} = useFileActions();
  const [name, setName] = useState("");

  useEffect(() => {
    if (pendingPath) setName(getFileName(pendingPath));
  }, [pendingPath]);

  if (!pendingPath) return null;

  return (
    <Modal open onOpenChange={(open) => !open && cancelRename()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.renameTitle")}</Text>
        <div style={{marginTop: 12}}>
          <TextInput value={name} onUpdate={setName} autoFocus />
        </div>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void confirmRename(name)}>
            {t("modal.renameConfirm")}
          </Button>
          <Button view="flat" onClick={cancelRename}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
