import {useMemo} from "react";
import {Button, Icon, Popover, Tooltip} from "@gravity-ui/uikit";
import {PersonMagnifier} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {getEditor} from "../../lib/editorRegistry";
import {lineOfOffset, useNerSpans} from "../../hooks/useNerSpans";

/**
 * Кнопка «NER» в тулбаре markdown-вкладок (Phase 8.5, T2; требование
 * пользователя 2026-11-04): общее количество найденных NER-сущностей на
 * кнопке, дропдаун со списком вхождений (тип · значение · строка), клик —
 * переход к вхождению в документе. Только навигация: скан локальный, ничего
 * не отправляется; маскирование при отправке — отдельный контур (превью T1b).
 */
export function NerButton({path}: {path: string}) {
  const {t} = useTranslation();
  const content = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.content ?? "");
  const spans = useNerSpans(path, content);

  const items = useMemo(
    () =>
      spans.map((span) => ({
        ...span,
        line: lineOfOffset(content, span.start) + 1, // 1-based для отображения
      })),
    [spans, content],
  );

  const goTo = (offset: number) => {
    const editor = getEditor(path);
    if (!editor) return;
    editor.moveCursor({line: lineOfOffset(content, offset)});
  };

  return (
    <Tooltip content={t("tools.nerTooltip")}>
      <span>
        <Popover
          trigger="click"
          toggle
          placement="bottom-start"
          content={
            <div className="ner-panel">
              <div className="ner-panel__title">{t("ner.title")}</div>
              {items.length === 0 ? (
                <div className="ner-panel__empty">{t("ner.empty")}</div>
              ) : (
                <div className="ner-panel__list">
                  {items.map((item, index) => (
                    <button
                      type="button"
                      key={`${item.start}-${index}`}
                      className="ner-panel__item"
                      onClick={() => goTo(item.start)}
                    >
                      <span className={`ner-panel__type ner-panel__type--${item.type.toLowerCase()}`}>
                        {t(`assistant.entityType.${item.type.toLowerCase()}`)}
                      </span>
                      <span className="ner-panel__value">{item.value}</span>
                      <span className="ner-panel__line">{t("ner.line", {line: item.line})}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        >
          <Button view="flat">
            <Icon data={PersonMagnifier} />
            {t("tools.ner")}
            <span className="harness-links-panel__count">{items.length}</span>
          </Button>
        </Popover>
      </span>
    </Tooltip>
  );
}
