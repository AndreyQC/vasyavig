/**
 * Конверт harness-yaml в markdown-файлах harness-репозиториев
 * (openspec task 20261025_001, план D1).
 *
 * Порт `scripts/for_make/harness_yaml.py` из harness-репо (семантика 1:1):
 * скрытый HTML-комментарий с маркерами, строго в первых 5 строках файла;
 * внутри — плоское YAML-подмножество (скаляры, строки в двойных кавычках с
 * escape `\"`, инлайн-списки `[a, b]`/`[]`). Vasyavig конверт только читает
 * (мутации — зона `make doc-id` в harness-репо).
 */

const MARKER_OPEN = "[<[harness-yaml]]";
const MARKER_CLOSE = "[[harness-yaml]>]";

/** Конверт ищется только в первых N строках (штамп всегда в шапке файла). */
const HEADER_WINDOW_LINES = 5;

export interface HarnessEnvelope {
  id: string | null;
  project: string | null;
  title: string | null;
  type: string | null;
  created: string | null;
  related: string[];
  basedOn: string[];
}

/** Снимает обёртку комментария строки: `<!-- … -->`, `/* … *\/`, `# …`. */
function unwrapLine(line: string): string {
  let s = line.trim();
  for (const tok of ["<!--", "/*"]) {
    if (s.startsWith(tok)) s = s.slice(tok.length).trim();
  }
  for (const tok of ["-->", "*/"]) {
    if (s.endsWith(tok)) s = s.slice(0, -tok.length).trim();
  }
  while (s.startsWith("#")) s = s.slice(1).trim();
  return s;
}

/** Значение без типа: кавычки снимаются, `\"` -> `"`, `\\` -> `\`. */
function scalarValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return raw;
}

function asScalar(fields: Map<string, string | string[]>, key: string): string | null {
  const v = fields.get(key);
  return typeof v === "string" ? v : null;
}

function asList(fields: Map<string, string | string[]>, key: string): string[] {
  const v = fields.get(key);
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}

/** Строка с открывающим маркером в первых window строк; -1 — маркера нет. */
function findMarkerLine(lines: string[], marker: string, window: number): number {
  for (let i = 0; i < Math.min(window, lines.length); i++) {
    if (unwrapLine(lines[i]) === marker) return i;
  }
  return -1;
}

/**
 * Плоское YAML-подмножество между открывающим маркером (со строки start) и
 * закрывающим: скаляры, строки в двойных кавычках, инлайн-списки и
 * блочные `- ` продолжения последнего ключа. null — закрывающий маркер не
 * найден (конверт повреждён).
 */
function parseFlatYamlFields(
  lines: string[],
  start: number,
  closeMarker: string,
): Map<string, string | string[]> | null {
  const fields = new Map<string, string | string[]>();
  let lastListKey: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    if (unwrapLine(lines[i]) === closeMarker) return fields;
    const s = unwrapLine(lines[i]);
    if (!s) continue;
    if (s.startsWith("- ") && lastListKey) {
      const list = fields.get(lastListKey);
      if (Array.isArray(list)) list.push(scalarValue(s.slice(2).trim()));
      continue;
    }
    const colon = s.indexOf(":");
    if (colon > 0) {
      const key = s.slice(0, colon).trim();
      const raw = s.slice(colon + 1).trim();
      if (raw.startsWith("[") && raw.endsWith("]")) {
        const inner = raw.slice(1, -1).trim();
        fields.set(
          key,
          inner ? inner.split(",").map((v) => scalarValue(v.trim())) : [],
        );
        lastListKey = key;
      } else if (raw === "") {
        fields.set(key, []);
        lastListKey = key;
      } else {
        fields.set(key, scalarValue(raw));
        lastListKey = null;
      }
    }
  }
  return null;
}

/**
 * Разобрать конверт из текста файла; null — конверта нет или он повреждён
 * (нет закрывающего маркера). Упоминания маркеров ниже 5-й строки конвертом
 * не считаются (как в harness_yaml.py).
 */
export function parseHarnessEnvelope(text: string): HarnessEnvelope | null {
  const lines = text.split(/\r?\n/);
  const start = findMarkerLine(lines, MARKER_OPEN, HEADER_WINDOW_LINES);
  if (start === -1) return null;
  const fields = parseFlatYamlFields(lines, start, MARKER_CLOSE);
  if (!fields) return null;
  return {
    id: asScalar(fields, "id"),
    project: asScalar(fields, "project"),
    title: asScalar(fields, "title"),
    type: asScalar(fields, "type"),
    created: asScalar(fields, "created"),
    related: asList(fields, "related"),
    basedOn: asList(fields, "based_on"),
  };
}

// --- task-yaml: второй скрытый конверт задачных документов ---

const TASK_MARKER_OPEN = "[<[task-yaml]]";
const TASK_MARKER_CLOSE = "[[task-yaml]>]";

