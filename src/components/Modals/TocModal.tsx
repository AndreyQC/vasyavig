import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useMarkdownTools} from "../../hooks/useMarkdownTools";

/** Выбор «заменить существующий блок / вставить новый» при генерации оглавления. */
export function TocModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingTocPath);
  const {tocReplace, tocInsert, tocCancel} = useMarkdownTools(pendingPath ?? "");

  if (!pendingPath) return null;

  return (
    <Modal open onOpenChange={(open) => !open && tocCancel()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.tocTitle")}</Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.tocText")}
        </Text>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={tocReplace}>
            {t("modal.tocReplace")}
          </Button>
          <Button view="outlined" onClick={tocInsert}>
            {t("modal.tocInsert")}
          </Button>
          <Button view="flat" onClick={tocCancel}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
