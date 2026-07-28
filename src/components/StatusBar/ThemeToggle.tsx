import {Button, Icon, Tooltip} from "@gravity-ui/uikit";
import {Display, Moon, Sun} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useUiStore, type ThemeMode} from "../../store/uiStore";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];
const THEME_ICONS = {system: Display, light: Sun, dark: Moon} as const;

/** Переключатель темы: system -> light -> dark (идея §4.5). */
export function ThemeToggle() {
  const {t} = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];

  return (
    <Tooltip content={t(`theme.${theme}`)}>
      <Button view="flat" size="s" onClick={() => setTheme(next)}>
        <Icon data={THEME_ICONS[theme]} size={14} />
      </Button>
    </Tooltip>
  );
}
