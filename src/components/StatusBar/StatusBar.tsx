import {useEditorStore} from "../../store/editorStore";
import {FileTypeBadge} from "./FileTypeBadge";
import {SpellcheckToggle} from "./SpellcheckToggle";
import {ThemeToggle} from "./ThemeToggle";
import {LanguageSelector} from "./LanguageSelector";

/** Нижняя панель: бейдж расширения слева; spellcheck, язык, тема — справа (идея §5.2). */
export function StatusBar() {
  const activePath = useEditorStore((s) => s.activePath);

  return (
    <div className="status-bar">
      {activePath && <FileTypeBadge path={activePath} />}
      <div className="status-bar__right">
        <SpellcheckToggle />
        <LanguageSelector />
        <ThemeToggle />
      </div>
    </div>
  );
}
