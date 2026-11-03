/**
 * Обратная склонялка для матчинга сущностей (Phase 8.5, T3d; план
 * 20261105_004, T3d-1): lvovich генерирует падежные формы от канонической
 * формы записи индекса. Назначение — узнавать неразмеченные склонённые
 * значения («Ивановым И. И.»), которых ещё нет в `forms`, и связывать их с
 * постоянным ULID (связность P1 без ручной разметки). Сгенерированные формы
 * — слой матчинга: в `entities.jsonl` не пишутся (наблюдаемые формы
 * дописываются при разметке/сохранении, как раньше).
 *
 * Проверено спайками lvovich 2.1.0:
 * - incline* работают только от именительного падежа; косвенная форма
 *   («Иванову») возвращается как есть → база генерации выбирается из
 *   (canonical + forms) как первая «склоняемая» форма (T3d-4);
 * - getMiddlenameGender признаёт женские имена («Анна») отчествами →
 *   отчество ищется в ПОСЛЕДНЕМ слове (порядок ФИО) с суффикс-фолбэком
 *   (-ович/-евич/-ич/-овна/-евна/-инична) — разговорные («Иваныч»).
 */

import {
  cityFrom,
  cityIn,
  cityTo,
  getMiddlenameGender,
  inclineFirstname,
  inclineLastname,
  inclineMiddlename,
} from "lvovich";

const CASES = ["nominative", "genitive", "dative", "accusative", "instrumental", "prepositional"] as const;

/** Инициал: одна заглавная буква с точкой (А.) или две слитно (А.С.). */
const INITIAL_RE = /^[А-ЯЁ]\.(?:[А-ЯЁ]\.)?$/;

/** Разговорные/нестандартные отчества: суффикс-фолбэк (lvovich словарь не полный). */
const PATRONYMIC_SUFFIX_RE = /(?:ович|евич|ьич|ыч|ич|овна|евна|инична)$/;

/** Слово меняется при склонении → lvovich распознал его (база-nominative). */
function isDeclinable(word: string, kind: "last" | "first" | "middle"): boolean {
  try {
    const fn = kind === "last" ? inclineLastname : kind === "first" ? inclineFirstname : inclineMiddlename;
    return fn(word, "genitive") !== word;
  } catch {
    return false;
  }
}

interface PersonParts {
  initials: string[]; // «И.», «И.С.» — как в canonical
  lastname?: string; // первое не-инициал слово
  firstname?: string; // второе не-инициал слово
  middlename?: string; // последнее слово (словарное или суффикс)
}

/** Разбор canonical персоналии; отчество — последнее слово (порядок ФИО). */
export function parsePersonCanonical(canonical: string): PersonParts {
  const tokens = canonical.split(/\s+/).filter(Boolean);
  const parts: PersonParts = {initials: []};
  const words: string[] = [];
  for (const token of tokens) {
    if (INITIAL_RE.test(token)) parts.initials.push(token);
    else words.push(token);
  }
  const last = words[words.length - 1];
  if (last != null && (getMiddlenameGender(last) != null || PATRONYMIC_SUFFIX_RE.test(last))) {
    parts.middlename = last;
    words.pop();
  }
  if (words.length > 0) parts.lastname = words[0];
  if (words.length > 1) parts.firstname = words[1];
  return parts;
}

/** Формы персоналии: 6 падежей × шаблоны (с инициалами и без). */
function expandPerson(base: string): string[] {
  const parts = parsePersonCanonical(base);
  const out = new Set<string>([base]);
  // Порождение инициалов из имени/отчества в обоих стилях: «И. И.» и «И.И.»
  const derived: string[] = [];
  if (parts.firstname != null && parts.middlename != null) {
    const f = parts.firstname.charAt(0);
    const m = parts.middlename.charAt(0);
    derived.push(`${f}. ${m}.`, `${f}.${m}.`);
  }
  const initialVariants = parts.initials.length > 0
    ? [parts.initials.join(" ")]
    : derived;
  for (const caseName of CASES) {
    const last = parts.lastname != null ? inclineLastname(parts.lastname, caseName) : undefined;
    const first = parts.firstname != null ? inclineFirstname(parts.firstname, caseName) : undefined;
    const middle = parts.middlename != null ? inclineMiddlename(parts.middlename, caseName) : undefined;

    for (const initials of initialVariants) {
      if (last != null) {
        out.add(`${last} ${initials}`);
        out.add(`${initials} ${last}`);
      }
    }
    if (last != null && first != null) {
      out.add([last, first, middle].filter(Boolean).join(" "));
    }
  }
  return [...out].filter((form) => form.trim() !== "");
}

/** Формы города: именительный + три городских падежа lvovich. */
function expandLoc(base: string): string[] {
  const out = new Set<string>([base]);
  for (const fn of [cityTo, cityFrom, cityIn]) {
    try {
      out.add(fn(base));
    } catch {
      // lvovich не знает топоним — пропускаем
    }
  }
  return [...out].filter((form) => form.trim() !== "");
}

/**
 * Выбрать базу генерации: первая из (canonical, forms), где ключевое слово
 * склоняемое (lvovich понял nominative). Косвенный canonical без
 * nominative-форм — генерация невозможна, вернём только сами формы.
 */
function pickBase(canonical: string, forms: readonly string[]): string {
  for (const candidate of [canonical, ...forms]) {
    const parts = parsePersonCanonical(candidate);
    if (parts.lastname != null && isDeclinable(parts.lastname, "last")) return candidate;
  }
  return canonical;
}

const cache = new Map<string, string[]>();

/**
 * Все формы для матчинга по типу и канонической форме (+ наблюдаемые формы —
 * источник nominative-базы, T3d-4). PERSON — 6 падежей × шаблоны; LOC —
 * городские падежи; остальные типы не склоняются. Кэш по (type, canonical).
 */
export function expandEntityForms(
  canonical: string,
  type: string,
  forms: readonly string[] = [],
): string[] {
  const key = `${type}\u0000${canonical}`;
  const cached = cache.get(key);
  if (cached != null) return cached;
  const observed = [canonical, ...forms];
  let generated: string[];
  if (type.toLowerCase() === "person") generated = expandPerson(pickBase(canonical, forms));
  else if (type.toLowerCase() === "loc") generated = expandLoc(canonical);
  else generated = [];
  const result = [...new Set([...observed, ...generated])].filter((f) => f.trim() !== "");
  cache.set(key, result);
  return result;
}

/** Тестовый хук: сброс кэша форм. */
export function resetDeclensionCache(): void {
  cache.clear();
}
