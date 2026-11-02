import {describe, expect, it} from "vitest";
import {
  DEFAULT_TASK_VOCABULARY,
  type TaskSource,
} from "../harnessTasks";
import type {HarnessIndexEntry} from "../harnessIndex";
import {createSessionIds} from "./ids";
import {
  createToolBudget,
  DEFAULT_POLICY_LIMITS,
  type PolicyLimits,
  type ToolBudget,
} from "./policy";
import {executeTool, type ToolCallContext} from "./tools";
import type {ToolDeps} from "./tools/deps";
import {fakeDeps, makeIndex, makeTab} from "./tools/testDeps";
import type {RootInfo} from "../rootColors";

const ROOT = "C:\\ws";
const ROOT_INFO: RootInfo = {path: ROOT, color: "blue", alias: "Workspace", harness: true};
const ULID_A = "01JG2S4H6K" + "A".repeat(16);
const ULID_B = "01JG2S4H6K" + "B".repeat(16);
const FILE_A = "C:\\ws\\docs\\a.md";
const FILE_B = "C:\\ws\\docs\\b.md";

function entries(): HarnessIndexEntry[] {
  return [
    {
      ulid: ULID_A,
      path: "docs/a.md",
      title: "Alpha",
      type: "plan",
      project: "p",
      related: [ULID_B],
    },
    {
      ulid: ULID_B,
      path: "docs/b.md",
      title: "Beta",
      type: "result",
      project: "p",
      basedOn: [ULID_A],
    },
  ];
}

function base(options: Parameters<typeof fakeDeps>[0] = {}) {
  const index = makeIndex(ROOT, entries());
  const files = {
    [FILE_A]: "# Alpha\n\nneedle text\n",
    [FILE_B]: "# Beta\n",
  };
  const fake = fakeDeps({
    tabs: [makeTab(FILE_A, files[FILE_A])],
    activePath: FILE_A,
    roots: [ROOT_INFO],
    files,
    indexes: [index],
    ...options,
  });
  const ids = createSessionIds();
  return {...fake, ids, index};
}

function context(
  deps: ToolDeps,
  ids: ReturnType<typeof createSessionIds>,
  opts: {
    tier?: ToolCallContext["tier"];
    budget?: ToolBudget;
    limits?: PolicyLimits;
    onProposal?: ToolCallContext["onProposal"];
  } = {},
): ToolCallContext {
  return {
    tier: opts.tier ?? "read",
    ids,
    deps,
    budget: opts.budget ?? createToolBudget(),
    limits: opts.limits ?? DEFAULT_POLICY_LIMITS,
    onProposal: opts.onProposal,
  };
}

function noAbsolutePaths(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain("C:\\\\ws");
  expect(text).not.toContain("C:/ws");
}

describe("read tools: opaque ids and paths", () => {
  it("get_active_document отдаёт docId/ULID/текст без абсолютного пути", async () => {
    const {deps, ids, state} = base();
    const result = await executeTool("get_active_document", {}, context(deps, ids));

    expect(result.ok).toBe(true);
    const doc = result.result as Record<string, unknown>;
    expect(doc).toMatchObject({
      docId: "doc-1",
      name: "a.md",
      ulid: ULID_A,
      mode: "wysiwyg",
      dirty: false,
    });
    expect(doc.content).toContain("needle text");
    expect(state.tabs[0].content).toBe("# Alpha\n\nneedle text\n");
    noAbsolutePaths(result.result);
  });

  it("list_open_documents ограничен 50 и не раскрывает пути", async () => {
    const tabs = Array.from({length: 60}, (_, i) => makeTab(`C:\\ws\\f${i}.md`, "x"));
    const {deps, ids} = base({tabs, activePath: tabs[0].path});
    const result = await executeTool("list_open_documents", {}, context(deps, ids));

    expect(result.ok).toBe(true);
    const docs = result.result as Array<Record<string, unknown>>;
    expect(docs).toHaveLength(50);
    expect(docs[0]).toMatchObject({docId: "doc-1", kind: "markdown"});
    noAbsolutePaths(result.result);
  });

  it("list_workspace_roots ограничен 20, отдаёт rootId/alias", async () => {
    const roots = Array.from({length: 25}, (_, i) => ({
      path: `C:\\ws${i}`,
      color: "blue" as const,
      harness: i === 0,
    }));
    const {deps, ids} = base({roots});
    const result = await executeTool("list_workspace_roots", {}, context(deps, ids));

    const list = result.result as Array<Record<string, unknown>>;
    expect(list).toHaveLength(20);
    expect(list[0]).toEqual({rootId: "root-1", name: "ws0", isHarness: true});
    noAbsolutePaths(result.result);
  });
});

