import {Button, Icon, Tooltip} from "@gravity-ui/uikit";
import {FloppyDisk} from "@gravity-ui/icons";
import {useEditorStore} from "../../store/editorStore";
import {useSaveActions} from "../../hooks/useSaveActions";
import {ModeSwitcher} from "./ModeSwitcher";

interface Props {
  path: string;
}

/** Тулбар: переключатель режимов + кнопки сохранения. */
export function MainToolbar({path}: Props) {
  const dirty = useEditorStore((s) => s.tabs.find((t) => t.path === path)?.dirty ?? false);
  const kind = useEditorStore((s) => s.tabs.find((t) => t.path === path)?.kind);
  const {saveActive, saveActiveAs} = useSaveActions();

  const isMarkdown = kind === "markdown";

  return (
    <div className="main-toolbar">
      <div className="main-toolbar__center">{isMarkdown && <ModeSwitcher path={path} />}</div>
      <div className="main-toolbar__right">
        <Tooltip content="Сохранить (Ctrl+S)">
          <span>
            <Button
              view="outlined"
              disabled={!isMarkdown || !dirty}
              onClick={saveActive}
            >
              <Icon data={FloppyDisk} />
              Сохранить
            </Button>
          </span>
        </Tooltip>
        <Tooltip content="Сохранить как… (Ctrl+Shift+S)">
          <span>
            <Button view="flat" disabled={!isMarkdown} onClick={saveActiveAs}>
              Сохранить как…
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
