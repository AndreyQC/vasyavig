import {useState} from "react";
import {Button, Icon, Text} from "@gravity-ui/uikit";
import {Check, Xmark} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useAgentStore, type ModelStagePreview} from "../../store/agentStore";

/** Сколько символов маскированного текста рендерим в превью (остальное — note). */
const PREVIEW_TEXT_CHARS = 4000;

/**
 * Превью отправки (Phase 8.5, T1b): что именно уйдёт модели в режиме
 * `masking.mode: preview`. Чипы алиасов с типом, исходное значение — по клику,
 * маскированный текст контекст-пака, счётчики. Пока превью не подтверждено,
 * модель не вызывается. Значения живут только в памяти стора (D8) и отсюда
 * никуда не пишутся.
 */
export function MaskingPreview({preview}: {preview: ModelStagePreview}) {
  const {t} = useTranslation();
  const [openAlias, setOpenAlias] = useState<string | null>(null);
  const confirm = useAgentStore((s) => s.confirmMaskedSend);
  const cancel = useAgentStore((s) => s.cancelMaskedSend);

  const shownText = preview.maskedText.slice(0, PREVIEW_TEXT_CHARS);
  const hiddenChars = preview.maskedText.length - shownText.length;

  return (
    <div className="assistant-mask-preview">
      <div className="assistant-mask-preview__head">
        <Text variant="subheader-1">{t("assistant.maskPreview.title")}</Text>
        <span className="assistant-count">{preview.entities.length}</span>
      </div>
      <Text variant="caption-2" color="secondary">
        {t("assistant.maskPreview.hint")}
      </Text>

      {preview.entities.length === 0 ? (
        <Text variant="caption-2" color="secondary">
          {t("assistant.maskPreview.noEntities")}
        </Text>
      ) : (
        <>
          <Text variant="caption-2" color="secondary">
            {t("assistant.maskPreview.revealHint")}
          </Text>
          <div className="assistant-mask-preview__chips">
            {preview.entities.map((entity) => {
              const open = openAlias === entity.alias;
              return (
                <div key={entity.alias} className="assistant-mask-preview__chip-block">
                  <button
                    type="button"
                    className={open ? "mask-chip mask-chip--open" : "mask-chip"}
                    aria-pressed={open}
                    title={entity.alias}
                    onClick={() => setOpenAlias(open ? null : entity.alias)}
                  >
                    <span className="mask-chip__type">
                      {t(`assistant.entityType.${entity.type.toLowerCase()}`)}
                    </span>
                    <span className="mask-chip__tail">{entity.alias.slice(-6, -2)}</span>
                  </button>
                  {open && (
                    <Text variant="caption-2" className="mask-chip__value">
                      {entity.value}
                    </Text>
                  )}
                </div>
              );
            })}
          </div>
          <div className="assistant-mask-preview__counts">
            {Object.entries(preview.counts).map(([type, count]) => (
              <span key={type} className="assistant-mask-preview__count">
                {t(`assistant.entityType.${type.toLowerCase()}`)}: {count}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="assistant-mask-preview__text-block">
        <Text variant="caption-2" color="secondary">
          {t("assistant.maskPreview.textTitle")}
        </Text>
        {preview.documentIncluded ? (
          <pre className="assistant-mask-preview__text">
            {shownText === "" ? t("assistant.maskPreview.emptyDocument") : shownText}
          </pre>
        ) : (
          <Text variant="caption-2" color="secondary">
            {t("assistant.maskPreview.noDocument")}
          </Text>
        )}
        {hiddenChars > 0 && (
          <Text variant="caption-2" color="secondary">
            {t("assistant.maskPreview.textTruncated", {
              shown: shownText.length,
              total: preview.maskedText.length,
            })}
          </Text>
        )}
        {preview.truncated && (
          <Text variant="caption-2" color="warning">
            {t("assistant.maskPreview.contextTruncated")}
          </Text>
        )}
      </div>

      <div className="assistant-mask-preview__actions">
        <Button view="action" size="m" onClick={() => void confirm()}>
          <Icon data={Check} size={16} />
          {t("assistant.maskPreview.confirm")}
        </Button>
        <Button view="flat" size="m" onClick={cancel}>
          <Icon data={Xmark} size={16} />
          {t("assistant.maskPreview.cancel")}
        </Button>
      </div>
    </div>
  );
}
