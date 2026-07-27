import {Button, Icon, Text, Tooltip} from "@gravity-ui/uikit";
import {LetterAUnderline} from "@gravity-ui/icons";
import {useSpellStore, type SpellLang} from "../../store/spellStore";

const LANG_LABELS: Record<SpellLang, string> = {ru: "RU", en: "EN", both: "RU+EN"};
const LANG_CYCLE: SpellLang[] = ["both", "ru", "en"];

/** Индикатор и переключатель live-проверки орфографии (идея §5.2 StatusBar). */
export function SpellcheckToggle() {
  const enabled = useSpellStore((s) => s.enabled);
  const lang = useSpellStore((s) => s.lang);
  const setEnabled = useSpellStore((s) => s.setEnabled);
  const setLang = useSpellStore((s) => s.setLang);

  const cycleLang = () => {
    const next = LANG_CYCLE[(LANG_CYCLE.indexOf(lang) + 1) % LANG_CYCLE.length];
    setLang(next);
  };

  return (
    <div className="spellcheck-toggle">
      <Tooltip content={enabled ? "Выключить проверку орфографии" : "Включить проверку орфографии"}>
        <Button view={enabled ? "normal" : "flat"} size="s" onClick={() => setEnabled(!enabled)}>
          <Icon data={LetterAUnderline} size={14} />
          <Text variant="caption-2">{enabled ? "ON" : "OFF"}</Text>
        </Button>
      </Tooltip>
      <Tooltip content="Словарь проверки">
        <Button view="flat" size="s" onClick={cycleLang}>
          <Text variant="caption-2">{LANG_LABELS[lang]}</Text>
        </Button>
      </Tooltip>
    </div>
  );
}