/**
 * Окно поиска шире, чем у harness-yaml: в эталонных файлах task-yaml стоит
 * после harness-конверта и закладки (~строка 10).
 */
const TASK_HEADER_WINDOW_LINES = 30;

export interface TaskEnvelope {
  kind: string | null;
  status: string | null;
  task: string | null;
  tracker: string | null;
  priority: string | null;
  assignee: string | null;
}

/**
 * Разобрать task-yaml конверт (квота задач: kind/status/task/tracker/
 * priority/assignee, все опциональны); null — конверта нет или он повреждён.
 * Семантика полей та же, что у harness-yaml; `status:` без значения даёт
 * null, `status: ""` — пустую строку.
 */
export function parseTaskEnvelope(text: string): TaskEnvelope | null {
  const lines = text.split(/\r?\n/);
  const start = findMarkerLine(lines, TASK_MARKER_OPEN, TASK_HEADER_WINDOW_LINES);
  if (start === -1) return null;
  const fields = parseFlatYamlFields(lines, start, TASK_MARKER_CLOSE);
  if (!fields) return null;
  return {
    kind: asScalar(fields, "kind"),
    status: asScalar(fields, "status"),
    task: asScalar(fields, "task"),
    tracker: asScalar(fields, "tracker"),
    priority: asScalar(fields, "priority"),
    assignee: asScalar(fields, "assignee"),
  };
}

/** ULID из видимой закладки (`> 🔖 harness-yaml · … id \`01M…\``); null — нет закладки. */
export function parseBookmarkUlid(text: string): string | null {
  const m = /harness-yaml[^\n`]*`([0-9A-Z]{26})`/.exec(text);
  return m ? m[1] : null;
}

/**
 * Скрытые конверты (`<!-- [<[name]] … [[name]>] -->`, harness-yaml/task-yaml и
 * любые будущие того же вида) удалить из текста — для рендера превью (план D13:
 * конверты «скрыты в рендере» по дизайну harness; исходник файла не меняется).
 * Видимая закладка и обычные HTML-комментарии остаются.
 */
const HIDDEN_ENVELOPE_RE = /<!--[^\S\n]*\[<\[(\w[\w-]*)\]\]\r?\n[\s\S]*?\r?\n\[{2}\1\]>\][^\S\n]*-->(?:\r?\n)*/g;

export function stripHiddenEnvelopes(text: string): string {
  return text.replace(HIDDEN_ENVELOPE_RE, "");
}

// --- ULID: валидация и поиск в тексте ---

/** Crockford base32 (без I, L, O, U). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_INDEX = new Map([...CROCKFORD].map((c, i) => [c, i] as const));

const ULID_RE = new RegExp(`^[${CROCKFORD}]{26}$`);
/** ULID-кандидат: 26 символов Crockford, отделён от соседних букв/цифр. */
const ULID_SEARCH_RE = new RegExp(`(?<![0-9A-Za-z])[${CROCKFORD}]{26}(?![0-9A-Za-z])`, "g");

/** Правдоподобное окно таймстемпа ULID: иначе 26-символьные токены — мусор. */
const ULID_TS_MIN_MS = Date.UTC(2020, 0, 1);
const ULID_TS_MAX_MS = Date.UTC(2100, 0, 1);

export function isValidUlidShape(value: string): boolean {
  return ULID_RE.test(value);
}

/** Миллисекунды epoch из первых 10 символов ULID; null для некорректного. */
export function ulidTimestamp(ulid: string): number | null {
  if (!isValidUlidShape(ulid)) return null;
  let value = 0;
  for (const c of ulid.slice(0, 10)) {
    const digit = CROCKFORD_INDEX.get(c);
    if (digit === undefined) return null;
    value = value * 32 + digit;
  }
  return value;
}

/** Форма ULID корректна и таймстемп в правдоподобном окне (фильтр мусора). */
export function isPlausibleUlid(value: string): boolean {
  const ts = ulidTimestamp(value);
  return ts !== null && ts >= ULID_TS_MIN_MS && ts < ULID_TS_MAX_MS;
}

export interface UlidMatch {
  ulid: string;
  start: number;
  end: number;
}

/**
 * Все правдоподобные ULID в тексте (offsets по символам). Неправдоподобные
 * 26-символьные токены (таймстемп вне окна) не возвращаются.
 */
export function findUlidMatches(text: string): UlidMatch[] {
  const matches: UlidMatch[] = [];
  ULID_SEARCH_RE.lastIndex = 0;
  for (let m = ULID_SEARCH_RE.exec(text); m; m = ULID_SEARCH_RE.exec(text)) {
    if (isPlausibleUlid(m[0])) {
      matches.push({ulid: m[0], start: m.index, end: m.index + m[0].length});
    }
  }
  return matches;
}
