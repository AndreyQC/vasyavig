import {useEffect, useState} from "react";
import {Button, Modal, Text, TextInput} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useFileStore} from "../../store/fileStore";
import {ALIAS_MAX_LENGTH} from "../../lib/workspaceFile";
import {getFileName} from "../../lib/utils";

/**
 * Псевдоним корня workspace (план 20261028_002, D2): ввод или очистка alias.
 * Тултип плашки всегда показывает реальное имя и путь, поэтому псевдоним
 * безопасен; пустое поле + «Сохранить» эквивалентны «Очистить».
 */
export function AliasModal() {
  const {t} = useTranslation();
  const pendingPath = useUiStore((s) => s.pendingAliasPath);
  const currentAlias = useFileStore((s) =>
    pendingPath ? s.roots.find((r) => r.path === pendingPath)?.alias : undefined,
  );
  const [alias, setAlias] = useState("");

  useEffect(() => {
    setAlias(pendingPath ? (currentAlias ?? "") : "");
    // currentAlias сознательно не в зависимостях: значение читается один раз
    // на открытие модалки, живое редактирование не должно перетирать ввод
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPath]);

  if (!pendingPath) return null;

  const close = () => useUiStore.getState().setPendingAliasPath(null);

  const apply = () => {
    useFileStore.getState().setRootAlias(pendingPath, alias);
    close();
  };

  return (
    <Modal open onOpenChange={(open) => !open && close()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">{t("modal.aliasTitle")}</Text>
        <Text variant="body-2" color="secondary">
          {t("modal.aliasText", {name: getFileName(pendingPath)})}
        </Text>
        <div style={{marginTop: 12}}>
          <TextInput
            value={alias}
            onUpdate={setAlias}
            controlProps={{maxLength: ALIAS_MAX_LENGTH}}
            autoFocus
          />
        </div>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={apply}>
            {t("modal.aliasApply")}
          </Button>
          <Button view="flat" onClick={() => {
            useFileStore.getState().setRootAlias(pendingPath, null);
            close();
          }}>
            {t("modal.aliasClear")}
          </Button>
          <Button view="flat" onClick={close}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
