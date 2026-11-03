/**
 * NER-детектор на правилах (Phase 8.5, T2; план 20261104_003, N1–N7):
 * ru-compromise (#Person/#City/#Country, точные offsets) + lvovich
 * (getMiddlenameGender — фильтр отчеств) + свои regex (инициалы+фамилия,
 * юр. формы, гео-подсказки). Типы PERSON/ORG/LOC; сменный детектор "ner"
 * в общем реестре (D3). `\b`/`\w` не используются — только lookaround
 * (критерий приёмки §8 диалога 20261103_002).
 */

import nlp from "ru-compromise";
import {getMiddlenameGender} from "lvovich";
import {mergeSpans} from "./detectors";
import {currentEntityTypes} from "../../entityTypes";
import type {DetectorSpan, EntityType} from "./types";

/** Кириллические границы: lookaround вместо `\b` (по кириллице он не работает). */
const NOT_CYR_BEFORE = "(?<![А-Яа-яЁё])";
const NOT_CYR_AFTER = "(?![А-Яа-яЁё])";

/** Юр. формы для ORG (N5). */
const LEGAL_FORMS =
  "(?:ООО|ОАО|ЗАО|ПАО|НАО|АО|НКО|ИП|ГК|ФГУП|МУП|ФНС|ИФНС|МИФНС|ПФР|ФСС|ФСТЭК)";

interface NerRule {
  type: Extract<EntityType, "PERSON" | "ORG" | "LOC">;
  /** Глобальный regex; спан = группа nameGroup (если задана) либо всё совпадение. */
  re: RegExp;
  nameGroup?: number;
  /** N3: кандидат-отчество обязан пройти lvovich-фильтр. */
  patronymicFilter?: boolean;
}

const RULES: readonly NerRule[] = [
  {
    // N4: «И. И. Иванов» (+опциональное отчество после фамилии)
    type: "PERSON",
    re: new RegExp(
      `${NOT_CYR_BEFORE}[А-ЯЁ]\\.[ \\t]?[А-ЯЁ]\\.[ \\t]+[А-ЯЁ][а-яё]{1,25}(?:ович|евич|ич|овна|евна)?${NOT_CYR_AFTER}`,
      "g",
    ),
  },
  {
    // N4: «Иванов И. И.» / «Иванов А.С.» / «Петров А.» (+опц. отчество перед инициалом)
    type: "PERSON",
    re: new RegExp(
      `${NOT_CYR_BEFORE}[А-ЯЁ][а-яё]{1,25}(?:ович|евич|ич|овна|евна)?[ \\t]+[А-ЯЁ]\\.(?:[ \\t]?[А-ЯЁ]\\.)?`,
      "g",
    ),
  },
  {
    // N3: отдельно стоящее отчество; фильтр lvovich отсекает обычные слова на -ич
    type: "PERSON",
    re: new RegExp(
      `${NOT_CYR_BEFORE}[А-ЯЁ][а-яё]{2,}(?:ович|евич|ич|овна|евна|инична)${NOT_CYR_AFTER}`,
      "g",
    ),
    patronymicFilter: true,
  },
  {
    // N5: юр. форма (+ имя в кавычках или 1–3 капитализированных слова)
    type: "ORG",
    re: new RegExp(
      `${NOT_CYR_BEFORE}${LEGAL_FORMS}` +
        `(?:[ \\t]+(?:«[^«»]{2,60}»|"[^"]{2,60}"` +
        `|[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9-]{1,30}(?:[ \\t]+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9-]{1,30}){0,2}))?` +
        NOT_CYR_AFTER,
      "g",
    ),
  },
  {
    // N6: «г. Москве» / «ул. Пушкина» — значение = имя, ключевое слово видно (как R5)
    type: "LOC",
    re: new RegExp(
      `${NOT_CYR_BEFORE}(?:г|гор|ул|улица|просп|пр-т|ш|шоссе|бул|наб|пер)\\.([ \\t]+)([А-ЯЁ][а-яё]{1,30})`,
      "g",
    ),
    nameGroup: 2,
  },
];

/** Спаны из своих regex; lvovich-фильтр для правил с patronymicFilter (N3). */
function ruleSpans(text: string): DetectorSpan[] {
  const spans: DetectorSpan[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.re)) {
      let start: number;
      let value: string;
      if (rule.nameGroup != null) {
        value = match[rule.nameGroup] ?? "";
        if (value === "") continue;
        start = match.index + match[0].lastIndexOf(value);
      } else {
        value = match[0];
        start = match.index;
      }
      if (rule.patronymicFilter && getMiddlenameGender(value) == null) continue;
      spans.push({start, end: start + value.length, value, type: rule.type, detector: "ner"});
    }
  }
  return spans;
}

/** ru-compromise: термы Person/FirstName/LastName → PERSON, City/Country → LOC. */
function compromiseSpans(text: string): DetectorSpan[] {
  const spans: DetectorSpan[] = [];
  let runStart = -1;
  let runEnd = -1;
  let runOpen = false;

  const flushPerson = () => {
    if (!runOpen) return;
    spans.push({
      start: runStart,
      end: runEnd,
      value: text.slice(runStart, runEnd),
      type: "PERSON",
      detector: "ner",
    });
    runOpen = false;
  };

  for (const sentence of nlp(text).json({offset: true})) {
    for (const term of sentence.terms ?? []) {
      const start = term.offset?.start;
      const length = term.offset?.length;
      if (typeof start !== "number" || typeof length !== "number") continue;
      const tags = term.tags ?? [];
      const end = start + length;

      const isPerson = tags.includes("Person") || tags.includes("FirstName") || tags.includes("LastName");
      if (isPerson) {
        // N2: соседние person-термы через один пробел — один спан (полное ФИО).
        if (runOpen && start === runEnd + 1 && text.charAt(runEnd) === " ") {
          runEnd = end;
        } else {
          flushPerson();
          runStart = start;
          runEnd = end;
          runOpen = true;
        }
        continue;
      }
      flushPerson();
      if (tags.includes("Organization")) {
        // Доменный словарь (addWords): бренды без юр. формы (HY-5)
        spans.push({start, end, value: text.slice(start, end), type: "ORG", detector: "ner"});
        continue;
      }
      if (tags.includes("City") || tags.includes("Country")) {
        spans.push({start, end, value: text.slice(start, end), type: "LOC", detector: "ner"});
      }
    }
  }
  flushPerson();
  return spans;
}

/** Найти NER-сущности PERSON/ORG/LOC; пересечения — longest-wins (mergeSpans, R8). */
export function detectNer(text: string): DetectorSpan[] {
  if (text.trim() === "") return [];
  return mergeSpans([...ruleSpans(text), ...compromiseSpans(text)]);
}

/** Тег ru-compromise для типа доменного словаря (спайк §6: addWords). */
const DICTIONARY_TAGS: Readonly<Record<string, string>> = {
  org: "Organization",
  person: "Person",
  loc: "City",
};

let dictionaryApplied = new Set<string>();

/**
 * Подключить доменный словарь NER из справочника `harness.yaml` (HY-5):
 * `Газпром: org` → `nlp.addWords({'Газпром': 'Organization'})`. Идемпотентно
 * (слово добавляется один раз); вызывается перед NER-прогонами.
 */
export function applyDomainDictionary(): void {
  for (const {word, type} of currentEntityTypes().dictionary) {
    const tag = DICTIONARY_TAGS[type];
    if (tag == null || dictionaryApplied.has(word)) continue;
    nlp.addWords({[word]: tag});
    dictionaryApplied.add(word);
  }
}
