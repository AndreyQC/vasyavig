import {Button, Icon, Tooltip} from "@gravity-ui/uikit";
import {ChartLine, FloppyDisk, ListUl, MagicWand} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useSaveActions} from "../../hooks/useSaveActions";
import {useMarkdownTools} from "../../hooks/useMarkdownTools";
import {ModeSwitcher} from "./ModeSwitcher";

interface Props {
  path: string;
}

/** Тулбар: инструменты markdown + переключатель режимов + кнопки сохранения. */
export function MainToolbar({path}: Props) {
  const {t} = useTranslation();
  const dirty = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.dirty ?? false);
  const kind = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.kind);
  const {saveActive, saveActiveAs} = useSaveActions();
  const {restoreUrls, startToc, insertMermaid} = useMarkdownTools(path);

  const isMarkdown = kind === "markdown";
  // полный цикл правки/сохранения — у markdown и text (design D5)
  const savable = isMarkdown || kind === "text";

  return (
    <div className="main-toolbar">
      <div className="main-toolbar__left">
        {isMarkdown && (
          <>
            <Tooltip content={t("tools.restoreUrlsTooltip")}>
              <span>
                <Button view="flat" onClick={restoreUrls}>
                  <Icon data={MagicWand} />
                  {t("tools.restoreUrls")}
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={t("tools.tocTooltip")}>
              <span>
                <Button view="flat" onClick={startToc}>
                  <Icon data={ListUl} />
                  {t("tools.toc")}
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={t("tools.mermaidTooltip")}>
              <span>
                <Button view="flat" onClick={insertMermaid}>
                  <Icon data={ChartLine} />
                  {t("tools.mermaid")}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
      </div>
      <div className="main-toolbar__center">{isMarkdown && <ModeSwitcher path={path} />}</div>
      <div className="main-toolbar__right">
        <Tooltip content={t("toolbar.saveTooltip")}>
          <span>
            <Button view="outlined" disabled={!savable || !dirty} onClick={saveActive}>
              <Icon data={FloppyDisk} />
              {t("toolbar.save")}
            </Button>
          </span>
        </Tooltip>
        <Tooltip content={t("toolbar.saveAsTooltip")}>
          <span>
            <Button view="flat" disabled={!savable} onClick={saveActiveAs}>
              {t("toolbar.saveAs")}
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