describe("read tools: registry", () => {
  it("get_document резолвит ULID и путь от корня", async () => {
    const {deps, ids} = base();
    const result = await executeTool(
      "get_document",
      {ulid: ULID_A.slice(0, 12)},
      context(deps, ids),
    );

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      ulid: ULID_A,
      path: "docs/a.md",
      title: "Alpha",
      open: true,
      docId: "doc-1",
    });
    noAbsolutePaths(result.result);
  });

  it("get_document: неизвестный ULID — ошибка", async () => {
    const {deps, ids} = base();
    const result = await executeTool(
      "get_document",
      {ulid: "01ZZZZZZZZ"},
      context(deps, ids),
    );
    expect(result).toMatchObject({ok: false, code: "ulid_not_found"});
  });

  it("get_related_documents отдаёт направления графа", async () => {
    const {deps, ids} = base();
    const result = await executeTool(
      "get_related_documents",
      {ulid: ULID_A},
      context(deps, ids),
    );

    expect(result.ok).toBe(true);
    const related = result.result as Array<Record<string, unknown>>;
    expect(related).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ulid: ULID_B, relation: "child", path: "docs/b.md"}),
        expect.objectContaining({ulid: ULID_B, relation: "related", direction: "out"}),
      ]),
    );
    noAbsolutePaths(result.result);
  });
});

describe("read tools: search", () => {
  it("ищет по открытым вкладкам и реестру, ограничивает сниппет", async () => {
    const {deps, ids} = base();
    const open = await executeTool(
      "search_documents",
      {query: "needle"},
      context(deps, ids),
    );
    expect(open.ok).toBe(true);
    const openResults = open.result as Array<Record<string, unknown>>;
    expect(openResults[0]).toMatchObject({docId: "doc-1", path: "docs/a.md", source: "open"});
    expect(String(openResults[0].snippet).length).toBeLessThanOrEqual(200);

    const meta = await executeTool(
      "search_documents",
      {query: "beta", limit: 1},
      context(deps, ids),
    );
    const metaResults = meta.result as Array<Record<string, unknown>>;
    expect(metaResults).toHaveLength(1);
    expect(metaResults[0]).toMatchObject({path: "docs/b.md", source: "registry"});
  });

  it("rootId ограничивает поиск и проверяется", async () => {
    const {deps, ids} = base();
    const rootId = ids.rootId(ROOT);
    const scoped = await executeTool(
      "search_documents",
      {query: "needle", rootId},
      context(deps, ids),
    );
    expect(scoped.ok).toBe(true);

    const unknown = await executeTool(
      "search_documents",
      {query: "needle", rootId: "root-99"},
      context(deps, ids),
    );
    expect(unknown).toMatchObject({ok: false, code: "unknown_root_id"});
  });
});

describe("read tools: tasks and checks", () => {
  const taskSource: TaskSource = {
    loadVocabulary: async () => DEFAULT_TASK_VOCABULARY,
    listTaskDocs: () => [
      {
        repoRoot: ROOT,
        ulid: ULID_A,
        path: "tasks/t1.md",
        project: "p",
        title: "Task one",
        registryType: "tracker",
      },
    ],
    loadTaskDetails: async () => ({
      kind: "daily-task",
      status: "В работе",
      task: "do it",
      tracker: null,
      priority: "high",
      assignee: "andrey",
    }),
  };

  it("list_tasks фильтрует по статусу/assignee/project", async () => {
    const {deps, ids} = base({taskSource});
    const ok = await executeTool(
      "list_tasks",
      {status: "in_progress", assignee: "andrey", project: "p"},
      context(deps, ids),
    );
    expect(ok.ok).toBe(true);
    expect(ok.result).toEqual([
      {
        ulid: ULID_A,
        path: "tasks/t1.md",
        title: "Task one",
        project: "p",
        kind: "daily-task",
        status: "in_progress",
        assignee: "andrey",
        priority: "high",
        tracker: null,
      },
    ]);

    const none = await executeTool(
      "list_tasks",
      {status: "done"},
      context(deps, ids),
    );
    expect(none.result).toEqual([]);
  });

  it("vasyavig.yaml не проверяется и не правится ассистентом", async () => {
    const configPath = "C:\\ws\\vasyavig.yaml";
    const {deps, ids} = base({
      tabs: [makeTab(configPath, "version: 1\n", {kind: "text"})],
      activePath: configPath,
    });
    const docId = ids.docId(configPath);

    const check = await executeTool("check_document", {docId}, context(deps, ids));
    expect(check).toMatchObject({ok: false, code: "config_read_only"});

    const propose = await executeTool(
      "propose_replace",
      {docId, oldText: "version", newText: "v"},
      context(deps, ids, {tier: "propose"}),
    );
    expect(propose).toMatchObject({ok: false, code: "config_read_only"});
  });

  it("check_document возвращает findings и counts", async () => {
    const content = "# Doc\n\n[bad](harness_ulid:ABC)\n[go](#missing)\n";
    const {deps, ids} = base({
      tabs: [makeTab(FILE_A, content)],
      activePath: FILE_A,
      files: {[FILE_A]: content},
    });
    const docId = ids.docId(FILE_A);
    const result = await executeTool(
      "check_document",
      {docId},
      context(deps, ids),
    );

    expect(result.ok).toBe(true);
    const check = result.result as {
      docId: string;
      path: string;
      findings: Array<{rule: string}>;
      counts: {error: number; warning: number; info: number};
    };
    expect(check.docId).toBe(docId);
    expect(check.path).toBe("docs/a.md");
    expect(check.findings.some((item) => item.rule === "links")).toBe(true);
    expect(check.findings.some((item) => item.rule === "anchors")).toBe(true);
    expect(check.counts.error + check.counts.warning + check.counts.info).toBe(
      check.findings.length,
    );
    noAbsolutePaths(result.result);
  });
});

