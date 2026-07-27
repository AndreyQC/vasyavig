import {useEditorStore} from "../../store/editorStore";
import {FileTypeBadge} from "./FileTypeBadge";
import {SpellcheckToggle} from "./SpellcheckToggle";

/** Нижняя панель: бейдж расширения + spellcheck (язык/тема — этап 8). */
export function StatusBar() {
  const activePath = useEditorStore((s) => s.activePath);

  return (
    <div className="status-bar">
      {activePath && <FileTypeBadge path={activePath} />}
      <div className="status-bar__right">
        <SpellcheckToggle />
      </div>
    </div>
  );
}
