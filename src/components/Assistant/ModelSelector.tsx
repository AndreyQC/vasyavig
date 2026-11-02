import {useMemo} from "react";
import {Button, Select} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useConfigStore} from "../../store/configStore";
import {useAssistantStore} from "../../store/assistantStore";

/**
 * Селектор модели в шапке панели ассистента. Переключение пишет
 * `default_model` в vasyavig.yaml (D3/D17, Phase 8.1).
 */
export function ModelSelector() {
  const {t} = useTranslation();
  const models = useConfigStore((s) => s.models);
  const selectedModel = useConfigStore((s) => s.selectedModel);
  const setSelectedModel = useConfigStore((s) => s.setSelectedModel);
  const openSettings = useAssistantStore((s) => s.openSettings);

  const options = useMemo(
    () =>
      Object.entries(models).map(([id, model]) => ({
        value: id,
        content: model.label ? `${model.label} · ${id}` : id,
      })),
    [models],
  );

  if (options.length === 0) {
    return (
      <Button view="outlined" size="s" width="max" onClick={() => openSettings()}>
        {t("assistant.noModel")}
      </Button>
    );
  }

  return (
    <Select
      size="s"
      width="max"
      value={selectedModel ? [selectedModel] : []}
      onUpdate={(value) => {
        const id = value[0];
        if (id && id !== selectedModel) void setSelectedModel(id);
      }}
      options={options}
      placeholder={t("assistant.selectModel")}
    />
  );
}
