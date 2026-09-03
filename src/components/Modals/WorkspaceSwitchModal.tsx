import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {useEditorStore} from "../../store/editorStore";
import {useFileActions} from "../../hooks/useFileActions";

/**
 * Подтверждение замены состава workspace при наличии несохранённых вкладок:
 * «Открыть workspace» / «Новый workspace» (спека workspace-file).
 */
export function WorkspaceSwitchModal() {
  const {t} = useTranslation();
  const pendingOpenPath = useUiStore((s) => s.pendingOpenWorkspacePath);
  const pendingNewPath = useUiStore((s) => s.pendingNewWorkspacePath);
  const tabs = useEditorStore((s) => s.tabs);
  const {confirmOpenWorkspace, cancelOpenWorkspace, confirmNewWorkspace, cancelNewWorkspace} =
    useFileActions();

  const mode = pendingOpenPath ? ("open" as const) : pendingNewPath ? ("new" as const) : null;
  if (!mode) return null;
  const dirty = tabs.filter((tab) => tab.dirty);
  const onConfirm = (saveAll: boolean) =>
    mode === "open" ? confirmOpenWorkspace(saveAll) : confirmNewWorkspace(saveAll);
  const onCancel = mode === "open" ? cancelOpenWorkspace : cancelNewWorkspace;

  return (
    <Modal open onOpenChange={(open) => !open && onCancel()}>
      <div className="save-confirm-modal">
        <Text variant="header-2">
          {t(mode === "open" ? "modal.openWorkspaceTitle" : "modal.newWorkspaceTitle")}
        </Text>
        <Text variant="body-2" as="div" style={{marginTop: 12}}>
          {t("modal.switchWorkspaceText")}
        </Text>
        <ul className="modal-file-list">
          {dirty.map((tab) => (
            <li key={tab.path}>{tab.name}</li>
          ))}
        </ul>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={() => void onConfirm(true)}>
            {t("modal.saveAll")}
          </Button>
          <Button view="outlined" onClick={() => void onConfirm(false)}>
            {t("modal.discard")}
          </Button>
          <Button view="flat" onClick={onCancel}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
