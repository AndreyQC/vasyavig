import {useEffect, useMemo, useState} from "react";
import {
  Button,
  Checkbox,
  Icon,
  Modal,
  Select,
  Text,
  TextInput,
  Tooltip,
} from "@gravity-ui/uikit";
import {
  ArrowLeft,
  ArrowRotateRight,
  FileArrowRight,
  Key,
  Pencil,
  Plus,
  TrashBin,
  Xmark,
} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {
  parseCryptoToken,
  validateModelConfig,
  type DataScope,
  type LlmModelConfig,
} from "../../lib/agent/config";
import {encryptText, generateFernetKey} from "../../lib/agent/crypto";
import {checkModel} from "../../lib/agent/provider";
import {useConfigStore} from "../../store/configStore";
import {useAssistantStore} from "../../store/assistantStore";
import {useFileStore} from "../../store/fileStore";

const DEFAULT_ENV = "VASYAVIG_LLM_KEY";

interface Draft {
  isNew: boolean;
  originalId: string;
  id: string;
  label: string;
  baseUrl: string;
  modelName: string;
  apiKeyToken: string;
  plainKey: string;
  env: string;
  generatedKey: string;
  temperature: string;
  maxTokens: string;
  contextLimit: string;
  timeoutMs: string;
  streaming: boolean;
  jsonMode: boolean;
  tools: boolean;
  dataScope: DataScope;
}

type Busy = null | "save" | "delete" | "check" | "encrypt" | "generate";

function draftFromModel(id: string, model: LlmModelConfig): Draft {
  const token = parseCryptoToken(model.apiKey);
  return {
    isNew: false,
    originalId: id,
    id,
    label: model.label,
    baseUrl: model.baseUrl,
    modelName: model.model,
    apiKeyToken: model.apiKey,
    plainKey: "",
    env: token?.env ?? DEFAULT_ENV,
    generatedKey: "",
    temperature: String(model.temperature),
    maxTokens: String(model.maxTokens),
    contextLimit: String(model.contextLimit),
    timeoutMs: String(model.timeoutMs),
    streaming: model.capabilities.streaming,
    jsonMode: model.capabilities.jsonMode,
    tools: model.capabilities.tools,
    dataScope: model.dataScope,
  };
}

function emptyDraft(): Draft {
  return {
    isNew: true,
    originalId: "",
    id: "",
    label: "",
    baseUrl: "",
    modelName: "",
    apiKeyToken: "",
    plainKey: "",
    env: DEFAULT_ENV,
    generatedKey: "",
    temperature: "0.2",
    maxTokens: "4096",
    contextLimit: "32000",
    timeoutMs: "60000",
    streaming: true,
    jsonMode: true,
    tools: false,
    dataScope: "perimeter",
  };
}

function parseNumber(value: string): number {
  const normalized = value.trim().replace(",", ".");
  return normalized === "" ? Number.NaN : Number(normalized);
}

function draftToModel(draft: Draft): LlmModelConfig {
  return {
    label: draft.label.trim() || draft.id.trim(),
    baseUrl: draft.baseUrl.trim(),
    model: draft.modelName.trim(),
    apiKey: draft.apiKeyToken.trim(),
    temperature: parseNumber(draft.temperature),
    maxTokens: parseNumber(draft.maxTokens),
    contextLimit: parseNumber(draft.contextLimit),
    timeoutMs: parseNumber(draft.timeoutMs),
    capabilities: {
      streaming: draft.streaming,
      jsonMode: draft.jsonMode,
      tools: draft.tools,
    },
    dataScope: draft.dataScope,
  };
}

/**
 * Настройки моделей (Phase 8.1): add/edit/remove, base_url/model/key/env,
 * capabilities, data_scope и «Проверить». vasyavig.yaml при этом не
 * редактируется вручную — только через эту форму; файл открывается read-only.
 */
