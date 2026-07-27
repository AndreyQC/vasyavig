import {useEditorStore} from "../../store/editorStore";
import {FileTypeBadge} from "./FileTypeBadge";

/** Нижняя панель: бейдж расширения активного файла (язык/тема/spellcheck — этапы 7–8). */
export function StatusBar() {
  const activePath = useEditorStore((s) => s.activePath);

  return (
    <div className="status-bar">
      {activePath && <FileTypeBadge path={activePath} />}
    </div>
  );
}
