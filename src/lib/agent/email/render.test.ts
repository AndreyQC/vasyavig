// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {renderEmailBody, type RenderEmailBodyInput} from "./render";
import type {ReadImageBytes} from "./images";

/** Минимальный «PNG» — сигнатура + заполнитель. */
function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes[2] = 0x4e;
  bytes[3] = 0x47;
  for (let i = 8; i < size; i++) bytes[i] = 0x41;
  return bytes;
}

const BASE = "C:\\ws\\docs";

function render(markdown: string, opts: Partial<RenderEmailBodyInput> = {}) {
  const read: ReadImageBytes = async (path) =>
    path.endsWith("missing.png") ? null : pngBytes(64);
  return renderEmailBody({
    markdown,
    basePath: BASE,
    rootPath: null,
    readImageBytes: opts.readImageBytes ?? read,
    ...opts,
  });
}

describe("renderEmailBody", () => {
  it("snapshot: заголовки, список, таблица, код, цитата", async () => {
    const md = [
      "# План",
      "",
      "Вводный абзац с [ссылкой](https://example.com) и `кодом`.",
      "",
      "- первый",
      "- второй",
      "",
      "| А | Б |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "> Цитата",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "---",
      "",
      "## Конец",
      "",
      "см. [оглавление](#plan)",
    ].join("\n");
    const {html, warnings} = await render(md);
    expect(warnings).toEqual([]);
    expect(html).toMatchSnapshot();
  });

  it("XSS из документа не проходит: script/onerror/javascript:/svg-data", async () => {
    const md = [
      "<script>alert(1)</script>",
      "",
      '<img src="x.png" onerror="alert(1)">',
      "",
      "[клик](javascript:alert(1))",
      "",
      "![svg](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
      "",
      '<div style="background:url(javascript:alert(1))">текст</div>',
    ].join("\n");
    const {html} = await render(md);

    // сырой HTML из документа остаётся экранированным текстом (allowHTML=false)
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).not.toMatch(/href=["']javascript:/i);
    expect(html).not.toMatch(/<img[^>]*data:image\/svg/i);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("текст");
  });

  it("YFM-note: цветной table-блок, без классов yfm и служебных кнопок", async () => {
    const md = [
      "# Документ",
      "",
      "{% note info \"Важно\" %}",
      "",
      "Текст заметки с **жирным**",
      "",
      "{% endnote %}",
    ].join("\n");
    const {html, warnings} = await render(md);

    expect(warnings).toEqual([]);
    expect(html).toContain("border-left:4px solid #2f86eb");
    expect(html).toContain("background:#e9f2fe");
    expect(html).toContain("Важно");
    expect(html).toContain("Текст заметки");
    expect(html).not.toContain("yfm-note");
    expect(html).not.toContain("note-type");
  });

  it("YFM-note warning-акцент: свой цвет", async () => {
    const md = "{% note warning \"Осторожно\" %}\n\nТекст\n\n{% endnote %}";
    const {html} = await render(md);
    expect(html).toContain("border-left:4px solid #d6a13a");
    expect(html).toContain("background:#fdf5e2");
  });

  it("YFM-cut: развёрнутый блок с заголовком, без details/summary", async () => {
    const md = ["{% cut \"Подробности\" %}", "", "Скрытый текст", "", "{% endcut %}"].join("\n");
    const {html, warnings} = await render(md);

    expect(warnings).toEqual([]);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).toContain("Подробности");
    expect(html).toContain("Скрытый текст");
  });

  it("YFM-табы: warning, содержимое сохраняется", async () => {
    const md = [
      "{% tabs %}",
      "",
      "{% tab \"Один\" %}",
      "",
      "Контент один",
      "",
      "{% endtab %}",
      "",
      "{% endtabs %}",
    ].join("\n");
    const {html, warnings} = await render(md);

    expect(warnings).toEqual([{key: "assistant.email.warning.tabs"}]);
    expect(html).toContain("Контент один");
  });

  it("ULID-ссылки: warning и href снят", async () => {
    const md = "см. [документ](harness-ulid:01JAAAAAAAAAAAAAAAAAAAAAAAA)";
    const {html, warnings} = await render(md);

    expect(warnings).toEqual([
      {key: "assistant.email.warning.ulidLinks", params: {count: 1}},
    ]);
    expect(html).not.toContain("harness-ulid:");
    expect(html).toContain("документ");
  });

  it("служебная разметка transform вычищена: clipboard-якоря и кнопки кода", async () => {
    const md = ["# Заголовок", "", "```js", "const x = 1;", "```"].join("\n");
    const {html} = await render(md);

    expect(html).not.toContain("yfm-clipboard");
    expect(html).not.toContain("yfm-code-floating");
    expect(html).not.toContain("yfm-anchor");
    expect(html).not.toContain("<svg");
    expect(html).toContain("const x = 1;");
    // id заголовка остался — оглавление кликабельно
    expect(html).toMatch(/<h1[^>]*id="/);
  });

  it("локальные картинки встраиваются в data URI в пределах лимита", async () => {
    const md = "![одна](a.png)\n\n![две](b.png)";
    const {html, warnings} = await render(md, {imageLimitBytes: 1000});

    expect(warnings).toEqual([]);
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain('src="a.png"');
  });

  it("превышение суммарного лимита: warning, отказ от встраивания", async () => {
    const md = "![одна](a.png)\n\n![две](b.png)";
    // 64 байта на картинку; лимит хватает ровно на одну
    const {html, warnings} = await render(md, {imageLimitBytes: 64});

    expect(warnings).toEqual([
      {key: "assistant.email.warning.imageLimit", params: {skipped: 1}},
    ]);
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain('src="b.png"');
  });

  it("файл картинки не прочитан: warning, src не заменён", async () => {
    const md = "![нет](missing.png)";
    const {html, warnings} = await render(md);

    expect(warnings).toEqual([
      {key: "assistant.email.warning.imageMissing", params: {skipped: 1}},
    ]);
    expect(html).toContain('src="missing.png"');
  });

  it("внешние картинки (http) не встраиваются и не дают warning", async () => {
    const md = "![вне](https://example.com/img.png)";
    const {html, warnings} = await render(md);

    expect(warnings).toEqual([]);
    expect(html).toContain('src="https://example.com/img.png"');
  });

  it("inline CSS применён к абзацам и заголовкам; style/class из документа сняты", async () => {
    const md = [
      "# Заголовок",
      "",
      'Абзац с атрибутами{style="color:red" class="evil"}',
    ].join("\n");
    const {html} = await render(md);

    expect(html).toContain("margin:0 0 12px 0");
    expect(html).not.toContain('class="evil"');
    expect(html).not.toContain("color:red");
  });
});