export function ModelSettingsModal() {
  const {t} = useTranslation();
  const open = useAssistantStore((s) => s.settingsOpen);
  const settingsModelId = useAssistantStore((s) => s.settingsModelId);
  const close = useAssistantStore((s) => s.closeSettings);

  const models = useConfigStore((s) => s.models);
  const requestConfig = useConfigStore((s) => s.config.llm.request);
  const configPath = useConfigStore((s) => s.configPath);
  const status = useConfigStore((s) => s.status);
  const writable = useConfigStore((s) => s.writable);
  const storeError = useConfigStore((s) => s.error);
  const addModel = useConfigStore((s) => s.addModel);
  const updateModel = useConfigStore((s) => s.updateModel);
  const removeModel = useConfigStore((s) => s.removeModel);
  const reload = useConfigStore((s) => s.reload);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<{ok: boolean; text: string} | null>(null);

  const modelEntries = useMemo(() => Object.entries(models), [models]);

  const resetTransient = () => {
    setDraft(null);
    setPendingDelete(null);
    setBusy(null);
    setFormError(null);
    setInfo(null);
    setCheckResult(null);
  };

  useEffect(() => {
    if (!open) {
      resetTransient();
      return;
    }
    if (settingsModelId && models[settingsModelId]) {
      setDraft(draftFromModel(settingsModelId, models[settingsModelId]));
    }
    // models в зависимостях не нужен: форма открывается один раз на open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settingsModelId]);

  if (!open) return null;

  const closeModal = () => {
    resetTransient();
    close();
  };

  const openConfig = () => {
    if (!configPath) return;
    closeModal();
    void useFileStore.getState().openFile(configPath);
  };

  const startEdit = (id: string) => {
    const model = models[id];
    if (!model) return;
    setDraft(draftFromModel(id, model));
    setFormError(null);
    setInfo(null);
    setCheckResult(null);
  };

  const startAdd = () => {
    setDraft(emptyDraft());
    setFormError(null);
    setInfo(null);
    setCheckResult(null);
  };

  const backToList = () => {
    setDraft(null);
    setFormError(null);
    setInfo(null);
    setCheckResult(null);
  };

  /** Ключ из формы: новый plain-ключ шифруется, иначе используется текущий токен. */
  async function resolveKey(
    value: Draft,
  ): Promise<{ok: true; token: string} | {ok: false; error: string}> {
    if (!value.plainKey.trim()) return {ok: true, token: value.apiKeyToken.trim()};
    if (!value.env.trim()) return {ok: false, error: t("assistant.keyEnvRequired")};
    const encrypted = await encryptText(value.plainKey.trim(), value.env.trim());
    if (!encrypted.ok) return {ok: false, error: encrypted.error};
    return {ok: true, token: encrypted.value};
  }

  async function buildCandidate(
    value: Draft,
  ): Promise<{ok: true; model: LlmModelConfig; token: string} | {ok: false; error: string}> {
    const key = await resolveKey(value);
    if (!key.ok) return key;
    const model = {...draftToModel(value), apiKey: key.token};
    try {
      validateModelConfig(value.isNew ? value.id.trim() : value.originalId || value.id, model);
    } catch (e) {
      return {ok: false, error: String(e)};
    }
    return {ok: true, model, token: key.token};
  }

  const handleSave = async () => {
    if (!draft || busy) return;
    setBusy("save");
    setFormError(null);
    setInfo(null);
    try {
      const candidate = await buildCandidate(draft);
      if (!candidate.ok) {
        setFormError(candidate.error);
        return;
      }
      const id = draft.isNew ? draft.id.trim() : draft.originalId || draft.id;
      const result = draft.isNew
        ? await addModel(id, candidate.model)
        : await updateModel(id, candidate.model);
      if (!result.ok) {
        setFormError(result.error ?? t("assistant.saveFailed"));
        return;
      }
      // Сохраняем зашифрованный токен в черновике: повторный Save не требует
      // повторного ввода ключа, если пользователь остался в форме.
      setDraft({...draft, apiKeyToken: candidate.token, plainKey: "", isNew: false, originalId: id});
      setInfo(t("assistant.saved"));
    } finally {
      setBusy(null);
    }
  };

  const handleEncrypt = async () => {
    if (!draft || busy) return;
    if (!draft.plainKey.trim()) {
      setFormError(t("assistant.keyValueRequired"));
      return;
    }
    setBusy("encrypt");
    setFormError(null);
    setInfo(null);
    try {
      const key = await resolveKey(draft);
      if (!key.ok) {
        setFormError(key.error);
        return;
      }
      setDraft({...draft, apiKeyToken: key.token, plainKey: ""});
      setInfo(t("assistant.keyEncrypted"));
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateKey = async () => {
    if (!draft || busy) return;
    setBusy("generate");
    setFormError(null);
    try {
      const result = await generateFernetKey();
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setDraft({...draft, generatedKey: result.value});
    } finally {
      setBusy(null);
    }
  };

  const handleCheck = async () => {
    if (!draft || busy) return;
    setBusy("check");
    setFormError(null);
    setCheckResult(null);
    try {
      const candidate = await buildCandidate(draft);
      if (!candidate.ok) {
        setCheckResult({ok: false, text: t("assistant.checkFailed", {error: candidate.error})});
        return;
      }
      const result = await checkModel(candidate.model, requestConfig);
      setCheckResult(
        result.ok
          ? {ok: true, text: t("assistant.checkOk")}
          : {
              ok: false,
              text: t("assistant.checkFailed", {error: result.error ?? ""}),
            },
      );
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    setBusy("delete");
    setFormError(null);
    try {
      const result = await removeModel(id);
      if (!result.ok) {
        setFormError(result.error ?? t("assistant.saveFailed"));
        return;
      }
      setPendingDelete(null);
    } finally {
      setBusy(null);
    }
  };

  const configBlocked = !writable && status === "error";

  return (
    <Modal open onOpenChange={(value) => !value && closeModal()}>
      <div className="assistant-settings">
        <div className="assistant-settings__header">
          <Text variant="header-2">{t("assistant.settingsTitle")}</Text>
          <Button view="flat" size="s" onClick={closeModal}>
            <Icon data={Xmark} size={16} />
          </Button>
        </div>
        <Text variant="caption-2" color="secondary">
          {t("assistant.settingsSubtitle")}
        </Text>
        <div className="assistant-settings__config">
          <Text variant="caption-2" className="assistant-settings__mono" title={configPath ?? undefined}>
            {configPath ?? t("assistant.workspaceRequired")}
          </Text>
          <div className="assistant-settings__config-actions">
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
        {(storeError || configBlocked) && (
          <Text variant="caption-2" color="danger">
            {storeError ?? t("assistant.configBlocked")}
          </Text>
        )}

        {draft ? (
          <ModelEditor
            draft={draft}
            busy={busy}
            formError={formError}
            info={info}
            checkResult={checkResult}
            onChange={setDraft}
            onBack={backToList}
            onSave={handleSave}
            onCheck={handleCheck}
            onEncrypt={handleEncrypt}
            onGenerateKey={handleGenerateKey}
          />
        ) : (
          <>
            <div className="assistant-settings__list">
              {modelEntries.length === 0 ? (
                <Text variant="body-2" color="secondary">
                  {t("assistant.modelsEmpty")}
                </Text>
              ) : (
                modelEntries.map(([id, model]) => (
                  <div className="assistant-settings__row" key={id}>
                    <div className="assistant-settings__row-main">
                      <Text variant="subheader-1">{model.label || id}</Text>
                      <Text variant="caption-2" color="secondary">
                        {id} · {model.model}
                      </Text>
                      <Text variant="caption-2" color="secondary" className="assistant-settings__mono">
                        {model.baseUrl}
                      </Text>
                      <Text variant="caption-2" color="secondary">
                        {model.apiKey
                          ? t("assistant.keySet", {
                              env: parseCryptoToken(model.apiKey)?.env ?? "?",
                            })
                          : t("assistant.keyMissing")}
                        {" · "}
                        {t(`assistant.scope.${model.dataScope}`)}
                      </Text>
                    </div>
                    <div className="assistant-settings__row-actions">
                      {pendingDelete === id ? (
                        <>
                          <Text variant="caption-2" color="danger">
                            {t("assistant.removeConfirm", {id})}
                          </Text>
                          <Button
                            view="outlined-danger"
                            size="s"
                            loading={busy === "delete"}
                            onClick={() => void handleDelete(id)}
                          >
                            {t("assistant.confirm")}
                          </Button>
                          <Button view="flat" size="s" onClick={() => setPendingDelete(null)}>
                            {t("assistant.cancel")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Tooltip content={t("assistant.editModel")}>
                            <span>
                              <Button view="flat" size="s" onClick={() => startEdit(id)}>
                                <Icon data={Pencil} size={14} />
                              </Button>
                            </span>
                          </Tooltip>
                          <Tooltip content={t("assistant.removeModel")}>
                            <span>
                              <Button view="flat" size="s" onClick={() => setPendingDelete(id)}>
                                <Icon data={TrashBin} size={14} />
                              </Button>
                            </span>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            {formError && (
              <Text variant="caption-2" color="danger">
                {formError}
              </Text>
            )}
            <div className="assistant-settings__footer">
              <Button view="outlined" onClick={startAdd}>
                <Icon data={Plus} size={14} />
                {t("assistant.addModel")}
              </Button>
              <Button view="flat" onClick={closeModal}>
                {t("assistant.close")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

interface ModelEditorProps {
  draft: Draft;
  busy: Busy;
  formError: string | null;
  info: string | null;
  checkResult: {ok: boolean; text: string} | null;
  onChange: (draft: Draft) => void;
  onBack: () => void;
  onSave: () => void;
  onCheck: () => void;
  onEncrypt: () => void;
  onGenerateKey: () => void;
}

function ModelEditor({
  draft,
  busy,
  formError,
  info,
  checkResult,
  onChange,
  onBack,
  onSave,
  onCheck,
  onEncrypt,
  onGenerateKey,
}: ModelEditorProps) {
  const {t} = useTranslation();
  const patch = (values: Partial<Draft>) => onChange({...draft, ...values});
  const disabled = busy !== null;
  const existingEnv = parseCryptoToken(draft.apiKeyToken)?.env;

  return (
    <div className="assistant-settings__editor">
      <div className="assistant-settings__editor-head">
        <Button view="flat" size="s" onClick={onBack}>
          <Icon data={ArrowLeft} size={14} />
          {t("assistant.back")}
        </Button>
        <Text variant="subheader-2">
          {draft.isNew ? t("assistant.addModel") : t("assistant.editModel")}
        </Text>
      </div>

      <div className="assistant-settings__grid">
        <label className="assistant-settings__field">
          <Text variant="caption-2">{t("assistant.modelId")}</Text>
          <TextInput
            value={draft.id}
            onUpdate={(value) => patch({id: value})}
            disabled={disabled || !draft.isNew}
            placeholder="perimeter-fast"
          />
        </label>
        <label className="assistant-settings__field">
          <Text variant="caption-2">{t("assistant.label")}</Text>
          <TextInput
            value={draft.label}
            onUpdate={(value) => patch({label: value})}
            disabled={disabled}
            placeholder={t("assistant.labelPlaceholder")}
          />
        </label>
        <label className="assistant-settings__field assistant-settings__field--wide">
          <Text variant="caption-2">{t("assistant.baseUrl")}</Text>
          <TextInput
            value={draft.baseUrl}
            onUpdate={(value) => patch({baseUrl: value})}
            disabled={disabled}
            placeholder="https://llm.perimeter.example/v1"
          />
          <Text variant="caption-2" color="secondary">
            {t("assistant.baseUrlHint")}
          </Text>
        </label>
        <label className="assistant-settings__field">
          <Text variant="caption-2">{t("assistant.modelName")}</Text>
          <TextInput
            value={draft.modelName}
            onUpdate={(value) => patch({modelName: value})}
            disabled={disabled}
            placeholder="qwen2.5-7b-instruct"
          />
        </label>
        <label className="assistant-settings__field">
          <Text variant="caption-2">{t("assistant.dataScope")}</Text>
          <Select
            value={[draft.dataScope]}
            onUpdate={(value) => patch({dataScope: (value[0] ?? "perimeter") as DataScope})}
            disabled={disabled}
            options={[
              {value: "perimeter", content: t("assistant.scope.perimeter")},
              {value: "local", content: t("assistant.scope.local")},
              {value: "external", content: t("assistant.scope.external")},
            ]}
          />
        </label>

        <div className="assistant-settings__field assistant-settings__field--wide">
          <Text variant="caption-2">{t("assistant.apiKey")}</Text>
          <Text variant="caption-2" color="secondary">
            {existingEnv
              ? t("assistant.keySet", {env: existingEnv})
              : t("assistant.keyMissing")}
          </Text>
          <div className="assistant-settings__inline">
            <TextInput
              type="password"
              value={draft.plainKey}
              onUpdate={(value) => patch({plainKey: value})}
              disabled={disabled}
              placeholder={
                draft.apiKeyToken ? t("assistant.apiKeyKeep") : t("assistant.apiKeyPlaceholder")
              }
            />
            <Button
              view="outlined"
              size="m"
              loading={busy === "encrypt"}
              disabled={disabled}
              onClick={onEncrypt}
            >
              <Icon data={Key} size={14} />
              {t("assistant.encryptKey")}
            </Button>
          </div>
          <Text variant="caption-2" color="secondary">
            {t("assistant.apiKeyPlainHint")}
          </Text>
        </div>

        <label className="assistant-settings__field">
          <Text variant="caption-2">{t("assistant.envName")}</Text>
          <TextInput
            value={draft.env}
            onUpdate={(value) => patch({env: value})}
            disabled={disabled}
            placeholder={DEFAULT_ENV}
          />
          <Text variant="caption-2" color="secondary">
            {t("assistant.envHint")}
          </Text>
        </label>
        <div className="assistant-settings__field">
          <Text variant="caption-2">{t("assistant.fernetKey")}</Text>
          <Button
            view="outlined"
            size="m"
            loading={busy === "generate"}
            disabled={disabled}
            onClick={onGenerateKey}
          >
            {t("assistant.generateKey")}
          </Button>
          {draft.generatedKey && (
            <>
              <TextInput value={draft.generatedKey} readOnly onUpdate={() => {}} />
              <Text variant="caption-2" color="warning">
                {t("assistant.generatedKeyHint", {env: draft.env || DEFAULT_ENV})}
              </Text>
            </>
          )}
        </div>

        <div className="assistant-settings__numbers">
          <label className="assistant-settings__field">
            <Text variant="caption-2">{t("assistant.temperature")}</Text>
            <TextInput
              type="number"
              value={draft.temperature}
              onUpdate={(value) => patch({temperature: value})}
              disabled={disabled}
            />
          </label>
          <label className="assistant-settings__field">
            <Text variant="caption-2">{t("assistant.maxTokens")}</Text>
            <TextInput
              type="number"
              value={draft.maxTokens}
              onUpdate={(value) => patch({maxTokens: value})}
              disabled={disabled}
            />
          </label>
          <label className="assistant-settings__field">
            <Text variant="caption-2">{t("assistant.contextLimit")}</Text>
            <TextInput
              type="number"
              value={draft.contextLimit}
              onUpdate={(value) => patch({contextLimit: value})}
              disabled={disabled}
            />
          </label>
          <label className="assistant-settings__field">
            <Text variant="caption-2">{t("assistant.timeoutMs")}</Text>
            <TextInput
              type="number"
              value={draft.timeoutMs}
              onUpdate={(value) => patch({timeoutMs: value})}
              disabled={disabled}
            />
          </label>
        </div>

        <div className="assistant-settings__field assistant-settings__field--wide">
          <Text variant="caption-2">{t("assistant.capabilities")}</Text>
          <div className="assistant-settings__checks">
            <Checkbox
              checked={draft.streaming}
              onUpdate={(checked) => patch({streaming: checked})}
              disabled={disabled}
              content={t("assistant.capStreaming")}
            />
            <Checkbox
              checked={draft.jsonMode}
              onUpdate={(checked) => patch({jsonMode: checked})}
              disabled={disabled}
              content={t("assistant.capJsonMode")}
            />
            <Checkbox
              checked={draft.tools}
              onUpdate={(checked) => patch({tools: checked})}
              disabled={disabled}
              content={t("assistant.capTools")}
            />
          </div>
        </div>
      </div>

      {formError && (
        <Text variant="caption-2" color="danger">
          {formError}
        </Text>
      )}
      {info && (
        <Text variant="caption-2" color="positive">
          {info}
        </Text>
      )}
      {checkResult && (
        <Text variant="caption-2" color={checkResult.ok ? "positive" : "danger"}>
          {checkResult.text}
        </Text>
      )}

      <div className="assistant-settings__footer">
        <Button
          view="outlined"
          loading={busy === "check"}
          disabled={disabled && busy !== "check"}
          onClick={onCheck}
        >
          {busy === "check" ? t("assistant.checking") : t("assistant.check")}
        </Button>
        <div className="assistant-settings__footer-right">
          <Button view="flat" disabled={disabled} onClick={onBack}>
            {t("assistant.cancel")}
          </Button>
          <Button
            view="action"
            loading={busy === "save"}
            disabled={disabled && busy !== "save"}
            onClick={onSave}
          >
            {t("assistant.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
