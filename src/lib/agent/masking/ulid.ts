/**
 * Генератор ULID (Phase 8.5, T1): 48 бит времени (мс) + 80 бит случайности,
 * Crockford base32 (26 символов, без I/L/O/U). Монотонный в пределах прогона:
 * вызовы в одной миллисекунде дают строго возрастающие значения — как `make
 * doc-index` в harness-репо. В приложении до сих пор был только парсинг ULID
 * (`isPlausibleUlid`), генерация появляется здесь же (план 20261104_001).
 *
 * Формат совпадает с harness-ULID: тот же алфавит и длина, поэтому `isPlausibleUlid`
 * из `harnessEnvelope` валидирует и эти значения.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const RANDOM_BITS = 80n;
const RANDOM_MASK = (1n << RANDOM_BITS) - 1n;

/** 80-битная случайность из crypto; инъекция — для детерминированных тестов. */
export type UlidRng = () => bigint;

const defaultRng: UlidRng = () => {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
};

let lastTime = -1;
let lastRandom = 0n;

/** Сброс монотонного состояния (только тесты). */
export function resetUlidMonotonic(): void {
  lastTime = -1;
  lastRandom = 0n;
}

/** ULID: 10 символов времени + 16 символов случайности, лексикографически сортируемый. */
export function generateUlid(now: number = Date.now(), rng: UlidRng = defaultRng): string {
  let time = Math.floor(now);
  let random: bigint;
  if (time === lastTime) {
    random = (lastRandom + 1n) & RANDOM_MASK;
    if (random === 0n) time += 1; // переполнение 80 бит — практически невозможно
  } else {
    random = rng() & RANDOM_MASK;
  }
  lastTime = time;
  lastRandom = random;
  return encodeTime(time) + encodeRandom(random);
}

function encodeTime(time: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function encodeRandom(random: bigint): string {
  let out = "";
  for (let i = RANDOM_LEN - 1; i >= 0; i--) {
    out = ENCODING[Number((random >> BigInt(5 * i)) & 31n)] + out;
  }
  return out;
}
