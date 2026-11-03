import {describe, expect, it} from "vitest";

import {generateUlid, resetUlidMonotonic} from "./ulid";

const RIGID_RNG = () => 0x0123456789abcdefn & ((1n << 80n) - 1n);

describe("generateUlid", () => {
  it("даёт 26 символов Crockford base32 (без I/L/O/U)", () => {
    const ulid = generateUlid(1730601600000, RIGID_RNG);
    expect(ulid).toHaveLength(26);
    expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("уникален и монотонен в одной миллисекунде", () => {
    resetUlidMonotonic();
    const a = generateUlid(1730601600000, RIGID_RNG);
    const b = generateUlid(1730601600000, RIGID_RNG);
    const c = generateUlid(1730601600000, RIGID_RNG);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a < b && b < c).toBe(true); // лексикографический порядок = время + счётчик
  });

  it("разные миллисекунды — возрастание по времени", () => {
    resetUlidMonotonic();
    const early = generateUlid(1000, RIGID_RNG);
    const late = generateUlid(2000, RIGID_RNG);
    expect(late > early).toBe(true);
  });

  it("детерминирован при фиксированном rng", () => {
    resetUlidMonotonic();
    const a = generateUlid(1730601600000, RIGID_RNG);
    resetUlidMonotonic();
    const b = generateUlid(1730601600000, RIGID_RNG);
    expect(b).toBe(a);
  });
});
