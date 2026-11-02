import {describe, expect, it} from "vitest";
import {buildEmailHtml} from "./template";
import {CSP_POLICY} from "../../htmlCsp";

describe("buildEmailHtml", () => {
  it("шаблон 600px, табличная вёрстка, inline CSS на ячейке", () => {
    const html = buildEmailHtml({subject: "Отчёт", preheader: "Анонс", bodyHtml: "<p>Привет</p>"});
    expect(html).toContain('width="600"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:100%");
    // контентная ячейка со шрифтом
    expect(html).toContain("font-family:'Helvetica Neue'");
    expect(html).toContain("<p>Привет</p>");
  });

  it("тема в <title>, preheader — скрытый блок сразу после body", () => {
    const html = buildEmailHtml({
      subject: "Тема письма",
      preheader: "Короткий анонс",
      bodyHtml: "",
    });
    expect(html).toContain("<title>Тема письма</title>");
    expect(html).toContain(
      '<div style="display:none;max-height:0;overflow:hidden;visibility:hidden;">Короткий анонс</div>',
    );
    expect(html.indexOf("Короткий анонс")).toBeLessThan(html.indexOf("<table"));
  });

  it("пустой preheader — скрытого блока нет", () => {
    const html = buildEmailHtml({subject: "T", preheader: "", bodyHtml: ""});
    expect(html).not.toContain("display:none");
  });

  it("тема и preheader экранируются", () => {
    const html = buildEmailHtml({
      subject: '<b>Тема</b> "и кавычки"',
      preheader: "<script>alert(1)</script>",
      bodyHtml: "",
    });
    expect(html).toContain(
      "<title>&lt;b&gt;Тема&lt;/b&gt; &quot;и кавычки&quot;</title>",
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("CSP-мета из htmlCsp входит в шаблон", () => {
    const html = buildEmailHtml({subject: "s", preheader: "", bodyHtml: ""});
    expect(html).toContain(CSP_POLICY);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });
});
