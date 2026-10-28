import {useEffect, useState} from "react";
import {Button, Modal, Text, TextInput} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useFileActions} from "../../hooks/useFileActions";

/**
 * Создание файла или папки (план 20261028_004, D3): ввод имени в выбранном
 * каталоге; режим определяется pendingCreateKind из контекст-меню дерева.
 */
export function CreateFileModal() {
  const {t} = useTranslation();
  const pendingDir = useUiStore((s) => s.pendingCreateDir);
  const kind = useUiStore((s) => s.pendingCreateKind);
  const {confirmCreate, cancelCreate} = useFileActions();
  const [name, setName] = useState("new-file.md");

  useEffect(() => {
    if (pendingDir) setName(kind === "dir" ? "new-folder" : "new-file.md");
  }, [pendingDir, kind]);

  if (!pendingDir) return null;

  return (
    <Modal open onOpenChange={(open) => !open && cancelCreate()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{kind === "dir" ? t("modal.createDirTitle") : t("modal.createTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.createText", {dir: pendingDir})}
        </Text>
        <div style={{marginTop: 12}}>
          <TextInput value={name} onUpdate={setName} autoFocus />
        </div>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void confirmCreate(name)}>
            {t("modal.createConfirm")}
          </Button>
          <Button view="flat" onClick={cancelCreate}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
