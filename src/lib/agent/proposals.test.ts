import {describe, expect, it} from "vitest";
import type {EditorTab} from "../../store/editorStore";
import type {RootInfo} from "../rootColors";
import {contentHash} from "./hash";
import {
  applyInsert,
  applyProposal,
  applyReplaceAll,
  buildCreateProposal,
  buildInsertProposal,
  buildLineDiff,
  buildReplaceProposal,
  ProposalError,
  proposalDiff,
  type Proposal,
  type ProposalApplyDeps,
  type ProposalTarget,
} from "./proposals";

const PATH = "C:\\ws\\docs\\a.md";

function target(content: string): ProposalTarget {
  return {
    docId: "doc-1",
    path: PATH,
    relativePath: "docs/a.md",
    fileName: "a.md",
    content,
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ProposalError ? e.code : "not-proposal";
  }
  return "no-error";
}

function tab(content: string, savedContent = content): EditorTab {
  return {
    path: PATH,
    name: "a.md",
    kind: "markdown",
    content,
    savedContent,
    dirty: content !== savedContent,
    mode: "wysiwyg",
    preview: false,
  };
}

function applyDeps(state: {
  content: string;
  savedContent?: string;
  files?: Record<string, string>;
  roots?: RootInfo[];
  editor?: boolean;
  validate?: () => Promise<{absolutePath: string}>;
  createError?: string;
}) {
  const editorCalls: string[] = [];
  const created: string[] = [];
  const opened: Array<{path: string; content: string; kind: string}> = [];
  const activated: string[] = [];
  const deps: ProposalApplyDeps = {
    getTabs: () => [tab(state.content, state.savedContent ?? "original")],
    getEditor: () =>
      state.editor === false
        ? null
        : {
            replace: (text) => {
              editorCalls.push(text);
              state.content = text;
            },
          },
    setActiveTab: (path) => activated.push(path),
    updateContent: (_path, content) => {
      state.content = content;
    },
    createFile: async (path) => {
      if (state.createError) throw new Error(state.createError);
      if (state.files && path in state.files) throw new Error("exists");
      created.push(path);
      if (state.files) state.files[path] = "";
    },
    refreshTree: async () => {},
    getRoots: () => state.roots ?? [],
    validateCreateTarget:
      state.validate ??
      (async (_root, relativePath) => ({
        absolutePath: `C:\\ws\\${relativePath.replace(/\//g, "\\")}`,
      })),
    fileExists: async (path) => Boolean(state.files && path in state.files),
    openDirtyTab: (path, content, kind) => opened.push({path, content, kind}),
    waitForEditor: async () => (state.editor === false ? null : deps.getEditor(PATH)),
  };
  return {deps, editorCalls, created, opened, activated};
}

describe("hash and occurrence helpers", () => {
  it("contentHash стабилен и различает текст", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
    expect(contentHash("")).toHaveLength(32);
  });

  it("applyReplaceAll заменяет все вхождения без regex-сюрпризов", () => {
    expect(applyReplaceAll("a $1 a", "a", "b")).toBe("b $1 b");
  });

  it("applyInsert поддерживает before/after/end и уникальность", () => {
    expect(applyInsert("a\nb", "b", "before", "x\n")).toBe("a\nx\nb");
    expect(applyInsert("a\nb", "a", "after", "\nx")).toBe("a\nx\nb");
    expect(applyInsert("a", "end", "after", "b")).toBe("a\nb");
    expect(applyInsert("a a", "a", "after", "x")).toBeNull();
    expect(applyInsert("a", "missing", "after", "x")).toBeNull();
  });
});

