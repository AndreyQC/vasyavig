import {SegmentedRadioGroup, Tooltip} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useUiStore, type UiLang} from "../../store/uiStore";
import {applyGravityLang} from "../../lib/i18n";

/** Переключатель языка интерфейса: RU | EN (идея §4.6). */
export function LanguageSelector() {
  const {t, i18n} = useTranslation();
  const lang = useUiStore((s) => s.lang);
  const setLang = useUiStore((s) => s.setLang);

  const onChange = (value: string) => {
    const next = value as UiLang;
    setLang(next);
    i18n.changeLanguage(next);
    applyGravityLang(next);
  };

  return (
    <Tooltip content={t("lang.label")}>
      <SegmentedRadioGroup size="s" value={lang} onUpdate={onChange}>
        <SegmentedRadioGroup.Option value="ru">RU</SegmentedRadioGroup.Option>
        <SegmentedRadioGroup.Option value="en">EN</SegmentedRadioGroup.Option>
      </SegmentedRadioGroup>
    </Tooltip>
  );
}
