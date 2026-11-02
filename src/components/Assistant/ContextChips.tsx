import {useMemo} from "react";
import {Icon, Text} from "@gravity-ui/uikit";
import {FileText} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useConfigStore} from "../../store/configStore";
import {useEditorStore} from "../../store/editorStore";
import {useSelectionStore} from "../../store/selectionStore";
import {buildContextPack} from "../../lib/agent/context";

/**
 * Контекст-чипы панели (Phase 8.2): активный документ, выделение и объём
 * контекста по лимиту `app.assistant.context.max_chars`. Показывают только
 * имена/размеры — путей и содержимого в модели отсюда нет.
 */
export function ContextChips() {
  const {t} = useTranslation();
  const tab = useEditorStore((s) => s.tabs.find((item) => item.path === s.activePath) ?? null);
  const selectionPath = useSelectionStore((s) => s.path);
  const selectionText = useSelectionStore((s) => s.text);
  const selectionFrom = useSelectionStore((s) => s.from);
  const selectionTo = useSelectionStore((s) => s.to);
  const settings = useConfigStore((s) => s.config.app.assistant.context);

  const selection = useMemo(
    () => (selectionText !== "" ? {text: selectionText, from: selectionFrom, to: selectionTo} : null),
    [selectionText, selectionFrom, selectionTo],
  );
  const pack = useMemo(
    () =>
      tab
        ? buildContextPack({
            docId: "panel",
            name: tab.name,
            content: tab.content,
            selection,
            settings,
          })
        : null,
    [tab, selection, settings],
  );

  const selectionHere = tab !== null && selectionPath === tab.path && selectionText !== "";
  const truncated = pack?.document?.truncated === true || pack?.selection?.truncated === true;

  return (
    <div className="assistant-context">
      <div className="assistant-context__chips">
        <span className="assistant-chip" title={tab?.name}>
          <Icon data={FileText} size={13} />
          <span className="assistant-chip__text">
            {tab ? tab.name : t("assistant.context.noDocument")}
          </span>
          {tab && <span className="assistant-chip__value">{tab.content.length}</span>}
        </span>
        {selectionHere && (
          <span className="assistant-chip assistant-chip--selection">
            {t("assistant.context.selection", {count: selectionText.length})}
          </span>
        )}
        <span
          className={
            truncated
              ? "assistant-chip assistant-chip--warning"
              : "assistant-chip assistant-chip--muted"
          }
        >
          {t("assistant.context.volume", {
            used: pack?.totalChars ?? 0,
            max: settings.maxChars,
          })}
        </span>
      </div>
      {truncated && (
        <Text variant="caption-2" color="warning">
          {t("assistant.context.truncated")}
        </Text>
      )}
    </div>
  );
}