describe("buildReplaceProposal", () => {
  it("строит замену по умолчанию с одним вхождением и не меняет target", () => {
    const original = target("hello world");
    const proposal = buildReplaceProposal({
      target: original,
      oldText: "world",
      newText: "there",
      id: "prop-1",
      now: 100,
    });

    expect(proposal).toMatchObject({
      id: "prop-1",
      kind: "replace",
      status: "pending",
      expectedCount: 1,
      baseHash: contentHash("hello world"),
      resultText: "hello there",
      createdAt: 100,
    });
    expect(original.content).toBe("hello world");
  });

  it("требует ровно expectedCount вхождений", () => {
    expect(
      codeOf(() =>
        buildReplaceProposal({target: target("a a"), oldText: "a", newText: "b"}),
      ),
    ).toBe("count_mismatch");

    const proposal = buildReplaceProposal({
      target: target("a a"),
      oldText: "a",
      newText: "b",
      expectedCount: 2,
    });
    expect(proposal.resultText).toBe("b b");
  });

  it("отклоняет пустой oldText и no-op замену", () => {
    expect(codeOf(() => buildReplaceProposal({target: target("a"), oldText: "", newText: "b"}))).toBe(
      "empty_old_text",
    );
    expect(codeOf(() => buildReplaceProposal({target: target("a"), oldText: "a", newText: "a"}))).toBe(
      "no_change",
    );
  });
});

describe("buildInsertProposal", () => {
  it("вставляет до/после уникального якоря и в конец", () => {
    const before = buildInsertProposal({
      target: target("a\nb"),
      anchor: "b",
      position: "before",
      text: "x\n",
    });
    expect(before.resultText).toBe("a\nx\nb");

    const after = buildInsertProposal({
      target: target("a\nb"),
      anchor: "a",
      position: "after",
      text: "\nx",
    });
    expect(after.resultText).toBe("a\nx\nb");

    const end = buildInsertProposal({target: target("a"), anchor: "end", text: "b"});
    expect(end.resultText).toBe("a\nb");
  });

  it("отклоняет отсутствующий/неоднозначный якорь и пустой текст", () => {
    expect(
      codeOf(() => buildInsertProposal({target: target("a"), anchor: "z", text: "x"})),
    ).toBe("anchor_not_found");
    expect(
      codeOf(() => buildInsertProposal({target: target("a a"), anchor: "a", text: "x"})),
    ).toBe("anchor_ambiguous");
    expect(
      codeOf(() => buildInsertProposal({target: target("a"), anchor: "a", text: ""})),
    ).toBe("empty_text");
  });
});

describe("applyProposal: replace/insert", () => {
  it("применяет полный текст через editor.replace: dirty + undo", async () => {
    const proposal = buildReplaceProposal({
      target: target("hello world"),
      oldText: "world",
      newText: "there",
    });
    const state = {content: "hello world", savedContent: "hello world"};
    const {deps, editorCalls} = applyDeps(state);

    const result = await applyProposal(proposal, deps);

    expect(result).toMatchObject({ok: true, status: "applied", undo: true});
    expect(state.content).toBe("hello there");
    expect(editorCalls).toEqual(["hello there"]);
    expect(deps.getTabs()[0].dirty).toBe(true);
  });

  it("отказывает по stale hash и не трогает буфер", async () => {
    const proposal = buildReplaceProposal({
      target: target("hello world"),
      oldText: "world",
      newText: "there",
    });
    const state = {content: "hello world", savedContent: "hello world"};
    const {deps, editorCalls} = applyDeps(state);
    state.content = "hello world, changed";

    const result = await applyProposal(proposal, deps);

    expect(result.status).toBe("stale");
    expect(state.content).toBe("hello world, changed");
    expect(editorCalls).toHaveLength(0);
  });

  it("перепроверяет expectedCount при неизменном hash", async () => {
    const proposal: Proposal = {
      ...buildReplaceProposal({target: target("hello world"), oldText: "world", newText: "there"}),
      expectedCount: 2,
    };
    const state = {content: "hello world", savedContent: "hello world"};
    const {deps} = applyDeps(state);

    const result = await applyProposal(proposal, deps);

    expect(result.status).toBe("stale");
    expect(state.content).toBe("hello world");
  });

  it("применяет вставку и проверяет якорь", async () => {
    const proposal = buildInsertProposal({
      target: target("a\nb"),
      anchor: "b",
      position: "before",
      text: "x\n",
    });
    const state = {content: "a\nb", savedContent: "a\nb"};
    const {deps} = applyDeps(state);

    const result = await applyProposal(proposal, deps);
    expect(result).toMatchObject({ok: true, status: "applied"});
    expect(state.content).toBe("a\nx\nb");

    const stale = await applyProposal(proposal, deps);
    expect(stale.status).toBe("stale");
  });

  it("без смонтированного редактора обновляет стор (dirty, undo=false)", async () => {
    const proposal = buildReplaceProposal({
      target: target("hello world"),
      oldText: "world",
      newText: "there",
    });
    const state = {content: "hello world", savedContent: "hello world"};
    const {deps, activated} = applyDeps({...state, editor: false});
    const result = await applyProposal(proposal, deps);

    expect(result).toMatchObject({ok: true, status: "applied", undo: false});
    expect(activated).toEqual([PATH]);
    expect(deps.getTabs()[0].content).toBe("hello there");
    expect(deps.getTabs()[0].dirty).toBe(true);
  });
});

