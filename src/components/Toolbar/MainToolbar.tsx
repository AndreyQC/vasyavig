import {Button, Icon, Tooltip} from "@gravity-ui/uikit";
import {FloppyDisk} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useSaveActions} from "../../hooks/useSaveActions";
import {ModeSwitcher} from "./ModeSwitcher";

interface Props {
  path: string;
}

/** Тулбар: переключатель режимов + кнопки сохранения. */
export function MainToolbar({path}: Props) {
  const {t} = useTranslation();
  const dirty = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.dirty ?? false);
  const kind = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.kind);
  const {saveActive, saveActiveAs} = useSaveActions();

  const isMarkdown = kind === "markdown";

  return (
    <div className="main-toolbar">
      <div className="main-toolbar__center">{isMarkdown && <ModeSwitcher path={path} />}</div>
      <div className="main-toolbar__right">
        <Tooltip content={t("toolbar.saveTooltip")}>
          <span>
            <Button view="outlined" disabled={!isMarkdown || !dirty} onClick={saveActive}>
              <Icon data={FloppyDisk} />
              {t("toolbar.save")}
            </Button>
          </span>
        </Tooltip>
        <Tooltip content={t("toolbar.saveAsTooltip")}>
          <span>
            <Button view="flat" disabled={!isMarkdown} onClick={saveActiveAs}>
              {t("toolbar.saveAs")}
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
