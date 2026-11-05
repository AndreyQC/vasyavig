/**
 * Валидаторы кандидатов (Phase 8.5, T6-9; план 20261105_009).
 *
 * Идея из `guardrails-llm-filter`: правило даёт **кандидата**, валидатор
 * решает, годен ли он. «12 цифр» → «12 цифр с верной контрольной суммой»
 * поднимает precision на порядок (в guardrails: 99,9 % на PII-бенчмарках).
 *
 * Алгоритмы портированы дословно из
 * `guardrails-llm-filter/pkg/guardrails/regex/validation/checksums.go`.
 */

/** Остаток десятичной строки по модулю 97. */
function mod97DecimalString(value: string): number {
  let remainder = 0;
  for (const char of value) {
    remainder = (remainder * 10 + (char.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

/** Сумма Luhn. */
export function luhnSum(digits: string): number {
  let sum = 0;
  const n = digits.length;
  const parity = n % 2;
  for (let i = 0; i < n; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === parity) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum;
}

/** Проверка Luhn (карты). */
export function luhnValid(digits: string): boolean {
  if (digits.length === 0) return false;
  if (!/^\d+$/.test(digits)) return false;
  return luhnSum(digits) % 10 === 0;
}

/** Контрольное число СНИЛС для 9 цифр. */
export function snilsChecksum(nineDigits: string): string {
  if (nineDigits.length !== 9) return "00";
  let sum = 0;
  for (let i = 0; i < nineDigits.length; i++) {
    sum += (nineDigits.charCodeAt(i) - 48) * (9 - i);
  }
  let checksum = sum % 101;
  if (checksum > 99) checksum = 0;
  return String(Math.floor(checksum / 10)) + String(checksum % 10);
}

/** Проверка СНИЛС (11 цифр). */
export function snilsValid(digits: string): boolean {
  if (digits.length !== 11) return false;
  if (!/^\d+$/.test(digits)) return false;
  const checksum = snilsChecksum(digits.slice(0, 9));
  return digits[9] === checksum[0] && digits[10] === checksum[1];
}

function weightedChecksum(digits: readonly number[], weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += digits[i] * weights[i];
  return (sum % 11) % 10;
}

/** Две контрольные цифры ИНН физлица для 10 цифр. */
export function innPersonChecksums(tenDigits: string): [number, number] {
  const d = (i: number): number => tenDigits.charCodeAt(i) - 48;
  const v1 =
    ((7 * d(0) + 2 * d(1) + 4 * d(2) + 10 * d(3) + 3 * d(4) + 5 * d(5) + 9 * d(6) + 4 * d(7) +
      6 * d(8) + 8 * d(9)) %
      11) %
    10;
  const digits: number[] = [];
  for (let i = 0; i < 10; i++) digits.push(d(i));
  digits.push(v1);
  const v2 = weightedChecksum(digits, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  return [v1, v2];
}

/** Проверка ИНН физлица (12 цифр). */
export function innPersonValid(digits: string): boolean {
  if (digits.length !== 12) return false;
  if (!/^\d+$/.test(digits)) return false;
  const [c1, c2] = innPersonChecksums(digits.slice(0, 10));
  return digits.charCodeAt(10) - 48 === c1 && digits.charCodeAt(11) - 48 === c2;
}

/** Контрольная цифра ИНН юрлица для 9 цифр. */
export function innOrgChecksum(nineDigits: string): number {
  const d = (i: number): number => nineDigits.charCodeAt(i) - 48;
  return (
    ((2 * d(0) + 4 * d(1) + 10 * d(2) + 3 * d(3) + 5 * d(4) + 9 * d(5) + 4 * d(6) + 6 * d(7) +
      8 * d(8)) %
      11) %
    10
  );
}

/** Проверка ИНН юрлица (10 цифр). */
export function innOrgValid(digits: string): boolean {
  if (digits.length !== 10) return false;
  if (!/^\d+$/.test(digits)) return false;
  return digits.charCodeAt(9) - 48 === innOrgChecksum(digits.slice(0, 9));
}

/** Контрольная цифра ОГРН для 12 цифр. */
export function ogrnCheckDigit(twelveDigits: string): number {
  let n = 0;
  for (const char of twelveDigits) n = n * 10 + (char.charCodeAt(0) - 48);
  return (n % 11) % 10;
}

/** Проверка ОГРН (13 цифр). */
export function ogrnValid(digits: string): boolean {
  if (digits.length !== 13) return false;
  if (!/^\d+$/.test(digits)) return false;
  return digits.charCodeAt(12) - 48 === ogrnCheckDigit(digits.slice(0, 12));
}

/** Контрольная цифра ОГРНИП для 14 цифр. */
export function ogrnipCheckDigit(fourteenDigits: string): number {
  let remainder = 0;
  for (const char of fourteenDigits) {
    remainder = (remainder * 10 + (char.charCodeAt(0) - 48)) % 13;
  }
  return remainder % 10;
}

/** Проверка ОГРНИП (15 цифр). */
export function ogrnipValid(digits: string): boolean {
  if (digits.length !== 15) return false;
  if (!/^\d+$/.test(digits)) return false;
  return digits.charCodeAt(14) - 48 === ogrnipCheckDigit(digits.slice(0, 14));
}

/** Проверка IBAN (mod-97). */
export function ibanValid(value: string): boolean {
  const iban = value.toUpperCase().replace(/ /g, "");
  if (iban.length < 4) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numStr = "";
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      numStr += String(code - 65 + 10);
      continue;
    }
    numStr += char;
  }
  if (!/^\d+$/.test(numStr)) return false;
  return mod97DecimalString(numStr) === 1;
}

/** Email: только ASCII-символы, есть «@» и домен с точкой. */
export function emailAsciiValid(value: string): boolean {
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value)) return false;
  // eslint-disable-next-line no-control-regex
  return !/[^\x20-\x7E]/.test(value);
}

/** Энтропия Шеннона (бит на символ). */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Тип валидатора по имени (имя как в guardrails). */
export type ValidatorName =
  | "luhn"
  | "snils"
  | "inn_person"
  | "inn_org"
  | "ogrn"
  | "ogrnip"
  | "iban"
  | "email_ascii";

const VALIDATORS: Record<ValidatorName, (value: string) => boolean> = {
  luhn: luhnValid,
  snils: snilsValid,
  inn_person: innPersonValid,
  inn_org: innOrgValid,
  ogrn: ogrnValid,
  ogrnip: ogrnipValid,
  iban: ibanValid,
  email_ascii: emailAsciiValid,
};

/** Валидаторы, работающие по цифрам: значение предварительно очищается. */
const DIGIT_VALIDATORS = new Set<ValidatorName>([
  "luhn",
  "snils",
  "inn_person",
  "inn_org",
  "ogrn",
  "ogrnip",
]);

/** Только цифры из значения (как `stripNonDigits` в guardrails). */
export function stripNonDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Применить валидаторы к кандидату: все должны пройти. */
export function runValidators(value: string, names: readonly string[]): boolean {
  for (const name of names) {
    const validator = VALIDATORS[name as ValidatorName];
    // неизвестный валидатор не блокирует (fail-open по правилу)
    if (!validator) continue;
    const candidate = DIGIT_VALIDATORS.has(name as ValidatorName) ? stripNonDigits(value) : value;
    if (!validator(candidate)) return false;
  }
  return true;
}