describe("applyProposal: create", () => {
  const proposal = buildCreateProposal({
    id: "prop-create",
    rootId: "root-1",
    rootPath: "C:\\ws",
    relativePath: "docs/new.md",
    absolutePath: "C:\\ws\\docs\\new.md",
    content: "# New",
  });

  it("создаёт пустой файл, открывает dirty-вкладку с содержимым", async () => {
    const state = {
      content: "",
      files: {} as Record<string, string>,
      roots: [{path: "C:\\ws", color: "blue" as const}],
    };
    const {deps, created, opened} = applyDeps(state);

    const result = await applyProposal(proposal, deps);

    expect(result).toMatchObject({ok: true, status: "applied"});
    expect(created).toEqual(["C:\\ws\\docs\\new.md"]);
    expect(state.files["C:\\ws\\docs\\new.md"]).toBe("");
    expect(opened).toEqual([
      {path: "C:\\ws\\docs\\new.md", content: "# New", kind: "markdown"},
    ]);
  });

  it("отказывает, если файл уже существует", async () => {
    const state = {
      content: "",
      files: {"C:\\ws\\docs\\new.md": "old"},
      roots: [{path: "C:\\ws", color: "blue" as const}],
    };
    const {deps, created} = applyDeps(state);

    const result = await applyProposal(proposal, deps);
    expect(result.status).toBe("stale");
    expect(created).toHaveLength(0);
  });

  it("отказывает, если корень закрыт", async () => {
    const state = {content: "", files: {}, roots: [] as RootInfo[]};
    const {deps} = applyDeps(state);
    const result = await applyProposal(proposal, deps);
    expect(result.status).toBe("stale");
    expect(result.error).toMatch(/Корень/);
  });

  it("возвращает error, если создание файла упало", async () => {
    const state = {
      content: "",
      files: {},
      roots: [{path: "C:\\ws", color: "blue" as const}],
      createError: "disk full",
    };
    const {deps} = applyDeps(state);
    const result = await applyProposal(proposal, deps);
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/disk full/);
  });
});

describe("diff", () => {
  it("строит построчный diff замены", () => {
    const diff = buildLineDiff("a\nb", "a\nc");
    expect(diff.lines.map((line) => line.type)).toEqual(["same", "remove", "add"]);
    expect(diff.truncated).toBe(false);
  });

  it("create — весь контент добавлен", () => {
    const proposal = buildCreateProposal({
      rootId: "root-1",
      rootPath: "C:\\ws",
      relativePath: "a.md",
      absolutePath: "C:\\ws\\a.md",
      content: "a\nb",
    });
    expect(proposalDiff(proposal).lines.every((line) => line.type === "add")).toBe(true);
  });

  it("ограничивает diff и помечает truncated", () => {
    const oldText = Array.from({length: 400}, (_, i) => `old-${i}`).join("\n");
    const newText = Array.from({length: 400}, (_, i) => `new-${i}`).join("\n");
    const diff = buildLineDiff(oldText, newText, 300);
    expect(diff.lines).toHaveLength(300);
    expect(diff.truncated).toBe(true);
  });
});
