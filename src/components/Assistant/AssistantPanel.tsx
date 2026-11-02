import {Button, Icon, Text, Tooltip} from "@gravity-ui/uikit";
import {ArrowRotateRight, FileArrowRight, Gear, Sparkles, Xmark} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useConfigStore} from "../../store/configStore";
import {useAssistantStore} from "../../store/assistantStore";
import {useFileStore} from "../../store/fileStore";
import {ModelSelector} from "./ModelSelector";
import {ModelSettingsModal} from "./ModelSettingsModal";
import "./Assistant.css";

/**
 * Панель ассистента справа (Phase 8.1): только шапка с селектором модели,
 * статус конфига и карточка текущей модели. Quick actions, findings и diff
 * появятся в 8.2–8.4; свободного чата в MVP-1 нет.
 */
export function AssistantPanel() {
  const {t} = useTranslation();
  const model = useConfigStore((s) => s.models[s.selectedModel] ?? null);
  const status = useConfigStore((s) => s.status);
  const configPath = useConfigStore((s) => s.configPath);
  const error = useConfigStore((s) => s.error);
  const reload = useConfigStore((s) => s.reload);
  const setPanelOpen = useAssistantStore((s) => s.setPanelOpen);
  const openSettings = useAssistantStore((s) => s.openSettings);

  const statusText =
    status === "ready"
      ? t("assistant.configStatusReady")
      : status === "missing"
        ? t("assistant.configStatusMissing")
        : status === "error"
          ? t("assistant.configStatusError")
          : status === "loading"
            ? t("assistant.configStatusLoading")
            : t("assistant.noWorkspace");

  const openConfig = () => {
    if (configPath) void useFileStore.getState().openFile(configPath);
  };

  return (
    <div className="assistant-panel">
      <div className="assistant-panel__header">
        <div className="assistant-panel__header-row">
          <div className="assistant-panel__title">
            <Icon data={Sparkles} size={16} />
            <Text variant="subheader-2">{t("assistant.title")}</Text>
          </div>
          <div className="assistant-panel__actions">
            <Tooltip content={t("assistant.settings")}>
              <span>
                <Button view="flat" size="s" onClick={() => openSettings()}>
                  <Icon data={Gear} size={16} />
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={t("assistant.close")}>
              <span>
                <Button view="flat" size="s" onClick={() => setPanelOpen(false)}>
                  <Icon data={Xmark} size={16} />
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
        <ModelSelector />
      </div>

      <div className="assistant-panel__body">
        {model ? (
          <div className="assistant-panel__model-card">
            <div className="assistant-panel__model-head">
              <Text variant="subheader-1">{model.label || model.model}</Text>
              <span className={`assistant-panel__scope assistant-panel__scope--${model.dataScope}`}>
                {t(`assistant.scope.${model.dataScope}`)}
              </span>
            </div>
            <Text variant="caption-2" color="secondary">
              {model.model}
            </Text>
            <Text variant="caption-2" color="secondary" className="assistant-panel__mono">
              {model.baseUrl}
            </Text>
            <div className="assistant-panel__caps">
              {model.capabilities.streaming && <span>streaming</span>}
              {model.capabilities.jsonMode && <span>json_mode</span>}
              {model.capabilities.tools && <span>tools</span>}
            </div>
          </div>
        ) : (
          <div className="assistant-panel__empty">
            <Text variant="body-2">{t("assistant.noModel")}</Text>
            <Text variant="caption-2" color="secondary">
              {t("assistant.noModelHint")}
            </Text>
            <Button view="action" size="m" onClick={() => openSettings()}>
              {t("assistant.openSettings")}
            </Button>
          </div>
        )}

        <div className="assistant-panel__section">
          <Text variant="caption-2" color="secondary">
            {t("assistant.configFile")}
          </Text>
          <Text variant="caption-2" className="assistant-panel__path" title={configPath ?? undefined}>
            {configPath ?? t("assistant.noWorkspace")}
          </Text>
          <Text
            variant="caption-2"
            color={status === "error" ? "danger" : "secondary"}
          >
            {statusText}
          </Text>
          {error && (
            <Text variant="caption-2" color="danger" className="assistant-panel__error">
              {error}
            </Text>
          )}
          <div className="assistant-panel__config-actions">
            <Tooltip content={t("assistant.reload")}>
              <span>
                <Button
                  view="flat"
                  size="s"
                  disabled={!configPath}
                  onClick={() => void reload()}
                >
                  <Icon data={ArrowRotateRight} size={14} />
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={t("assistant.openConfig")}>
              <span>
                <Button view="flat" size="s" disabled={!configPath} onClick={openConfig}>
                  <Icon data={FileArrowRight} size={14} />
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>

        <div className="assistant-panel__placeholder">
          <Text variant="caption-2" color="secondary">
            {t("assistant.panelHint")}
          </Text>
        </div>
      </div>

      <ModelSettingsModal />
    </div>
  );
}
