// @vitest-environment jsdom
/**
 * Регресс round-trip harness-конверта на YFM-слое пресета full
 * (task 20261026_001, Phase 7 задача 2).
 *
 * Дополняет `harnessRoundTrip.test.ts` (commonmark-слой): здесь редактор собран
 * по образцу `YfmSpecsPreset`/`FullSpecsPreset` — BaseSchema + commonmark +
 * YFM-спеки. Проверяем, что типовые YFM-блоки переживают parse -> serialize
 * вместе с конвертом harness-yaml, task-yaml и закладкой.
 *
 * Полный бандл (useMarkdownEditor) в vitest не поднимается: bundler-only ESM
 * `@gravity-ui/icons` не грузится Node-ESM — `LESSONS_LEARNED.md` §15.
 * Поведение редактора (модалки, node views, переключение режимов) — GUI.
 */
import {beforeAll, describe, expect, it} from "vitest";
import {WysiwygEditor} from "@gravity-ui/markdown-editor/core";
import {
  BaseSchemaSpecs,
  BlockquoteSpecs,
  BoldSpecs,
  BreaksSpecs,
  CheckboxSpecs,
  CodeBlockSpecs,
  CodeSpecs,
  ColorSpecs,
  DeflistSpecs,
  HeadingSpecs,
  HorizontalRuleSpecs,
  Html,
  ImageSpecs,
  ImgSizeSpecs,
  ItalicSpecs,
  LinkSpecs,
  ListsSpecs,
  MarkSpecs,
  MonospaceSpecs,
  StrikeSpecs,
  SubscriptSpecs,
  SuperscriptSpecs,
  TableSpecs,
  UnderlineSpecs,
  VideoSpecs,
  YfmConfigsSpecs,
  YfmCutSpecs,
  YfmFileSpecs,
  YfmHeadingSpecs,
  YfmNoteSpecs,
  YfmTableSpecs,
  YfmTabsSpecs,
} from "@gravity-ui/markdown-editor/extensions/specs.js";
import {parseBookmarkUlid, parseHarnessEnvelope} from "./harnessEnvelope";

const ULID = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";

/**
 * Смешанная фикстура: harness-шапка (конверт + закладка + task-yaml) и тело
 * с YFM-блоками. Envelope должен остаться в первых строках файла.
 */
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
  "{% note info \"Заметка\" %}",
  "",
  "Текст заметки с **жирным** и `кодом`.",
  "",
  "{% endnote %}",
  "",
  '{% cut "Детали" %}',
  "",
  "Скрытый текст внутри ката.",
  "",
  "{% endcut %}",
  "",
  "{% list tabs %}",
  "",
  "- Первая",
  "",
  "  Текст первой вкладки.",
  "",
  "- Вторая",
  "",
  "  Текст второй вкладки.",
  "",
  "{% endlist %}",
  "",
  "#|",
  "|| Заголовок 1 | Заголовок 2 ||",
  "|| Ячейка 1 | Ячейка 2 ||",
  "|#",
  "",
  "Термин 1",
  "",
  ":   Определение 1",
  "",
  "- [ ] незавершённая",
  "- [x] завершённая",
  "",
  "![схема](schema.png =100x50)",
  "",
  "Финальный параграф.",
  "",
].join("\n");

/**
 * Состав повторяет `YfmSpecsPreset` + `FullSpecsPreset` (Mark/Color).
 * Опции — `{}`: пресет передаёт пустые объекты, расширения без опций падают
 * (LESSONS_LEARNED.md §15, п. 3).
 */
function createEditor(markup: string): WysiwygEditor {
  return new WysiwygEditor({
    initialContent: markup,
    allowHTML: true,
    linkify: true,
    extensions: (builder) => {
      builder
        // CommonMarkSpecsPreset
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
        .use(HeadingSpecs, {})
        // DefaultSpecsPreset
        .use(StrikeSpecs)
        .use(TableSpecs)
        // YfmSpecsPreset
        .use(DeflistSpecs, {})
        .use(SubscriptSpecs)
        .use(SuperscriptSpecs)
        .use(UnderlineSpecs)
        .use(CheckboxSpecs, {})
        .use(ImgSizeSpecs, {})
        .use(MonospaceSpecs)
        .use(VideoSpecs, {})
        .use(YfmConfigsSpecs, {})
        .use(YfmCutSpecs, {})
        .use(YfmNoteSpecs, {})
        .use(YfmFileSpecs)
        .use(YfmHeadingSpecs, {})
        .use(YfmTableSpecs, {})
        .use(YfmTabsSpecs, {})
        // FullSpecsPreset
        .use(MarkSpecs)
        .use(ColorSpecs, {});
    },
  });
}

describe("round-trip harness-конверта через YFM-слой WYSIWYG", () => {
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

  it("конверт остаётся в окне первых 5 строк и идёт сырым блоком", () => {
    const lines = output.split("\n");
    expect(lines[0]).toBe("<!-- [<[harness-yaml]]");
    expect(lines[7]).toBe("[[harness-yaml]>] -->");
    expect(lines[1]).toBe(`id: ${ULID}`);
    expect(lines[4]).toBe("type: plan");
  });

  it("YFM-блоки сохраняют разметку", () => {
    // note
    expect(output).toContain('{% note info "Заметка" %}');
    expect(output).toContain("{% endnote %}");
    // cut
    expect(output).toContain('{% cut "Детали" %}');
    expect(output).toContain("{% endcut %}");
    // tabs
    expect(output).toContain("{% list tabs %}");
    expect(output).toContain("{% endlist %}");
    // YFM-таблица: сериализатор раскладывает ячейки по строкам,
    // проверяем маркеры и содержимое, а не исходную однострочную форму
    expect(output).toContain("#|");
    expect(output).toContain("|#");
    expect(output).toContain("||");
    expect(output).toContain("Заголовок 1");
    expect(output).toContain("Ячейка 1");
    // deflist
    expect(output).toContain("Термин 1");
    expect(output).toMatch(/:\s+Определение 1/);
    // checkbox (сериализатор нормализует [x] -> [X])
    expect(output).toContain("- [ ] незавершённая");
    expect(output).toMatch(/^- \[[xX]\] завершённая$/m);
    // размер картинки
    expect(output).toContain("=100x50");
  });

  it("тело документа не пострадало", () => {
    expect(output).toContain("# Etl Generator Entity Paths");
    expect(output).toContain("Текст заметки с **жирным** и `кодом`.");
    expect(output).toContain("Текст первой вкладки.");
    expect(output).toContain("Финальный параграф.");
  });

  it("повторный parse вывода идемпотентен", () => {
    const second = createEditor(output);
    const output2 = second.getValue();
    second.destroy();

    expect(output2).toBe(output);
    expect(parseHarnessEnvelope(output2)).toEqual(parseHarnessEnvelope(FIXTURE));
  });
});
