use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use zspell::Dictionary;

/// Словари зашиты в бинарь (идея §9.2 с упрощением: без копирования в app_data_dir —
/// файлы read-only, пользовательские слова хранятся отдельно).
const RU_AFF: &str = include_str!("../../resources/dictionaries/ru_RU.aff");
const RU_DIC: &str = include_str!("../../resources/dictionaries/ru_RU.dic");
const EN_AFF: &str = include_str!("../../resources/dictionaries/en_US.aff");
const EN_DIC: &str = include_str!("../../resources/dictionaries/en_US.dic");

pub struct SpellService {
    ru: Dictionary,
    en: Dictionary,
    /// Пользовательские слова (lowercase), дополняются командой add_word_to_dictionary.
    user_words: Mutex<HashSet<String>>,
}

static SERVICE: OnceLock<SpellService> = OnceLock::new();

/// Ленивая инициализация: парсинг словарей (~4 МБ) происходит один раз при первом
/// обращении (или заранее в фоне при старте приложения).
pub fn service() -> &'static SpellService {
    SERVICE.get_or_init(SpellService::new)
}

impl SpellService {
    fn new() -> Self {
        let ru = zspell::builder()
            .config_str(RU_AFF)
            .dict_str(RU_DIC)
            .build()
            .expect("failed to build ru_RU dictionary");
        let en = zspell::builder()
            .config_str(EN_AFF)
            .dict_str(EN_DIC)
            .build()
            .expect("failed to build en_US dictionary");
        Self {
            ru,
            en,
            user_words: Mutex::new(HashSet::new()),
        }
    }

    fn is_user_word(&self, word: &str) -> bool {
        self.user_words
            .lock()
            .map(|set| set.contains(&word.to_lowercase()))
            .unwrap_or(false)
    }

    /// Слово корректно, если оно в пользовательском словаре или в одном из
    /// активных словарей (идея §4.4.2: both — хотя бы в одном).
    pub fn check(&self, word: &str, lang: &str) -> bool {
        if self.is_user_word(word) {
            return true;
        }
        match lang {
            "ru" => self.ru.check_word(word),
            "en" => self.en.check_word(word),
            _ => self.ru.check_word(word) || self.en.check_word(word),
        }
    }

    /// Варианты замены (до 5 штук).
    pub fn suggest(&self, word: &str, lang: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut collect = |dic: &Dictionary| {
            if let Some(list) = dic.entry(word).suggest() {
                for s in list {
                    if out.len() >= 5 {
                        break;
                    }
                    out.push(s.to_string());
                }
            }
        };
        match lang {
            "ru" => collect(&self.ru),
            "en" => collect(&self.en),
            _ => {
                collect(&self.ru);
                collect(&self.en);
            }
        }
        out
    }

    pub fn add_user_word(&self, word: &str) {
        if let Ok(mut set) = self.user_words.lock() {
            set.insert(word.to_lowercase());
        }
    }

    pub fn load_user_words(&self, words: Vec<String>) {
        if let Ok(mut set) = self.user_words.lock() {
            for w in words {
                set.insert(w.to_lowercase());
            }
        }
    }
}

/// Разбивает текст на слова: последовательности букв (Unicode).
/// Возвращает (слово, start, end) с офсетами в СИМВОЛАХ — их ждёт frontend
/// для маппинга в ProseMirror-позиции.
pub fn tokenize(text: &str) -> Vec<(String, usize, usize)> {
    let mut words = Vec::new();
    let mut start: Option<usize> = None;

    for (i, ch) in text.chars().enumerate() {
        if ch.is_alphabetic() {
            start.get_or_insert(i);
        } else if let Some(s) = start.take() {
            words.push((text_char_slice(text, s, i), s, i));
        }
    }
    if let Some(s) = start.take() {
        let end = text.chars().count();
        words.push((text_char_slice(text, s, end), s, end));
    }
    words
}

fn text_char_slice(text: &str, start: usize, end: usize) -> String {
    text.chars().skip(start).take(end - start).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_latin() {
        let words = tokenize("hello, world!");
        assert_eq!(
            words,
            vec![
                ("hello".to_string(), 0, 5),
                ("world".to_string(), 7, 12),
            ]
        );
    }

    #[test]
    fn tokenize_cyrillic_offsets_in_chars() {
        let words = tokenize("привет, как дела");
        assert_eq!(
            words,
            vec![
                ("привет".to_string(), 0, 6),
                ("как".to_string(), 8, 11),
                ("дела".to_string(), 12, 16),
            ]
        );
    }

    #[test]
    fn tokenize_splits_on_digits_and_hyphens() {
        let words = tokenize("abc123 деф-гхи");
        assert_eq!(
            words,
            vec![
                ("abc".to_string(), 0, 3),
                ("деф".to_string(), 7, 10),
                ("гхи".to_string(), 11, 14),
            ]
        );
    }

    #[test]
    fn dictionary_checks_russian_and_english() {
        let svc = service();
        assert!(svc.check("привет", "ru"));
        assert!(svc.check("hello", "en"));
        assert!(!svc.check("привееет", "ru"));
        assert!(!svc.check("helllooo", "en"));
        // both: слово валидно, если есть хотя бы в одном словаре
        assert!(svc.check("привет", "both"));
        assert!(svc.check("hello", "both"));
        assert!(!svc.check("qwertyuiop", "both"));
    }

    #[test]
    fn user_words_override() {
        let svc = service();
        let word = "васявигтест";
        assert!(!svc.check(word, "ru"));
        svc.add_user_word(word);
        assert!(svc.check(word, "ru"));
    }
}
