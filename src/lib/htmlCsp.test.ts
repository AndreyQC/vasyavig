import {describe, expect, it} from "vitest";
import {injectCspMeta} from "./htmlCsp";

const META_RE = /<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*">/i;

describe("injectCspMeta", () => {
  it("вставляет мету сразу после открывающего <head>", () => {
    const src = `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body></body>\n</html>`;
    const out = injectCspMeta(src);
    expect(out).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy"/i);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf('<meta charset'));
  });

  it("без <head> — добавляет <head> с метой после <html>", () => {
    const src = `<!DOCTYPE html>\n<html lang="ru">\n<body><p>x</p></body>\n</html>`;
    const out = injectCspMeta(src);
    expect(out).toMatch(/<html[^>]*><head><meta http-equiv="Content-Security-Policy"[^>]*><\/head>/i);
    expect(out).toContain("<body><p>x</p></body>");
  });

  it("фрагмент без html/head — метa в начале после doctype (quirks-безопасно)", () => {
    const src = `<!DOCTYPE html>\n<p>fragment</p>`;
    const out = injectCspMeta(src);
    expect(out.indexOf("<!DOCTYPE html>")).toBe(0);
    expect(out).toMatch(/^<!DOCTYPE html>\s*<meta http-equiv="Content-Security-Policy"/i);
  });

  it("фрагмент без doctype — метa в самом начале", () => {
    const out = injectCspMeta(`<p>bare</p>`);
    expect(out.startsWith("<meta http-equiv")).toBe(true);
    expect(out.endsWith("<p>bare</p>")).toBe(true);
  });

  it("XHTML-пролог остаётся первым, мета после него и doctype", () => {
    const src = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "x.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body/></html>`;
    const out = injectCspMeta(src);
    expect(out.startsWith('<?xml version="1.0"')).toBe(true);
    expect(out.indexOf("Content-Security-Policy")).toBeGreaterThan(out.indexOf("<!DOCTYPE"));
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<title>"));
  });

  it("регистронезависима к <HEAD>/<HTML>", () => {
    const out = injectCspMeta("<HTML><HEAD><TITLE>t</TITLE></HEAD><BODY/></HTML>");
    expect(out).toMatch(/<HEAD><meta http-equiv="Content-Security-Policy"/i);
  });

  it("идемпотентна — повторный вызов не дублирует мету", () => {
    const once = injectCspMeta("<html><head><title>t</title></head><body/></html>");
    const twice = injectCspMeta(once);
    expect(twice).toBe(once);
    expect(twice.match(META_RE)).toHaveLength(1);
  });
});
