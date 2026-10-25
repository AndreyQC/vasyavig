import {useMemo} from "react";
import {Button, Icon, Popover, Tooltip} from "@gravity-ui/uikit";
import {Link as LinkIcon} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {openUlidTarget, useHarnessStore} from "../../store/harnessStore";
import {parseHarnessEnvelope} from "../../lib/harnessEnvelope";
import {buildEnvelopeLinkChips} from "../../lib/harnessLinks";
import {HarnessLinkChips} from "../HarnessLinkChips";
import {getParentDir} from "../../lib/utils";

interface Props {
  path: string;
}

/**
 * Кнопка «Связи» в тулбаре markdown-вкладок (task 20261025_001, D11):
 * показывает скрытые ULID из конверта (based_on/related) в любом режиме
 * редактора — поповер с чипами, клик открывает документ реестра.
 */
export function HarnessLinksButton({path}: Props) {
  const {t} = useTranslation();
  const content = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.content ?? "");
  // примитив: пересчёт чипов при загрузке/сбросе реестра (урок §3)
  const indexVersion = useHarnessStore((s) => s.version);

  const chips = useMemo(() => {
    const envelope = parseHarnessEnvelope(content);
    if (!envelope) return [];
    return buildEnvelopeLinkChips(envelope, getParentDir(path));
  }, [content, path, indexVersion]);

  if (chips.length === 0) return null;

  return (
    <Tooltip content={t("harness.linksTooltip")}>
      <span>
        <Popover
          trigger="click"
          toggle
          placement="bottom-start"
          content={
            <div className="harness-links-panel">
              <div className="harness-links-panel__title">{t("harness.linksTitle")}</div>
              <div className="harness-links-panel__chips">
                <HarnessLinkChips chips={chips} onOpen={(ulid) => void openUlidTarget(getParentDir(path), ulid)} />
              </div>
            </div>
          }
        >
          <Button view="flat">
            <Icon data={LinkIcon} />
            {t("harness.links")}
            <span className="harness-links-panel__count">{chips.length}</span>
          </Button>
        </Popover>
      </span>
    </Tooltip>
  );
}
