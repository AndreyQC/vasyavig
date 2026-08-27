import {describe, expect, it} from "vitest";
import {restoreCyrillicUrls} from "./restoreCyrillicUrls";

describe("restoreCyrillicUrls", () => {
  it("декодирует кириллический якорь inline-ссылки", () => {
    const src = "- [1. Введение](#1-%D0%B2%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D0%B5)";
    const {text, changedUrls} = restoreCyrillicUrls(src);
    expect(text).toBe("- [1. Введение](#1-введение)");
    expect(changedUrls).toBe(1);
  });

  it("декодирует путь картинки с %-кодированием и балансом скобок", () => {
    const src = "![](V2_%D0%A2%D0%97%20Total%20(1)\\_assets/img-0.png)";
    const {text} = restoreCyrillicUrls(src);
    // пробел после декодирования -> angle-форма, markdown остаётся валидным
    expect(text).toBe("![](<V2_ТЗ Total (1)\\_assets/img-0.png>)");
  });

  it("angle-destination декодируется без смены формы", () => {
    const src = "[текст](<#1-%D0%B2%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D0%B5>)";
    expect(restoreCyrillicUrls(src).text).toBe("[текст](<#1-введение>)");
  });

  it("не трогает чистые ASCII-коды (%20, %28)", () => {
    const src = "[a](b%20c) и [d](e%28f%29)";
    expect(restoreCyrillicUrls(src)).toMatchObject({text: src, changedUrls: 0});
  });

  it("пропускает битые %-последовательности, валидные рядом декодирует", () => {
    const src = "[a](#x-%D0-%D0%B2)";
    // %D0 — незавершённый UTF-8 (остаётся), %D0%B2 — валидная пара (декодируется)
    expect(restoreCyrillicUrls(src)).toMatchObject({text: "[a](#x-%D0-в)", changedUrls: 1});
  });

  it("декодирует link reference definition", () => {
    const src = "[algoritm]: #55-%D0%B0%D0%BB%D0%B3%D0%BE%D1%80%D0%B8%D1%82%D0%BC";
    expect(restoreCyrillicUrls(src).text).toBe("[algoritm]: #55-алгоритм");
  });

  it("не меняет текст вне ссылок и экранированные скобки", () => {
    const src = "Выручка 100% и \\[не ссылка](#%D0%B2)";
    expect(restoreCyrillicUrls(src)).toMatchObject({text: src, changedUrls: 0});
  });

  it("ссылка с title сохраняет title", () => {
    const src = '[a](#%D1%82%D0%B5%D1%81%D1%82 "подсказка")';
    expect(restoreCyrillicUrls(src).text).toBe('[a](#тест "подсказка")');
  });
});
