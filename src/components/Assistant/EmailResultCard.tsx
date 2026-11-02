import {useState} from "react";
import {Button, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {saveEmailHtmlDialog, writeFile} from "../../hooks/useTauriFS";
import {useEditorStore} from "../../store/editorStore";
import type {EmailResult} from "../../store/agentStore";

interface Props {
  result: EmailResult;
}

/**
 * Карточка результата «Письма HTML» (Phase 8.4): тема/preheader, warnings,
 * кнопки превью/сохранения/копирования. Это экспорт — действия пользователя;
 * документ при этом не меняется, propose_* не вызываются.
 */
export function EmailResultCard({result}: Props) {
  const {t} = useTranslation();
  const [status, setStatus] = useState<{text: string; error: boolean} | null>(null);

  const openPreview = () => {
    // Тот же путь, что после прогона: preview-вкладка замещает предыдущую.
    useEditorStore.getState().openTab(
      {path: result.previewPath, kind: "html", content: result.html},
      {preview: true},
    );
  };

  const saveHtml = async () => {
    setStatus(null);
    const target = await saveEmailHtmlDialog(result.htmlFileName);
    if (!target) return;
    try {
      await writeFile(target, result.html);
      setStatus({text: t("assistant.email.saved"), error: false});
    } catch (e) {
      setStatus({text: t("assistant.email.saveFailed", {error: String(e)}), error: true});
    }
  };

  const copyHtml = async () => {
    setStatus(null);
    try {
      // rich HTML: text/html через ClipboardItem (WebView2/Chromium поддерживает)
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([result.html], {type: "text/html"}),
        }),
      ]);
      setStatus({text: t("assistant.email.copied"), error: false});
    } catch {
      try {
        await navigator.clipboard.writeText(result.html);
        setStatus({text: t("assistant.email.copiedPlain"), error: false});
      } catch {
        setStatus({text: t("assistant.email.copyFailed"), error: true});
      }
    }
  };

  return (
    <div className="assistant-section assistant-email">
      <div className="assistant-section__head">
        <Text variant="subheader-1">{t("assistant.email.title")}</Text>
      </div>
      <div className="assistant-email__meta">
        <Text variant="caption-2" color="secondary">
          {t("assistant.email.subject")}:
        </Text>
        <Text variant="body-2" className="assistant-email__subject">
          {result.subject}
        </Text>
        {result.preheader !== "" && (
          <Text variant="caption-2" className="assistant-email__preheader">
            {t("assistant.email.preheader")}: {result.preheader}
          </Text>
        )}
        <Text variant="caption-2" color="secondary">
          {t(
            result.metaSource === "model"
              ? "assistant.email.sourceModel"
              : "assistant.email.sourceFallback",
          )}
        </Text>
      </div>
      {result.warnings.length > 0 && (
        <div className="assistant-email__warnings">
          {result.warnings.map((warning, index) => (
            <Text key={`${warning.key}-${index}`} variant="caption-2" color="secondary">
              • {t(warning.key, warning.params ?? {})}
            </Text>
          ))}
        </div>
      )}
      <div className="assistant-email__actions">
        <Button view="outlined" size="s" onClick={openPreview}>
          {t("assistant.email.preview")}
        </Button>
        <Button view="outlined" size="s" onClick={() => void saveHtml()}>
          {t("assistant.email.saveHtml")}
        </Button>
        <Button view="outlined" size="s" onClick={() => void copyHtml()}>
          {t("assistant.email.copyHtml")}
        </Button>
      </div>
      {status && (
        <Text variant="caption-2" color={status.error ? "danger" : "secondary"}>
          {status.text}
        </Text>
      )}
    </div>
  );
}
