import {useEffect, useState} from "react";
import {Button, Modal, Text, TextInput} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useFileActions} from "../../hooks/useFileActions";

/** Создание нового файла: ввод имени (по умолчанию .md) в выбранном каталоге. */
export function CreateFileModal() {
  const {t} = useTranslation();
  const pendingDir = useUiStore((s) => s.pendingCreateDir);
  const {confirmCreate, cancelCreate} = useFileActions();
  const [name, setName] = useState("new-file.md");

  useEffect(() => {
    if (pendingDir) setName("new-file.md");
  }, [pendingDir]);

  if (!pendingDir) return null;

  return (
    <Modal open onOpenChange={(open) => !open && cancelCreate()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.createTitle")}</Text>
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
