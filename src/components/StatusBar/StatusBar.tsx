import {Text} from "@gravity-ui/uikit";
import {useEditorStore} from "../../store/editorStore";
import {useUiStore} from "../../store/uiStore";
import {FileTypeBadge} from "./FileTypeBadge";
import {SpellcheckToggle} from "./SpellcheckToggle";
import {ThemeToggle} from "./ThemeToggle";
import {LanguageSelector} from "./LanguageSelector";

/** Позиция курсора активной вкладки «строка:столбец» (план 20261028_004, D5). */
function CursorPosition() {
  const pos = useUiStore((s) => s.cursorPos);
  if (!pos) return null;
  return (
    <Text variant="caption-1" color="secondary" className="status-bar__cursor">
      {pos.line}:{pos.col}
    </Text>
  );
}

/** Нижняя панель: бейдж расширения и курсор слева; spellcheck, язык, тема — справа. */
export function StatusBar() {
  const activePath = useEditorStore((s) => s.activePath);

  return (
    <div className="status-bar">
      {activePath && <FileTypeBadge path={activePath} />}
      {activePath && <CursorPosition />}
      <div className="status-bar__right">
        <SpellcheckToggle />
        <LanguageSelector />
        <ThemeToggle />
      </div>
    </div>
  );
}
