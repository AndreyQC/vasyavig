import {Button, Icon, Text, Tooltip} from "@gravity-ui/uikit";
import {LetterAUnderline} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useSpellStore, type SpellLang} from "../../store/spellStore";

const LANG_LABELS: Record<SpellLang, string> = {ru: "RU", en: "EN", both: "RU+EN"};
const LANG_CYCLE: SpellLang[] = ["both", "ru", "en"];

/** Индикатор и переключатель live-проверки орфографии (идея §5.2 StatusBar). */
export function SpellcheckToggle() {
  const {t} = useTranslation();
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
      <Tooltip content={t(enabled ? "spell.disable" : "spell.enable")}>
        <Button view={enabled ? "normal" : "flat"} size="s" onClick={() => setEnabled(!enabled)}>
          <Icon data={LetterAUnderline} size={14} />
          <Text variant="caption-2">{t(enabled ? "spell.on" : "spell.off")}</Text>
        </Button>
      </Tooltip>
      <Tooltip content={t("spell.dictionary")}>
        <Button view="flat" size="s" onClick={cycleLang}>
          <Text variant="caption-2">{LANG_LABELS[lang]}</Text>
        </Button>
      </Tooltip>
    </div>
  );
}
