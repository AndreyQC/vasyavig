import {create} from "zustand";
import {recordAudit, type AuditOperation} from "../lib/agent/audit";
import type {Finding} from "../lib/agent/findings";
import {resetSessionIds, sessionIds} from "../lib/agent/ids";
import {
  createToolBudget,
  DEFAULT_POLICY_LIMITS,
  type ModelTier,
  type ToolBudget,
} from "../lib/agent/policy";
import {
  applyProposal,
  type ApplyResult,
  type Proposal,
  type ProposalKind,
} from "../lib/agent/proposals";
import {executeTool, type ToolCallResult} from "../lib/agent/tools";
import {defaultToolDeps, proposalApplyDeps} from "../lib/agent/tools/deps";
import type {CheckDocumentResult} from "../lib/agent/tools/read";
import {useConfigStore} from "./configStore";
import {useEditorStore} from "./editorStore";

/**
 * Состояние прогонов ассистента (Phase 8.2): findings, proposals, бюджет
 * инструментов, последний error. Session-only; содержимое документов здесь
 * не дублируется — только findings/proposals, которые строит приложение.
 *
 * `applyProposalById` — app-only путь: UI подтверждает, модель сюда не ходит.
 */

export interface ToolCallLog {
  id: number;
  name: string;
  ok: boolean;
  code?: string;
  durationMs?: number;
}

export interface AgentState {
  findings: Finding[];
  findingsDocId: string | null;
  findingsDocName: string | null;
  findingsAt: number | null;
  checkRunning: boolean;
  proposals: Proposal[];
  toolCalls: ToolCallLog[];
  budget: ToolBudget;
  runId: string | null;
  applyingProposalId: string | null;
  lastError: string | null;

  runTool: (
    name: string,
    args: Record<string, unknown>,
    tier?: ModelTier,
  ) => Promise<ToolCallResult>;
  runCheckDocument: () => Promise<ToolCallResult>;
  applyProposalById: (proposalId: string) => Promise<ApplyResult>;
  rejectProposal: (proposalId: string) => void;
  clearProposal: (proposalId: string) => void;
  clearFindings: () => void;
  resetSession: () => void;
}

let toolCallSeq = 0;

function auditOptions(): {enabled: boolean; retainRuns: number} {
  const audit = useConfigStore.getState().config.app.assistant.audit;
  return {enabled: audit.enabled, retainRuns: audit.retainRuns};
}

function selectedModelId(): string | undefined {
  const id = useConfigStore.getState().selectedModel;
  return id || undefined;
}

function operationFor(kind: ProposalKind): AuditOperation {
  return kind === "replace"
    ? "propose_replace"
    : kind === "insert"
      ? "propose_insert"
      : "propose_create";
}

const initialState = {
  findings: [] as Finding[],
  findingsDocId: null as string | null,
  findingsDocName: null as string | null,
  findingsAt: null as number | null,
  checkRunning: false,
  proposals: [] as Proposal[],
  toolCalls: [] as ToolCallLog[],
  budget: createToolBudget(),
  runId: null as string | null,
  applyingProposalId: null as string | null,
  lastError: null as string | null,
};

