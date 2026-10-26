// @vitest-environment jsdom
/**
 * Регресс round-trip конверта harness-yaml (task 20261025_001, план D2/задача 4).
 *
 * Проверяем уровень парсер->PM-документ->сериализатор WYSIWYG-редактора:
 * `WysiwygEditor` с теми же markdown-спеками (Html в их числе) и md-опциями,
 * что использует MarkdownEditor.tsx (preset full собирает этот же слой поверх
 * commonmark-specs). Конверт/закладка/task-yaml — HTML-комментарии; Html-спека
 * держит их в atom-нодах с сырым содержимым, сериализатор пишет дословно.
 *
 * Полный бандл редактора (useMarkdownEditor) в vitest не поднимается:
 * bundler-only ESM @gravity-ui/icons не грузится Node-ESM (безрасширённые
 * импорты) — задокументировано в LESSONS_LEARNED §15. Парity с preset full
 * закрывается ручной GUI-приёмкой на реальном репозитории (план, задача 5).
 */
import {beforeAll, describe, expect, it} from "vitest";
import {WysiwygEditor} from "@gravity-ui/markdown-editor/core";
import {BaseSchemaSpecs} from "@gravity-ui/markdown-editor/extensions/base/specs.js";
import {
  BlockquoteSpecs,
  BoldSpecs,
  BreaksSpecs,
  CodeBlockSpecs,
  CodeSpecs,
  HeadingSpecs,
  HorizontalRuleSpecs,
  Html,
  ImageSpecs,
  ItalicSpecs,
  LinkSpecs,
  ListsSpecs,
} from "@gravity-ui/markdown-editor/extensions/markdown/specs.js";
import {parseBookmarkUlid, parseHarnessEnvelope} from "./harnessEnvelope";

const ULID = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";

const FIXTURE = [
  "<!-- [<[harness-yaml]]",
  `id: ${ULID}`,
  "project: lm_hrdo_2",
  'title: "Etl Generator Entity Paths · 2026-09-21"',
  "type: plan",
  "created: 2026-09-21",
  "related: []",
  "[[harness-yaml]>] -->",
  "",
  "> 🔖 **harness-yaml** · документ в реестре · id `" + ULID + "` · метаданные — в source",
  "",
  "<!-- [<[task-yaml]]",
  "kind: daily-task",
  "status: done",
  "task: 20260921_622",
  'tracker: ""',
  'priority: ""',
  'assignee: ""',
  "[[task-yaml]>] -->",
  "",
  "# Etl Generator Entity Paths",
  "",
  "Текст с **жирным**, `кодом` и [ссылкой](plan.md).",
  "",
  "- пункт один",
  "- пункт два",
  "",
  "## Хвост",
  "",
  "Финальный параграф.",
  "",
].join("\n");

function createEditor(markup: string): WysiwygEditor {
  return new WysiwygEditor({
    // MarkdownEditor.tsx: preset full + md {html, breaks, linkify}
    initialContent: markup,
    allowHTML: true,
    linkify: true,
    extensions: (builder) => {
      // состав = CommonMarkSpecsPreset (слой preset full): BaseSchema + спеки
      builder
        .use(BaseSchemaSpecs, {})
        .use(Html)
        .use(BoldSpecs)
        .use(ItalicSpecs)
        .use(CodeSpecs)
        .use(LinkSpecs)
        .use(ListsSpecs)
        .use(BlockquoteSpecs)
        .use(HorizontalRuleSpecs)
        .use(BreaksSpecs, {})
        .use(CodeBlockSpecs, {})
        .use(ImageSpecs)
        .use(HeadingSpecs, {});
    },
  });
}

describe("round-trip конверта harness-yaml через WYSIWYG-парсер/сериализатор", () => {
  let editor: WysiwygEditor;
  let output: string;

  beforeAll(() => {
    editor = createEditor(FIXTURE);
    output = editor.getValue();
    editor.destroy();
  });

  it("конверт harness-yaml сохраняется по полям", () => {
    expect(parseHarnessEnvelope(output)).toEqual(parseHarnessEnvelope(FIXTURE));
  });

  it("закладка с ULID сохраняется", () => {
    expect(parseBookmarkUlid(output)).toBe(ULID);
  });

  it("task-yaml сохраняется дословно", () => {
    expect(output).toContain("[<[task-yaml]]");
    expect(output).toContain("[[task-yaml]>]");
    expect(output).toContain("task: 20260921_622");
  });

  it("конверт и task-yaml идут сырыми блоками (byte-exact внутри строки)", () => {
    // многострочные HTML-комментарии восстанавливаются дословно:
    // каждое поле на своей строке, маркеры без изменений
    const lines = output.split("\n");
    const openIdx = lines.indexOf("<!-- [<[harness-yaml]]");
    const closeIdx = lines.indexOf("[[harness-yaml]>] -->");
    expect(openIdx).toBe(0);
    expect(closeIdx).toBe(7);
    expect(lines[1]).toBe(`id: ${ULID}`);
    expect(lines[4]).toBe("type: plan");
  });

  it("тело документа не пострадало (заголовки/список/ссылка на месте)", () => {
    expect(output).toContain("# Etl Generator Entity Paths");
    expect(output).toContain("- пункт один");
    expect(output).toContain("[ссылкой](plan.md)");
  });
});
