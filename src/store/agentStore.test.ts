// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {createToolBudget} from "../lib/agent/policy";
import {sessionIds} from "../lib/agent/ids";

vi.mock("../lib/i18n", () => ({
  default: {t: (key: string) => key},
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

const initialAgent = useAgentStore.getState();
const initialEditor = useEditorStore.getState();
const PATH = "C:\\ws\\docs\\a.md";

beforeEach(() => {
  useEditorStore.setState(initialEditor, true);
  useAgentStore.setState(
    {
      ...initialAgent,
      findings: [],
      findingsDocId: null,
      findingsDocName: null,
      findingsAt: null,
      checkRunning: false,
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
});

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