export const useAgentStore = create<AgentState>((set, get) => ({
  ...initialState,

  runTool: async (name, args, tier = "read") => {
    let runId = get().runId;
    if (!runId) {
      runId = `run-${Date.now().toString(36)}`;
      set({runId});
    }
    const result = await executeTool(name, args, {
      tier,
      ids: sessionIds(),
      deps: defaultToolDeps(),
      budget: get().budget,
      limits: DEFAULT_POLICY_LIMITS,
      runId: runId ?? undefined,
      modelId: selectedModelId(),
      onProposal: (proposal) => {
        set((state) => ({proposals: [...state.proposals, proposal], lastError: null}));
        recordAudit(
          {
            operation: operationFor(proposal.kind),
            result: "proposed",
            model: selectedModelId(),
            runId: runId ?? undefined,
            docId: proposal.kind === "create" ? undefined : proposal.docId,
            path: proposal.relativePath,
            hash: proposal.baseHash,
            proposalKind: proposal.kind,
          },
          auditOptions(),
        );
      },
    });

    set((state) => ({
      toolCalls: [
        ...state.toolCalls,
        {
          id: ++toolCallSeq,
          name,
          ok: result.ok,
          code: result.code,
          durationMs: result.durationMs,
        },
      ].slice(-50),
    }));

    if (name === "check_document" && result.ok) {
      const check = result.result as CheckDocumentResult | undefined;
      recordAudit(
        {
          operation: "check_document",
          result: "ok",
          model: selectedModelId(),
          runId: runId ?? undefined,
          docId: check?.docId,
          path: check?.path,
          findings: check?.findings.length,
        },
        auditOptions(),
      );
    } else if (!result.ok && (name === "check_document" || name.startsWith("propose_"))) {
      recordAudit(
        {
          operation: name === "check_document" ? "check_document" : (name as AuditOperation),
          result: "error",
          model: selectedModelId(),
          runId: runId ?? undefined,
        },
        auditOptions(),
      );
    }

    return result;
  },

  runCheckDocument: async () => {
    const editor = useEditorStore.getState();
    const tab = editor.tabs.find((item) => item.path === editor.activePath);
    if (!tab) {
      set({lastError: "Нет активного документа"});
      return {ok: false, name: "check_document", code: "no_active_document", error: "Нет активного документа"};
    }
    if (tab.kind !== "markdown" && tab.kind !== "text") {
      set({lastError: "Активная вкладка не редактируется"});
      return {
        ok: false,
        name: "check_document",
        code: "unsupported_document",
        error: "Активная вкладка не редактируется",
      };
    }

    set({checkRunning: true, lastError: null});
    const docId = sessionIds().docId(tab.path);
    const result = await get().runTool("check_document", {docId});
    if (result.ok) {
      const check = result.result as CheckDocumentResult;
      set({
        findings: check.findings,
        findingsDocId: check.docId,
        findingsDocName: tab.name,
        findingsAt: Date.now(),
        checkRunning: false,
        lastError: null,
      });
    } else {
      set({
        checkRunning: false,
        lastError: result.error ?? "Не удалось проверить документ",
      });
    }
    return result;
  },

  applyProposalById: async (proposalId) => {
    const proposal = get().proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return {ok: false, status: "error", error: "Предложение не найдено"};
    }
    set({applyingProposalId: proposalId, lastError: null});
    const result = await applyProposal(proposal, proposalApplyDeps());
    const status =
      result.status === "applied" ? "applied" : result.status === "stale" ? "stale" : "pending";
    set((state) => ({
      proposals: state.proposals.map((item) =>
        item.id === proposalId ? {...item, status} : item,
      ),
      applyingProposalId: null,
      lastError: result.ok ? null : (result.error ?? "Не удалось применить предложение"),
    }));
    recordAudit(
      {
        operation: "apply_proposal",
        result: result.status,
        model: selectedModelId(),
        runId: get().runId ?? undefined,
        docId: proposal.kind === "create" ? undefined : proposal.docId,
        path: proposal.relativePath,
        hash: proposal.baseHash,
        proposalKind: proposal.kind,
      },
      auditOptions(),
    );
    return result;
  },

  rejectProposal: (proposalId) => {
    const proposal = get().proposals.find((item) => item.id === proposalId);
    if (!proposal) return;
    set((state) => ({
      proposals: state.proposals.map((item) =>
        item.id === proposalId ? {...item, status: "rejected"} : item,
      ),
    }));
    recordAudit(
      {
        operation: "apply_proposal",
        result: "rejected",
        model: selectedModelId(),
        runId: get().runId ?? undefined,
        docId: proposal.kind === "create" ? undefined : proposal.docId,
        path: proposal.relativePath,
        hash: proposal.baseHash,
        proposalKind: proposal.kind,
      },
      auditOptions(),
    );
  },

  clearProposal: (proposalId) =>
    set((state) => ({
      proposals: state.proposals.filter((item) => item.id !== proposalId),
    })),

  clearFindings: () =>
    set({
      findings: [],
      findingsDocId: null,
      findingsDocName: null,
      findingsAt: null,
      lastError: null,
    }),

  resetSession: () => {
    resetSessionIds();
    set({
      ...initialState,
      findings: [],
      proposals: [],
      toolCalls: [],
      budget: createToolBudget(),
    });
  },
}));
