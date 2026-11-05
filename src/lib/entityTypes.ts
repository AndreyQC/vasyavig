/**
 * Справочник типов сущностей из `harness.yaml` (Phase 8.5, T3c; план
 * 20261105_002, HY-4/HY-5): секция `entities:` — флаг `masking` у системных
 * типов, кастомные типы без маскирования (проекты/репозитории — разметка для
 * графов), подписи ru/en, доменный словарь NER.
 *
 * Дефолт без секции — системные 7 типов с `masking: true` (нулевая
 * конфигурация = поведение T3). Активная конфигурация — модульное состояние
 * (последний загруженный harness-корень); тесты сбрасывают.
 */

import {parseDocument} from "yaml";
import {defaultReadProbe, findHarnessRoot, type ReadProbe} from "./harnessIndex";
import type {EntityType} from "./agent/masking/types";
import {setCustomDetectorRules} from "./agent/masking/detectors";
import {parseDetectorRules} from "./agent/masking/rules";

/** Системные типы — участвуют в маскировании и алиасах. */
export const SYSTEM_ENTITY_TYPES: readonly EntityType[] = [
  "PERSON",
  "ORG",
  "LOC",
  "SECRET",
  "EMAIL",
  "PHONE",
  "URL_CRED",
];

const SYSTEM_TOKENS: ReadonlySet<string> = new Set(
  SYSTEM_ENTITY_TYPES.map((type) => type.toLowerCase()),
);

export interface EntityTypeDef {
  /** lowercase-токен ([a-z_]+), как в href. */
  token: string;
  /** Участвует в маскировании (алиасы, словарь промпта, unmask). */
  masking: boolean;
  /** Кастомный тип из harness.yaml (не маскируется по определению). */
  custom: boolean;
  labelRu?: string;
  labelEn?: string;
}

export interface EntityTypesConfig {
  /** По токену; порядок — системные, затем кастомные (как в yaml). */
  defs: EntityTypeDef[];
  /** Доменный словарь NER: слово → токен типа (org|person|loc). */
  dictionary: Array<{word: string; type: string}>;
}

export function defaultEntityTypes(): EntityTypesConfig {
  return {
    defs: SYSTEM_ENTITY_TYPES.map((type) => ({
      token: type.toLowerCase(),
      masking: true,
      custom: false,
    })),
    dictionary: [],
  };
}

const TYPE_TOKEN_RE = /^[a-z_]+$/;

/**
 * Разбор секции `entities:` (HY-4). Системные типы: допустим только флаг
 * `masking` (по умолчанию true). Кастомные: `label {ru,en}`, токен
 * `[a-z_]+`; `masking` у кастомных игнорируется (не маскируются). Секция
 * `dictionary` — слово → org|person|loc. Битые куски пропускаются.
 */
export function parseEntityTypes(text: string): EntityTypesConfig {
  const result = defaultEntityTypes();
  let raw: unknown;
  try {
    raw = parseDocument(text, {uniqueKeys: true}).toJS();
  } catch {
    return result;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;
  const entities = (raw as {entities?: unknown}).entities;
  if (typeof entities !== "object" || entities === null) return result;
  const section = entities as Record<string, unknown>;

  for (const [token, value] of Object.entries(section)) {
    if (token === "dictionary") continue;
    if (!TYPE_TOKEN_RE.test(token) || typeof value !== "object" || value === null) continue;
    const fields = value as Record<string, unknown>;
    if (SYSTEM_TOKENS.has(token)) {
      const def = result.defs.find((d) => d.token === token);
      if (def) def.masking = fields.masking !== false;
      continue;
    }
    const label = (fields.label ?? {}) as {ru?: unknown; en?: unknown};
    result.defs.push({
      token,
      masking: false,
      custom: true,
      labelRu: typeof label.ru === "string" ? label.ru : undefined,
      labelEn: typeof label.en === "string" ? label.en : undefined,
    });
  }

  const dictionary = section.dictionary;
  if (typeof dictionary === "object" && dictionary !== null && !Array.isArray(dictionary)) {
    for (const [word, type] of Object.entries(dictionary as Record<string, unknown>)) {
      if (typeof type !== "string") continue;
      const token = type.toLowerCase();
      if (token !== "org" && token !== "person" && token !== "loc") continue;
      result.dictionary.push({word, type: token});
    }
  }
  return result;
}

let active: EntityTypesConfig = defaultEntityTypes();

/** Активный справочник (валидация href, маскирование, UI). */
export function currentEntityTypes(): EntityTypesConfig {
  return active;
}

/** Подменить активный справочник (загрузка/тесты). */
export function setEntityTypes(config: EntityTypesConfig): void {
  active = config;
}

/** Сброс к дефолту (тесты). */
export function resetEntityTypes(): void {
  active = defaultEntityTypes();
}

/**
 * Загрузить справочник по каталогу: harness-корень по якорю `harness.yaml`
 * → секция `entities:`. Нет якоря/секции — дефолт (системные 7). Всегда
 * устанавливает результат активным.
 */
export async function ensureEntityTypes(dir: string, probe: ReadProbe = defaultReadProbe): Promise<EntityTypesConfig> {
  const root = await findHarnessRoot(dir, probe);
  if (root == null) {
    setEntityTypes(defaultEntityTypes());
    setCustomDetectorRules([]);
    return currentEntityTypes();
  }
  const text = await probe(`${root}/harness.yaml`);
  const config = text == null ? defaultEntityTypes() : parseEntityTypes(text);
  setEntityTypes(config);
  // T6-9: пользовательские правила-детекторы из той же harness.yaml.
  setCustomDetectorRules(text == null ? [] : parseDetectorRules(text));
  return config;
}

/** Токен известен справочнику (валидация href vas-entity). */
export function knownEntityTypeToken(token: string): boolean {
  return currentEntityTypes().defs.some((def) => def.token === token);
}

/** Тип участвует в маскировании (системный + masking: true). */
export function isMaskingTypeToken(token: string): boolean {
  const def = currentEntityTypes().defs.find((d) => d.token === token);
  return def != null && def.masking && !def.custom;
}

/** Системный EntityType по токену (для алиаса/статистики); null — кастомный. */
export function systemTypeOfToken(token: string): EntityType | null {
  const type = token.toUpperCase() as EntityType;
  return SYSTEM_TOKENS.has(token) ? type : null;
}

/**
 * Подпись типа для UI: кастомный — label по языку из справочника, системный —
 * ключ i18n `assistant.entityType.<token>` (возвращает null — подпись через t()).
 */
export function customTypeLabel(token: string, lang: string): string | null {
  const def = currentEntityTypes().defs.find((d) => d.token === token);
  if (def == null || !def.custom) return null;
  return (lang.toLowerCase().startsWith("ru") ? def.labelRu : def.labelEn) ?? def.labelRu ?? def.labelEn ?? token;
}