describe("forbidden tools and tiers", () => {
  it("shell/FS/save-инструменты отсутствуют и запрещены", async () => {
    const {deps, ids} = base();
    for (const name of [
      "run_command",
      "shell",
      "exec",
      "read_file",
      "write_file",
      "list_dir",
      "http_request",
      "save_document",
      "delete_document",
      "rename_document",
      "move_document",
    ]) {
      const result = await executeTool(name, {}, context(deps, ids, {tier: "propose"}));
      expect(result, name).toMatchObject({ok: false, code: "forbidden_tool"});
    }
  });

  it("apply_proposal недоступен модели", async () => {
    const {deps, ids} = base();
    const result = await executeTool(
      "apply_proposal",
      {proposalId: "prop-1"},
      context(deps, ids, {tier: "propose"}),
    );
    expect(result).toMatchObject({ok: false, code: "app_only_tool"});
  });

  it("propose-инструмент в read-тире отклоняется", async () => {
    const {deps, ids} = base();
    const result = await executeTool(
      "propose_replace",
      {docId: "doc-1", oldText: "needle", newText: "x"},
      context(deps, ids, {tier: "read"}),
    );
    expect(result).toMatchObject({ok: false, code: "tier_denied"});
  });
});

describe("propose tools via executor", () => {
  it("propose_replace не меняет буфер и не отдаёт absolute path", async () => {
    const proposals: unknown[] = [];
    const {deps, ids, state} = base();
    const docId = ids.docId(FILE_A);
    const result = await executeTool(
      "propose_replace",
      {docId, oldText: "needle", newText: "thread", rationale: "fix"},
      context(deps, ids, {tier: "propose", onProposal: (p) => proposals.push(p)}),
    );

    expect(result.ok).toBe(true);
    expect(proposals).toHaveLength(1);
    expect(state.tabs[0].content).toContain("needle");
    expect(state.updated).toHaveLength(0);
    const proposal = (result.result as {proposal: Record<string, unknown>}).proposal;
    expect(proposal).toMatchObject({
      kind: "replace",
      path: "docs/a.md",
      expectedCount: 1,
      oldTextLength: 6,
      newTextLength: 6,
    });
    noAbsolutePaths(result.result);
  });

  it("propose_create проверяет путь и не создаёт файл", async () => {
    const {deps, ids, state} = base();
    const rootId = ids.rootId(ROOT);
    const result = await executeTool(
      "propose_create",
      {rootId, relativePath: "docs/new.md", content: "# New"},
      context(deps, ids, {tier: "propose"}),
    );

    expect(result.ok).toBe(true);
    expect(state.created).toHaveLength(0);
    expect(state.validateCalls).toEqual([{root: ROOT, relativePath: "docs/new.md"}]);
    const proposal = (result.result as {proposal: Record<string, unknown>}).proposal;
    expect(proposal).toMatchObject({kind: "create", rootId, path: "docs/new.md"});
    noAbsolutePaths(result.result);
  });

  it("propose_create отклоняет traversal до вызова deps", async () => {
    const {deps, ids, state} = base();
    const rootId = ids.rootId(ROOT);
    const result = await executeTool(
      "propose_create",
      {rootId, relativePath: "../escape.md", content: "x"},
      context(deps, ids, {tier: "propose"}),
    );
    expect(result).toMatchObject({ok: false, code: "invalid_path"});
    expect(state.validateCalls).toHaveLength(0);
  });

  it("бюджет вызовов исчерпывается", async () => {
    const {deps, ids} = base();
    const limits: PolicyLimits = {...DEFAULT_POLICY_LIMITS, maxToolCallsPerRun: 1};
    const ctx = context(deps, ids, {limits});
    expect((await executeTool("get_active_document", {}, ctx)).ok).toBe(true);
    const second = await executeTool("list_open_documents", {}, ctx);
    expect(second).toMatchObject({ok: false, code: "budget_exceeded"});
  });
});
