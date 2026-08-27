import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useFileActions} from "../../hooks/useFileActions";
import {getFileName, replaceExtension} from "../../lib/utils";

/** Подтверждение конвертации офисного документа в Markdown-версию. */
export function ConvertModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingConvertPath);
  const {confirmConvert, cancelConvert} = useFileActions();

  if (!pendingPath) return null;
  const name = getFileName(pendingPath);
  const target = getFileName(replaceExtension(pendingPath, "md"));

  return (
    <Modal open onOpenChange={(open) => !open && cancelConvert()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.convertTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.convertText", {name, target})}
        </Text>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void confirmConvert()}>
            {t("modal.convertConfirm")}
          </Button>
          <Button view="flat" onClick={cancelConvert}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
