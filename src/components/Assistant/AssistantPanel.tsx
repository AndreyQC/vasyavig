import {Button, Icon, Text, Tooltip} from "@gravity-ui/uikit";
import {
  ArrowRotateRight,
  CheckDouble,
  Envelope,
  FileArrowRight,
  Gear,
  Sparkles,
  Xmark,
} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useConfigStore} from "../../store/configStore";
import {useAssistantStore} from "../../store/assistantStore";
import {useAgentStore} from "../../store/agentStore";
import {useEditorStore} from "../../store/editorStore";
import {useFileStore} from "../../store/fileStore";
import {isConfigFileName} from "../../lib/agent/config";
import {ModelSelector} from "./ModelSelector";
import {ModelSettingsModal} from "./ModelSettingsModal";
import {ContextChips} from "./ContextChips";
import {FindingsList} from "./FindingsList";
import {ProposalCard} from "./ProposalCard";
import "./Assistant.css";

/**
 * Панель ассистента справа (Phase 8.2): контекст-чипы, детерминированная
 * проверка документа, findings и карточки предложений. Свободного чата нет;
 * предложения применяются только кнопкой, на диск сохраняет пользователь.
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

  const activeTab = useEditorStore((s) => s.tabs.find((item) => item.path === s.activePath) ?? null);
  const findings = useAgentStore((s) => s.findings);
  const findingsDocName = useAgentStore((s) => s.findingsDocName);
  const findingsAt = useAgentStore((s) => s.findingsAt);
  const checkRunning = useAgentStore((s) => s.checkRunning);
  const proposals = useAgentStore((s) => s.proposals);
  const lastError = useAgentStore((s) => s.lastError);
  const runCheckDocument = useAgentStore((s) => s.runCheckDocument);
  const clearFindings = useAgentStore((s) => s.clearFindings);

  const canCheck =
    (activeTab?.kind === "markdown" || activeTab?.kind === "text") &&
    !isConfigFileName(activeTab?.path ?? "");

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
        <ContextChips />

        <div className="assistant-actions">
          <Button
            view="action"
            size="m"
            disabled={!canCheck || checkRunning}
            onClick={() => void runCheckDocument()}
          >
            <Icon data={CheckDouble} size={16} />
            {checkRunning ? t("assistant.actions.checking") : t("assistant.actions.check")}
          </Button>
          <Tooltip content={t("assistant.actions.emailSoon")}>
            <span>
              <Button view="flat" size="m" disabled>
                <Icon data={Envelope} size={16} />
                {t("assistant.actions.email")}
              </Button>
            </span>
          </Tooltip>
        </div>
        {!canCheck && (
          <Text variant="caption-2" color="secondary">
            {t("assistant.actions.needDocument")}
          </Text>
        )}

        {lastError && (
          <Text variant="caption-2" color="danger" className="assistant-panel__error">
            {lastError}
          </Text>
        )}

        {(findingsAt !== null || checkRunning) && (
          <FindingsList
            findings={findings}
            docName={findingsDocName}
            running={checkRunning}
            onClear={clearFindings}
          />
        )}

        {proposals.length > 0 && (
          <div className="assistant-section">
            <div className="assistant-section__head">
              <Text variant="subheader-1">{t("assistant.proposals.title")}</Text>
              <span className="assistant-count">{proposals.length}</span>
            </div>
            <div className="assistant-proposals__list">
              {proposals.map((proposal) => (
                <ProposalCard key={proposal.id} proposal={proposal} />
              ))}
            </div>
          </div>
        )}

        <div className="assistant-panel__section">
          <Text variant="caption-2" color="secondary">
            {t("assistant.modelSection")}
          </Text>
          {model ? (
            <>
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
            </>
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
        </div>

        <div className="assistant-panel__section">
          <Text variant="caption-2" color="secondary">
            {t("assistant.configFile")}
          </Text>
          <Text variant="caption-2" className="assistant-panel__path" title={configPath ?? undefined}>
            {configPath ?? t("assistant.noWorkspace")}
          </Text>
          <Text variant="caption-2" color={status === "error" ? "danger" : "secondary"}>
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
                <Button view="flat" size="s" disabled={!configPath} onClick={() => void reload()}>
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
      </div>

      <ModelSettingsModal />
    </div>
  );
}
