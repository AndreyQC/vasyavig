// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {createToolBudget} from "../lib/agent/policy";
import type {Proposal} from "../lib/agent/proposals";
import {sessionIds} from "../lib/agent/ids";

vi.mock("../lib/i18n", () => ({
  default: {t: (key: string) => key},
}));

vi.mock("../lib/agent/provider", () => ({
  runChat: vi.fn(),
  cancelChatRun: vi.fn(),
  createRunId: vi.fn(() => "test-run"),
}));

vi.mock("../hooks/useTauriFS", () => ({
  convertToMarkdown: vi.fn(),
  createDir: vi.fn(async () => {}),
  createFile: vi.fn(async () => {}),
  deletePath: vi.fn(async () => {}),
  getFileMetadata: vi.fn(async () => {
    throw new Error("missing");
  }),
  grantAssetScope: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
  openFileDialog: vi.fn(async () => null),
  openFolderDialog: vi.fn(async () => null),
  readFile: vi.fn(async () => ""),
  readFileLatin1: vi.fn(async () => ""),
  renamePath: vi.fn(async () => {}),
  saveEmailHtmlDialog: vi.fn(async () => null),
  saveFileDialog: vi.fn(async () => null),
  saveWorkspaceFileDialog: vi.fn(async () => null),
  unwatchFolder: vi.fn(async () => {}),
  validateCreateTarget: vi.fn(async (_root: string, relativePath: string) => ({
    absolutePath: `C:\\ws\\${relativePath.replace(/\//g, "\\")}`,
    relativePath,
  })),
  watchFolder: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

const {useAgentStore} = await import("./agentStore");
const {useEditorStore} = await import("./editorStore");
const {useConfigStore} = await import("./configStore");
const provider = await import("../lib/agent/provider");
const {auditLog} = await import("../lib/agent/audit");
const {collectFindings} = await import("../lib/agent/findings");

const runChatMock = vi.mocked(provider.runChat);
const cancelChatRunMock = vi.mocked(provider.cancelChatRun);

const initialAgent = useAgentStore.getState();
const initialEditor = useEditorStore.getState();
const initialConfig = useConfigStore.getState();
const PATH = "C:\\ws\\docs\\a.md";

beforeEach(() => {
  useEditorStore.setState(initialEditor, true);
  useConfigStore.setState(initialConfig, true);
  useAgentStore.setState(
    {
      ...initialAgent,
      findings: [],
      findingsDocId: null,
      findingsDocName: null,
      findingsAt: null,
      checkRunning: false,
      modelRunning: false,
      modelNotice: null,
      verdicts: [],
      proposals: [],
      toolCalls: [],
      budget: createToolBudget(),
      runId: null,
      applyingProposalId: null,
      lastError: null,
    },
    true,
  );
  useAgentStore.getState().resetSession();
  auditLog.clear();
  runChatMock.mockReset();
  cancelChatRunMock.mockReset();
});

function enableModel(): void {
  useConfigStore.setState({
    selectedModel: "m1",
    models: {
      m1: {
        label: "M1",
        baseUrl: "https://ep.example/v1",
        model: "test-model",
        apiKey: "",
        temperature: 0.1,
        maxTokens: 512,
        contextLimit: 8000,
        timeoutMs: 1000,
        capabilities: {streaming: true, jsonMode: true, tools: false},
        dataScope: "perimeter",
      },
    },
  });
}

function chatOk(text: string) {
  return {ok: true as const, text, cancelled: false, attempts: 1, streaming: false, jsonMode: true};
}

/** Документ с устаревшим TOC, двумя legacy-ссылками и битым якорем. */
const LEGACY_DOC =
  [
    "# Doc",
    "",
    "## Оглавление",
    "",
    "- [Old](#old)",
    "",
    "## Раздел",
    "",
    "[a](harness_ulid:01JAAAAAAAAAAAAAAAAAAAAAAAA)",
    "[b](harness_ulid:01JBBBBBBBBBBBBBBBBBBBBBBBB)",
    "",
    "см. [текст](#net-razdela)",
  ].join("\n") + "\n";

type ReplaceP = Extract<Proposal, {kind: "replace"}>;

function openText(content: string): void {
  useEditorStore.getState().openTab({path: PATH, kind: "text", content});
  useEditorStore.getState().setActiveTab(PATH);
}

describe("agentStore", () => {
  it("runCheckDocument складывает findings и имя документа", async () => {
    openText("# Doc\n\n[go](#missing)\n");

    const result = await useAgentStore.getState().runCheckDocument();

    expect(result.ok).toBe(true);
    const state = useAgentStore.getState();
    expect(state.findings.some((finding) => finding.rule === "anchors")).toBe(true);
    expect(state.findingsDocName).toBe("a.md");
    expect(state.findingsAt).not.toBeNull();
    expect(state.checkRunning).toBe(false);
  });

  it("propose-инструмент добавляет proposal, apply применяет только по вызову", async () => {
    openText("hello world\n");
    const docId = sessionIds().docId(PATH);

    const proposed = await useAgentStore
      .getState()
      .runTool("propose_replace", {docId, oldText: "world", newText: "there"}, "propose");

    expect(proposed.ok).toBe(true);
    expect(useEditorStore.getState().tabs[0].content).toBe("hello world\n");
    expect(useAgentStore.getState().proposals).toHaveLength(1);
    const proposal = useAgentStore.getState().proposals[0];
    expect(proposal.status).toBe("pending");

    const applied = await useAgentStore.getState().applyProposalById(proposal.id);

    expect(applied).toMatchObject({ok: true, status: "applied"});
    expect(useEditorStore.getState().tabs[0].content).toBe("hello there\n");
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true);
    expect(useAgentStore.getState().proposals[0].status).toBe("applied");
  });

  it("отклонённый proposal не меняет документ", async () => {
    openText("hello world\n");
    const docId = sessionIds().docId(PATH);
    await useAgentStore
      .getState()
      .runTool("propose_replace", {docId, oldText: "world", newText: "there"}, "propose");
    const proposal = useAgentStore.getState().proposals[0];

    useAgentStore.getState().rejectProposal(proposal.id);

    expect(useEditorStore.getState().tabs[0].content).toBe("hello world\n");
    expect(useAgentStore.getState().proposals[0].status).toBe("rejected");
  });
});

describe("рецепт проверки документа (8.3)", () => {
  /** Фактический id anchors-finding'а (seq в findings общий для всех правил). */
  async function anchorsFindingId(): Promise<string> {
    const findings = await collectFindings({content: LEGACY_DOC, path: PATH});
    const anchor = findings.find((item) => item.rule === "anchors" && item.line === 12);
    expect(anchor).toBeTruthy();
    return anchor?.id ?? "";
  }

  it("без модели: findings и детерминированные фиксы, модель не вызывается", async () => {
    openText(LEGACY_DOC);

    const result = await useAgentStore.getState().runCheckDocument();

    expect(result.ok).toBe(true);
    expect(runChatMock).not.toHaveBeenCalled();
    const state = useAgentStore.getState();
    expect(state.findings.length).toBeGreaterThan(0);
    expect(state.proposals).toHaveLength(3); // tocStale + 2 legacy-ссылки
    expect(state.modelNotice).toBeNull();
    expect(state.checkRunning).toBe(false);
    // буфер не меняется — только pending-предложения
    expect(useEditorStore.getState().tabs[0].content).toBe(LEGACY_DOC);
  });

  it("детерминированные фиксы идут через propose-путь, audit без модели", async () => {
    openText(LEGACY_DOC);
    await useAgentStore.getState().runCheckDocument();

    const proposals = useAgentStore.getState().proposals;
    const legacy = proposals.find(
      (item): item is ReplaceP =>
        item.kind === "replace" && item.oldText.includes("harness_ulid:01JAAAA"),
    );
    expect(legacy?.newText).toContain("](harness-ulid:01JAAAAAAAAAAAAAAAAAAAAAAAA)");
    const toc = proposals.find(
      (item): item is ReplaceP => item.kind === "replace" && item.oldText.includes("- [Old](#old)"),
    );
    expect(toc?.newText).toContain("Раздел");

    const proposedAudit = auditLog.list().filter((entry) => entry.operation === "propose_replace");
    expect(proposedAudit).toHaveLength(3);
    expect(proposedAudit.every((entry) => entry.model === undefined)).toBe(true);
  });

  it("модель: fix-вердикт строит proposal, промпт без абсолютных путей, audit run ok", async () => {
    openText(LEGACY_DOC);
    enableModel();
    const anchorId = await anchorsFindingId();
    runChatMock.mockResolvedValue(
      chatOk(
        JSON.stringify({
          verdicts: [
            {
              findingId: anchorId,
              action: "fix",
              replacement: "razdel",
              rationale: "Правильный якорь раздела",
            },
          ],
        }),
      ),
    );

    await useAgentStore.getState().runCheckDocument();

    expect(runChatMock).toHaveBeenCalledTimes(1);
    const call = runChatMock.mock.calls[0][0];
    expect(call.jsonMode).toBe(true);
    expect(JSON.stringify(call.messages)).not.toContain("C:");
    expect(JSON.stringify(call.messages)).not.toContain(PATH);

    const state = useAgentStore.getState();
    expect(state.proposals).toHaveLength(4); // 3 детерминированных + 1 от модели
    const fixed = state.proposals.find(
      (item): item is ReplaceP => item.kind === "replace" && item.oldText === "](#net-razdela)",
    );
    expect(fixed?.newText).toBe("](#razdel)");
    expect(fixed?.rationale).toBe("Правильный якорь раздела");
    expect(state.modelNotice?.kind).toBe("info");
    expect(state.modelNotice?.key).toBe("assistant.modelStage.ok");

    const runAudit = auditLog.list().filter((entry) => entry.operation === "run");
    expect(runAudit).toHaveLength(1);
    expect(runAudit[0]).toMatchObject({result: "ok", model: "m1", findings: state.findings.length});
    const modelProposalAudit = auditLog
      .list()
      .filter((entry) => entry.operation === "propose_replace" && entry.model === "m1");
    expect(modelProposalAudit).toHaveLength(1);
  });

  it("невалидный ответ модели: один repair-retry, затем ошибка, фиксы остаются", async () => {
    openText(LEGACY_DOC);
    enableModel();
    const bad = chatOk('{"verdicts":[{"findingId":"nope-1-1","action":"keep"}]}');
    runChatMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(bad);

    await useAgentStore.getState().runCheckDocument();

    expect(runChatMock).toHaveBeenCalledTimes(2);
    const repairCall = runChatMock.mock.calls[1][0];
    expect(repairCall.messages).toHaveLength(4);
    expect(repairCall.messages[3].role).toBe("user");
    expect(repairCall.messages[3].content).toContain("не прошёл валидацию");

    const state = useAgentStore.getState();
    expect(state.modelNotice?.kind).toBe("error");
    expect(state.modelNotice?.key).toBe("assistant.modelStage.invalid");
    expect(state.findings.length).toBeGreaterThan(0);
    expect(state.proposals).toHaveLength(3);
    expect(state.verdicts).toHaveLength(0);
    const runAudit = auditLog.list().filter((entry) => entry.operation === "run");
    expect(runAudit[0].result).toBe("error");
  });

  it("repair-retry с валидным ответом достраивает proposals", async () => {
    openText(LEGACY_DOC);
    enableModel();
    const anchorId = await anchorsFindingId();
    runChatMock
      .mockResolvedValueOnce(
        chatOk(
          JSON.stringify({
            verdicts: [{findingId: anchorId, action: "fix", replacement: "с пробелом"}],
          }),
        ),
      )
      .mockResolvedValueOnce(
        chatOk(
          JSON.stringify({
            verdicts: [{findingId: anchorId, action: "fix", replacement: "razdel"}],
          }),
        ),
      );

    await useAgentStore.getState().runCheckDocument();

    expect(runChatMock).toHaveBeenCalledTimes(2);
    const state = useAgentStore.getState();
    expect(state.proposals).toHaveLength(4);
    expect(state.modelNotice?.key).toBe("assistant.modelStage.ok");
  });

  it("ошибка транспорта: findings и детерминированные фиксы остаются", async () => {
    openText(LEGACY_DOC);
    enableModel();
    runChatMock.mockResolvedValue({
      ok: false,
      text: "",
      error: "HTTP 500",
      cancelled: false,
      attempts: 2,
      streaming: false,
      jsonMode: true,
    });

    await useAgentStore.getState().runCheckDocument();

    expect(runChatMock).toHaveBeenCalledTimes(1);
    const state = useAgentStore.getState();
    expect(state.modelNotice?.kind).toBe("error");
    expect(state.modelNotice?.key).toBe("assistant.modelStage.error");
    expect(state.findings.length).toBeGreaterThan(0);
    expect(state.proposals).toHaveLength(3);
    const runAudit = auditLog.list().filter((entry) => entry.operation === "run");
    expect(runAudit[0].result).toBe("error");
  });

  it("пакет фиксов применяется по одному: rebase не делает остальные stale", async () => {
    openText(LEGACY_DOC);
    await useAgentStore.getState().runCheckDocument();
    const legacy = useAgentStore
      .getState()
      .proposals.filter(
        (item): item is Extract<typeof item, {kind: "replace"}> =>
          item.kind === "replace" && item.oldText.includes("harness_ulid"),
      );
    expect(legacy).toHaveLength(2);

    const first = await useAgentStore.getState().applyProposalById(legacy[0].id);
    expect(first.status).toBe("applied");
    const second = await useAgentStore.getState().applyProposalById(legacy[1].id);
    expect(second.status).toBe("applied");

    const content = useEditorStore.getState().tabs[0].content;
    expect(content).toContain("](harness-ulid:01JAAAAAAAAAAAAAAAAAAAAAAAA)");
    expect(content).toContain("](harness-ulid:01JBBBBBBBBBBBBBBBBBBBBBBBB)");
  });

  it("документ без findings: модель не вызывается", async () => {
    openText("Просто текст без заголовков и ссылок.\n");
    enableModel();

    await useAgentStore.getState().runCheckDocument();

    expect(runChatMock).not.toHaveBeenCalled();
    expect(useAgentStore.getState().proposals).toHaveLength(0);
  });

  it("cancelCheck отменяет активный runId", async () => {
    openText("текст\n");
    await useAgentStore.getState().runTool("get_active_document", {});
    const runId = useAgentStore.getState().runId;
    expect(runId).toBeTruthy();

    useAgentStore.getState().cancelCheck();

    expect(cancelChatRunMock).toHaveBeenCalledWith(runId);
  });
});

describe("рецепт письма HTML (8.4)", () => {
  const DOC = "# Отчёт\n\nПервый абзац документа.\n";

  it("без модели: письмо строится, тема = имя документа, preview-вкладка html", async () => {
    openText(DOC);

    await useAgentStore.getState().runEmailHtml();

    const state = useAgentStore.getState();
    expect(runChatMock).not.toHaveBeenCalled();
    expect(state.emailRunning).toBe(false);
    expect(state.emailResult).not.toBeNull();
    const result = state.emailResult!;
    expect(result.metaSource).toBe("fallback");
    expect(result.subject).toBe("a"); // имя без расширения
    expect(result.preheader).toBe("");
    expect(result.warnings).toEqual([]);
    expect(result.html).toContain('width="600"');
    expect(result.html).toContain("Первый абзац документа");
    // превью — эфемерная вкладка kind html; документ-источник не менялся
    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[1].kind).toBe("html");
    expect(tabs[1].preview).toBe(true);
    expect(tabs[1].content).toBe(result.html);
    expect(useEditorStore.getState().tabs[0].content).toBe(DOC);
    expect(state.emailNotice?.key).toBe("assistant.email.sourceFallback");
    // audit: метаданные без содержимого
    const entries = auditLog.list().filter((entry) => entry.operation === "email_html");
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBe("ok");
    expect(entries[0].model).toBeUndefined();
    const auditJson = JSON.stringify(entries);
    expect(auditJson).not.toContain("Первый абзац");
    expect(auditJson).not.toContain("Отчёт");
  });

  it("модель: тема/preheader из строгого JSON, jsonMode, audit с моделью и без содержимого", async () => {
    openText(DOC);
    enableModel();
    runChatMock.mockResolvedValue(
      chatOk(JSON.stringify({subject: "Отчёт за неделю", preheader: "Анонс письма"})),
    );

    await useAgentStore.getState().runEmailHtml();

    expect(runChatMock).toHaveBeenCalledTimes(1);
    const call = runChatMock.mock.calls[0][0];
    expect(call.jsonMode).toBe(true);
    expect(call.stream).toBe(false);
    expect(JSON.stringify(call.messages)).toContain("Первый абзац документа");
    expect(JSON.stringify(call.messages)).not.toContain("C:");
    expect(JSON.stringify(call.messages)).not.toContain(PATH);

    const state = useAgentStore.getState();
    const result = state.emailResult!;
    expect(result.metaSource).toBe("model");
    expect(result.subject).toBe("Отчёт за неделю");
    expect(result.preheader).toBe("Анонс письма");
    const entries = auditLog.list().filter((entry) => entry.operation === "email_html");
    expect(entries[0].result).toBe("ok");
    expect(entries[0].model).toBe("m1");
    expect(JSON.stringify(entries)).not.toContain("Отчёт за неделю");
  });

  it("невалидный JSON дважды: repair-retry, затем fallback с notice", async () => {
    openText(DOC);
    enableModel();
    runChatMock
      .mockResolvedValueOnce(chatOk("совсем не json"))
      .mockResolvedValueOnce(chatOk('{"unknown": true}'));

    await useAgentStore.getState().runEmailHtml();

    expect(runChatMock).toHaveBeenCalledTimes(2);
    const state = useAgentStore.getState();
    expect(state.emailResult?.metaSource).toBe("fallback");
    expect(state.emailNotice?.key).toBe("assistant.email.sourceInvalid");
  });

  it("первый ответ невалиден, repair успешен — тема от модели", async () => {
    openText(DOC);
    enableModel();
    runChatMock
      .mockResolvedValueOnce(chatOk('{"subject": "Тема", "body": "лишнее поле"}'))
      .mockResolvedValueOnce(
        chatOk(JSON.stringify({subject: "Тема из repair", preheader: "П"})),
      );

    await useAgentStore.getState().runEmailHtml();

    expect(runChatMock).toHaveBeenCalledTimes(2);
    const state = useAgentStore.getState();
    expect(state.emailResult?.subject).toBe("Тема из repair");
    expect(state.emailResult?.metaSource).toBe("model");
  });

  it("транспортная ошибка модели: fallback и письмо строится", async () => {
    openText(DOC);
    enableModel();
    runChatMock.mockResolvedValue({
      ok: false,
      text: "",
      error: "HTTP 500",
      cancelled: false,
      attempts: 2,
      streaming: false,
      jsonMode: true,
    });

    await useAgentStore.getState().runEmailHtml();

    const state = useAgentStore.getState();
    expect(state.emailResult).not.toBeNull();
    expect(state.emailResult?.metaSource).toBe("fallback");
    expect(state.emailNotice).toMatchObject({kind: "error", key: "assistant.email.sourceError"});
  });

  it("отмена: письма нет, audit cancelled", async () => {
    openText(DOC);
    enableModel();
    runChatMock.mockResolvedValue({
      ok: false,
      text: "",
      error: "Запрос отменён",
      cancelled: true,
      attempts: 1,
      streaming: false,
      jsonMode: true,
    });

    await useAgentStore.getState().runEmailHtml();

    const state = useAgentStore.getState();
    expect(state.emailResult).toBeNull();
    expect(state.emailRunning).toBe(false);
    expect(state.emailNotice?.key).toBe("assistant.email.cancelled");
    const entries = auditLog.list().filter((entry) => entry.operation === "email_html");
    expect(entries[0].result).toBe("cancelled");
  });

  it("cancelEmail вызывает cancelChatRun по runId", async () => {
    openText(DOC);
    await useAgentStore.getState().runTool("get_active_document", {});
    const runId = useAgentStore.getState().runId;
    expect(runId).toBeTruthy();

    useAgentStore.getState().cancelEmail();

    expect(cancelChatRunMock).toHaveBeenCalledWith(runId);
  });

  it("нет активного документа: lastError, письмо не строится", async () => {
    await useAgentStore.getState().runEmailHtml();

    expect(useAgentStore.getState().lastError).toBeTruthy();
    expect(useAgentStore.getState().emailResult).toBeNull();
  });
});
