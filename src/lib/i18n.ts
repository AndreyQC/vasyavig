import i18n from "i18next";
import {initReactI18next} from "react-i18next";
import {configure as uikitConfigure} from "@gravity-ui/uikit";
import {configure as mdConfigure, Lang as MdLang} from "@gravity-ui/markdown-editor";
import ru from "../locales/ru/translation.json";
import en from "../locales/en/translation.json";

type UiLang = "ru" | "en";

/** Читаем сохранённый язык из localStorage напрямую (без циклического импорта uiStore). */
function getInitialLang(): UiLang {
  try {
    const raw = localStorage.getItem("vasyavig.settings");
    const lang = raw ? (JSON.parse(raw) as {state?: {lang?: string}}).state?.lang : undefined;
    return lang === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

/** Синхронизация языка с Gravity UI Kit и markdown-editor. */
export function applyGravityLang(lang: UiLang) {
  uikitConfigure({lang});
  mdConfigure({lang: lang === "ru" ? MdLang.Ru : MdLang.En});
}

const initialLang = getInitialLang();

i18n.use(initReactI18next).init({
  resources: {
    ru: {translation: ru},
    en: {translation: en},
  },
  lng: initialLang,
  fallbackLng: "ru",
  interpolation: {escapeValue: false},
});

applyGravityLang(initialLang);

export default i18n;
