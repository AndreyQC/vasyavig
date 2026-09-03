import {describe, expect, it} from "vitest";
import {decodeRfc2047, decodeRawDisplay, parseEml} from "./emlParser";

/** Байты → latin-1 строка (транспорт read_file_latin1 в тестах). */
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function qp(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => "=" + b.toString(16).toUpperCase().padStart(2, "0")).join("");
}

function qword(s: string): string {
  // utf-8 Q-кодирование для fixture: байты → =XX, пробел → _
  const bytes = new TextEncoder().encode(s);
  return Array.from(bytes, (b) => (b === 0x20 ? "_" : "=" + b.toString(16).toUpperCase().padStart(2, "0"))).join("");
}

// windows-1251: «Тема» = D2 E5 EC E0; «тест» = F2 E5 F1 F2; «Тест!» = F2 E5 F1 F2 21 (тест!)
const CP1251_TEMA = Uint8Array.from([0xd2, 0xe5, 0xec, 0xe0]);
const CP1251_TEST = Uint8Array.from([0xf2, 0xe5, 0xf1, 0xf2]);
// koi8-r: «тест» = D4 C5 D3 D4 (транслитерация в младших 7 битах: т→T и т.д.)
const KOI8R_TEST = Uint8Array.from([0xd4, 0xc5, 0xd3, 0xd4]);

describe("emlParser: простое письмо", () => {
  it("заголовки и 7bit-тело без Content-Type (умолчание text/plain)", () => {
    const raw = [
      "From: Ivan <ivan@example.com>",
      "To: user@example.com",
      "Subject: Hello",
      "Date: Thu, 3 Sep 2026 10:00:00 +0300",
      "",
      "Plain body line",
    ].join("\r\n");
    const parsed = parseEml(raw);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.headers.subject).toBe("Hello");
    expect(parsed.headers.from).toBe("Ivan <ivan@example.com>");
    expect(parsed.headers.date).toBe("Thu, 3 Sep 2026 10:00:00 +0300");
    expect(parsed.headers.cc).toBeUndefined();
    expect(parsed.textBody).toBe("Plain body line");
  });

  it("продолжение заголовка (unfolding) склеивается", () => {
    const raw = ["Subject: первая часть", " продолжение", "", "body"].join("\r\n");
    expect(parseEml(raw).headers.subject).toBe("первая часть продолжение");
  });
});

describe("emlParser: windows-1251 + quoted-printable + RFC 2047 B", () => {
  it("тема и тело декодируются в кириллицу", () => {
    const raw = [
      `From: =?windows-1251?B?${b64(CP1251_TEMA)}?= <ivan@example.com>`,
      "To: user@example.com",
      `Subject: =?windows-1251?B?${b64(CP1251_TEMA)}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=windows-1251",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      `${qp(CP1251_TEST)}!`,
    ].join("\r\n");
    const parsed = parseEml(raw);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.headers.subject).toBe("Тема");
    expect(parsed.headers.from?.startsWith("Тема ")).toBe(true);
    expect(parsed.textBody).toBe("тест!");
  });

  it("8bit-тело в windows-1251 (latin-1 транспорт)", () => {
    const raw = [
      "Subject: 8bit cp1251",
      "Content-Type: text/plain; charset=windows-1251",
      "Content-Transfer-Encoding: 8bit",
      "",
      latin1(CP1251_TEST),
    ].join("\r\n");
    expect(parseEml(raw).textBody).toBe("тест");
  });

  it("8bit-тело в koi8-r", () => {
    const raw = [
      "Subject: koi8",
      "Content-Type: text/plain; charset=koi8-r",
      "Content-Transfer-Encoding: 8bit",
      "",
      latin1(KOI8R_TEST),
    ].join("\r\n");
    expect(parseEml(raw).textBody).toBe("тест");
  });
});

describe("emlParser: utf-8 + base64 + RFC 2047 Q", () => {
  it("тело base64 декодируется, тема Q-слово декодируется", () => {
    const body = "Привет, мир!\nВторая строка";
    const raw = [
      `Subject: =?utf-8?Q?${qword("Тема письма")}?=`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64(new TextEncoder().encode(body)),
    ].join("\r\n");
    const parsed = parseEml(raw);
    expect(parsed.headers.subject).toBe("Тема письма");
    expect(parsed.textBody).toBe(body);
  });

  it("смежные encoded-words склеиваются без пробела", () => {
    const value = `=?utf-8?Q?${qword("При")}?= =?utf-8?Q?${qword("вет!")}?=`;
    expect(decodeRfc2047(value)).toBe("Привет!");
  });

  it("битое base64 в слове остаётся как есть (не падает)", () => {
    expect(decodeRfc2047("=?utf-8?B?####?=")).toBe("=?utf-8?B?####?=");
  });
});

describe("emlParser: multipart", () => {
  it("multipart/mixed: text/plain берётся, вложение пропускается", () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="XYZ"',
      "",
      "--XYZ",
      "Content-Type: text/plain; charset=windows-1251",
      "Content-Transfer-Encoding: 8bit",
      "",
      latin1(CP1251_TEST),
      "--XYZ",
      'Content-Type: application/pdf; name="doc.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQ=",
      "--XYZ--",
      "",
    ].join("\r\n");
    const parsed = parseEml(raw);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.textBody).toBe("тест");
  });

  it("вложенный multipart/alternative внутри mixed: text/plain находится", () => {
    const raw = [
      "Content-Type: multipart/mixed; boundary=OUT",
      "",
      "--OUT",
      "Content-Type: multipart/alternative; boundary=IN",
      "",
      "--IN",
      "Content-Type: text/plain; charset=utf-8",
      "",
      latin1(new TextEncoder().encode("plain внутри")),
      "--IN",
      "Content-Type: text/html; charset=utf-8",
      "",
      latin1(new TextEncoder().encode("<p>html внутри</p>")),
      "--IN--",
      "--OUT--",
      "",
    ].join("\r\n");
    expect(parseEml(raw).textBody).toBe("plain внутри");
  });

  it("html-only (multipart/alternative без text/plain) — textBody null", () => {
    const raw = [
      "Content-Type: multipart/alternative; boundary=B",
      "",
      "--B",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>только html</p>",
      "--B--",
      "",
    ].join("\r\n");
    const parsed = parseEml(raw);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.textBody).toBeNull();
  });
});

describe("emlParser: decodeRawDisplay (вид «Исходник»)", () => {
  it("utf-8 сырье декодируется как есть", () => {
    const source = "Subject: тема\r\n\r\nтело письма";
    const raw = latin1(new TextEncoder().encode(source));
    expect(decodeRawDisplay(raw)).toBe(source);
  });

  it("не-UTF-8 байты декодируются как windows-1251", () => {
    expect(decodeRawDisplay(latin1(CP1251_TEST))).toBe("тест");
  });
});

describe("emlParser: деградация", () => {
  it("пустой файл — parseError", () => {
    expect(parseEml("").parseError).toBe("empty");
    expect(parseEml("   \r\n  ").parseError).toBe("empty");
  });

  it("файл без структуры MIME — parseError", () => {
    expect(parseEml("это просто текст без заголовков").parseError).toBe("no-structure");
    expect(parseEml("Subject: нет пустой строки\nтело сразу").parseError).toBe("no-structure");
  });

  it("блок заголовков без валидных строк — parseError", () => {
    expect(parseEml("???\r\n\r\nbody").parseError).toBe("no-headers");
  });
});
