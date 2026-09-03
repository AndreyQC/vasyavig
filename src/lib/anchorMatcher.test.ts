import {describe, expect, it} from "vitest";
import {computeHeadingAnchors, matchAnchor} from "./anchorMatcher";

const HEADINGS = [
  "1. Введение",
  "1.1. Цель документа",
  "Раздел {#custom-anchor}",
  "Тест с пунктуацией, запятая!",
  "1. Введение", // дубль
];

describe("computeHeadingAnchors", () => {
  it("даёт github-слаг и транслит для обычных заголовков", () => {
    const anchors = computeHeadingAnchors(HEADINGS);
    expect(anchors[0]).toEqual(["1-введение", "1-vvedenie"]);
    expect(anchors[1]).toEqual(["11-цель-документа", "11-cel-dokumenta"]);
    // запятая остаётся: transform не удаляет её (remove-паттерн допускает , ; = /)
    expect(anchors[3]).toEqual(["тест-с-пунктуацией-запятая", "test-s-punktuaciej,-zapyataya"]);
  });

  it("custom-id заменяет оба слага, слаггеры им не питаются", () => {
    const anchors = computeHeadingAnchors(HEADINGS);
    expect(anchors[2]).toEqual(["custom-anchor"]);
    // дубль после custom-id не сдвинул счётчики
    expect(anchors[4][0]).toBe("1-введение-1");
  });

  it("транслит-дубли получают суффикс без дефиса (стиль transform)", () => {
    const anchors = computeHeadingAnchors(["Foo", "Foo", "Foo"]);
    expect(anchors.map((a) => a[1])).toEqual(["foo", "foo1", "foo2"]);
  });
});

describe("matchAnchor", () => {
  it("сопоставляет кириллический и транслит-якорь", () => {
    expect(matchAnchor(HEADINGS, "1-введение")).toBe(0);
    expect(matchAnchor(HEADINGS, "1-vvedenie")).toBe(0);
    expect(matchAnchor(HEADINGS, "11-cel-dokumenta")).toBe(1);
  });

  it("сопоставляет percent-кодированный фрагмент", () => {
    expect(matchAnchor(HEADINGS, "1-%D0%B2%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D0%B5")).toBe(0);
  });

  it("custom-id и дубли", () => {
    expect(matchAnchor(HEADINGS, "custom-anchor")).toBe(2);
    expect(matchAnchor(HEADINGS, "1-введение-1")).toBe(4);
    expect(matchAnchor(HEADINGS, "1-vvedenie1")).toBe(4);
  });

  it("возвращает null для неизвестного якоря", () => {
    expect(matchAnchor(HEADINGS, "нет-такого")).toBeNull();
  });
});
