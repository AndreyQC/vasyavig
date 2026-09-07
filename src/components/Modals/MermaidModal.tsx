import {useEffect, useRef, useState} from "react";
import {Button, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore} from "../../store/uiStore";
import {MonacoViewer} from "../EditorArea/MonacoViewer";
import {renderMermaidDiagram} from "../../lib/mermaidRenderer";

const PREVIEW_DEBOUNCE_MS = 300;

interface Props {
  request: {source: string; ownerPath: string; apply: (next: string) => void};
}

/**
 * Модалка правки mermaid-диаграммы (design D3): Monaco слева, живое превью
 * справа (debounce 300 мс). Невалидный исходник не блокирует сохранение —
 * ошибка видна в превью (спека).
 */
function MermaidEditor({request}: Props) {
  const {t} = useTranslation();
  const [draft, setDraft] = useState(request.source);
  const [preview, setPreview] = useState<{svg: string} | {error: string} | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void renderMermaidDiagram(draft).then(setPreview);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft]);

  // превью для исходного текста — сразу, не ждём первого debounce-таймера
  useEffect(() => {
    void renderMermaidDiagram(request.source).then(setPreview);
  }, [request.source]);

  const close = () => useUiStore.getState().setPendingMermaidEdit(null);
  const save = () => {
    request.apply(draft);
    close();
  };

  return (
    <Modal open onOpenChange={(open) => !open && close()}>
      <div className="mermaid-modal">
        <Text variant="header-2">{t("mermaid.editTitle")}</Text>
        <div className="mermaid-modal__body">
          <div className="mermaid-modal__editor">
            <MonacoViewer
              content={draft}
              path="mermaid-draft"
              editable
              onChange={(value) => setDraft(value)}
            />
          </div>
          <div className="mermaid-modal__preview">
            {preview === null ? (
              <div className="mermaid-modal__placeholder">{t("mermaid.previewPending")}</div>
            ) : "svg" in preview ? (
              // вывод mermaid (securityLevel strict), не пользовательский HTML
              <div className="mermaid-modal__svg" dangerouslySetInnerHTML={{__html: preview.svg}} />
            ) : (
              <div className="mermaid-modal__placeholder mermaid-modal__placeholder--error">
                {t("mermaid.renderError")}
                <pre className="mermaid-modal__error-text">{preview.error}</pre>
              </div>
            )}
          </div>
        </div>
        <div className="save-confirm-modal__actions">
          <Button view="action" onClick={save}>
            {t("modal.save")}
          </Button>
          <Button view="flat" onClick={close}>
            {t("modal.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Обёртка: рендерит внутренний редактор только при активном запросе
 *  (размонтирование при закрытии сбрасывает черновик). */
export function MermaidModal() {
  const request = useUiStore((s) => s.pendingMermaidEdit);
  return request ? <MermaidEditor request={request} /> : null;
}
