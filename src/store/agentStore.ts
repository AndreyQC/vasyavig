import {create} from "zustand";
import {recordAudit, type AuditOperation} from "../lib/agent/audit";
import {
  deterministicFixFor,
  fixTargetFor,
  type ModelFixTarget,
} from "../lib/agent/fixes";
import type {Finding} from "../lib/agent/findings";
import {contentHash, countOccurrences} from "../lib/agent/hash";
import {resetSessionIds, sessionIds} from "../lib/agent/ids";
import {
  createToolBudget,
  DEFAULT_POLICY_LIMITS,
  type ModelTier,
  type ToolBudget,
} from "../lib/agent/policy";
import {
  applyInsert,
  applyProposal,
  applyReplaceAll,
  type ApplyResult,
  type Proposal,
  type ProposalKind,
} from "../lib/agent/proposals";
import {
  buildCheckMessages,
  buildFindingItems,
  buildRepairMessages,
  parseVerdicts,
  type ModelVerdict,
} from "../lib/agent/recipes/checkDocument";
import {buildContextPack} from "../lib/agent/context";
import {cancelChatRun, runChat, type ChatMessage} from "../lib/agent/provider";
import {executeTool, type ToolCallResult} from "../lib/agent/tools";
import {defaultToolDeps, proposalApplyDeps} from "../lib/agent/tools/deps";
import type {CheckDocumentResult} from "../lib/agent/tools/read";
import {currentSelection} from "./selectionStore";
import {useConfigStore} from "./configStore";
import {useEditorStore} from "./editorStore";

/**
 * Состояние прогонов ассистента (Phase 8.2/8.3): findings, proposals, бюджет
 * инструментов, последний error. Session-only; содержимое документов здесь
 * не дублируется — только findings/proposals, которые строит приложение.
 *
 * `runCheckDocument` — рецепт «Проверка документа» (8.3): детерминированные
 * findings -> детерминированные фиксы (без модели) -> модель -> строгий JSON
 * `{findingId, action, replacement?, rationale?}` -> proposals через
 * propose_* путь. Без модели/endpoint'а findings и локальные фиксы работают.
 *
 * `applyProposalById` — app-only путь: UI подтверждает, модель сюда не ходит.
 */

export interface ModelNotice {
  kind: "info" | "error";
  /** Ключ i18n в assistant.modelStage.*; params переводит UI. */
  key: string;
  params?: Record<string, unknown>;
}

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
  /** Идёт вызов модели в рамках рецепта проверки. */
  modelRunning: boolean;
  /** Итог модельной стадии рецепта (i18n-ключ, без содержимого документов). */
  modelNotice: ModelNotice | null;
  /** Валидированные вердикты модели последнего прогона. */
  verdicts: ModelVerdict[];
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
    opts?: {modelId?: string | null},
  ) => Promise<ToolCallResult>;
  runCheckDocument: () => Promise<ToolCallResult>;
  cancelCheck: () => void;
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
  modelRunning: false,
  modelNotice: null as ModelNotice | null,
  verdicts: [] as ModelVerdict[],
  proposals: [] as Proposal[],
  toolCalls: [] as ToolCallLog[],
  budget: createToolBudget(),
  runId: null as string | null,
  applyingProposalId: null as string | null,
  lastError: null as string | null,
};

export const useAgentStore = create<AgentState>((set, get) => {
  /**
   * Модельная стадия рецепта (8.3): контекст-пак (D15) + findings -> строгий
   * JSON. Один repair-retry при невалидном ответе (§6.1 п. 3), затем понятная
   * ошибка; findings и детерминированные фиксы остаются. Валидированные
   * fix-вердикты строят proposals через propose_* (policy/бюджеты); audit —
   * только метаданные (operation "run").
   */
  const runModelStage = async (
    check: CheckDocumentResult,
    tab: {path: string; name: string; content: string},
    docId: string,
    proposedIds: ReadonlySet<string>,
  ): Promise<void> => {
    set({modelRunning: true});
    const config = useConfigStore.getState();
    const model = config.models[config.selectedModel];
    const modelId = config.selectedModel;
    const requestConfig = config.config.llm.request;
    const runId = get().runId ?? undefined;
    const findingsMap = new Map(check.findings.map((finding) => [finding.id, finding]));

    const auditModelStage = (result: "ok" | "error" | "cancelled") => {
      recordAudit(
        {
          operation: "run",
          result,
          model: modelId,
          runId,
          path: check.path,
          findings: check.findings.length,
        },
        auditOptions(),
      );
    };

    const finish = (notice: ModelNotice) => {
      set({modelRunning: false, modelNotice: notice});
    };

    try {
      const targets = new Map<string, ModelFixTarget>();
      for (const finding of check.findings) {
        if (proposedIds.has(finding.id)) continue;
        const target = fixTargetFor(finding, tab.content);
        if (target) targets.set(finding.id, target);
      }

      const selection = currentSelection();
      const pack = buildContextPack({
        docId,
        name: tab.name,
        content: tab.content,
        selection:
          selection && selection.path === tab.path && selection.text !== ""
            ? {text: selection.text, from: selection.from, to: selection.to}
            : null,
        settings: config.config.app.assistant.context,
      });
      const messages = buildCheckMessages({
        docName: tab.name,
        document: pack.document?.content ?? "(документ не включён в контекст настройками)",
        selection: pack.selection?.text ?? "",
        items: buildFindingItems(check.findings, targets, proposedIds),
      });

      const ask = (msgs: readonly ChatMessage[]) =>
        runChat({
          model,
          requestConfig,
          messages: [...msgs],
          jsonMode: true,
          stream: false,
          runId,
        });

      const onChatFailure = (chat: {cancelled: boolean; error?: string}) => {
        auditModelStage(chat.cancelled ? "cancelled" : "error");
        finish(
          chat.cancelled
            ? {kind: "info", key: "assistant.modelStage.cancelled"}
            : {
                kind: "error",
                key: "assistant.modelStage.error",
                params: {error: chat.error ?? "модель недоступна"},
              },
        );
      };

      let chat = await ask(messages);
      if (!chat.ok) {
        onChatFailure(chat);
        return;
      }
      let parsed = parseVerdicts(chat.text, findingsMap);
      if (!parsed.ok) {
        // один repair-retry, затем понятная ошибка
        chat = await ask(buildRepairMessages(messages, chat.text, parsed.errors));
        if (!chat.ok) {
          onChatFailure(chat);
          return;
        }
        parsed = parseVerdicts(chat.text, findingsMap);
      }
      if (!parsed.ok) {
        auditModelStage("error");
        finish({
          kind: "error",
          key: "assistant.modelStage.invalid",
          params: {errors: parsed.errors.slice(0, 3).join("; ")},
        });
        return;
      }

      let fixes = 0;
      let dropped = 0;
      let notes = 0;
      for (const verdict of parsed.verdicts) {
        if (verdict.rationale) notes++;
        if (verdict.action !== "fix" || verdict.replacement === undefined) continue;
        const target = targets.get(verdict.findingId);
        if (!target) {
          dropped++;
          continue;
        }
        const proposalResult = await get().runTool(
          "propose_replace",
          {
            docId,
            oldText: target.oldText,
            newText: target.newTextFor(verdict.replacement),
            expectedCount: 1,
            ...(verdict.rationale ? {rationale: verdict.rationale} : {}),
          },
          "propose",
        );
        if (proposalResult.ok) fixes++;
        else dropped++;
      }

      set({verdicts: parsed.verdicts});
      auditModelStage("ok");
      finish({
        kind: "info",
        key:
          parsed.verdicts.length === 0
            ? "assistant.modelStage.empty"
            : dropped > 0
              ? "assistant.modelStage.okWithDropped"
              : "assistant.modelStage.ok",
        params: {fixes, notes, dropped},
      });
    } catch (e) {
      auditModelStage("error");
      finish({
        kind: "error",
        key: "assistant.modelStage.error",
        params: {error: e instanceof Error ? e.message : String(e)},
      });
    }
  };

  return {
  ...initialState,

  runTool: async (name, args, tier = "read", opts) => {
    let runId = get().runId;
    if (!runId) {
      runId = `run-${Date.now().toString(36)}`;
      set({runId});
    }
    // Детерминированные шаги рецепта пишут audit без модели — источник фикса
    // не модель, а локальные правила; `modelId: null` — явное «без модели».
    const auditModel =
      opts && opts.modelId !== undefined ? (opts.modelId ?? undefined) : selectedModelId();
    const result = await executeTool(name, args, {
      tier,
      ids: sessionIds(),
      deps: defaultToolDeps(),
      budget: get().budget,
      limits: DEFAULT_POLICY_LIMITS,
      runId: runId ?? undefined,
      modelId: auditModel,
      onProposal: (proposal) => {
        set((state) => ({proposals: [...state.proposals, proposal], lastError: null}));
        recordAudit(
          {
            operation: operationFor(proposal.kind),
            result: "proposed",
            model: auditModel,
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

    set({checkRunning: true, lastError: null, modelNotice: null, verdicts: []});
    const docId = sessionIds().docId(tab.path);
    const result = await get().runTool("check_document", {docId});
    if (!result.ok) {
      set({
        checkRunning: false,
        lastError: result.error ?? "Не удалось проверить документ",
      });
      return result;
    }
    const check = result.result as CheckDocumentResult;
    set({
      findings: check.findings,
      findingsDocId: check.docId,
      findingsDocName: tab.name,
      findingsAt: Date.now(),
    });

    // Детерминированные фиксы (без модели): работают и без endpoint'а (D23).
    const proposedIds = new Set<string>();
    for (const finding of check.findings) {
      const fix = deterministicFixFor(finding, tab.content);
      if (!fix) continue;
      const proposalResult =
        fix.kind === "replace"
          ? await get().runTool(
              "propose_replace",
              {docId, oldText: fix.oldText, newText: fix.newText, expectedCount: 1},
              "propose",
              {modelId: null},
            )
          : await get().runTool(
              "propose_insert",
              {docId, anchor: fix.anchor, position: fix.position, text: fix.text},
              "propose",
              {modelId: null},
            );
      if (proposalResult.ok) proposedIds.add(finding.id);
    }

    // Модельная стадия: только если модель настроена и есть findings.
    const config = useConfigStore.getState();
    const model = config.models[config.selectedModel] ?? null;
    if (model && check.findings.length > 0) {
      await runModelStage(check, {path: tab.path, name: tab.name, content: tab.content}, docId, proposedIds);
    }

    set({checkRunning: false, lastError: null});
    return result;
  },

  cancelCheck: () => {
    const runId = get().runId;
    if (runId) cancelChatRun(runId);
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
    if (result.status === "applied" && proposal.kind !== "create") {
      // Rebase остальных pending-предложений по тому же документу: база
      // изменилась, но их oldText/якорь всё ещё однозначны — пересчитать
      // baseHash/resultText, иначе пакет правок из одного прогона нельзя
      // применить по одной. Если фрагмент потерян/неуникален — stale.
      const appliedTab = useEditorStore
        .getState()
        .tabs.find((item) => item.path === proposal.path);
      if (appliedTab) {
        const content = appliedTab.content;
        const hash = contentHash(content);
        set((state) => ({
          proposals: state.proposals.map((item) => {
            if (item.id === proposalId || item.status !== "pending") return item;
            if (item.kind === "create" || item.path !== proposal.path) return item;
            if (item.kind === "replace") {
              if (countOccurrences(content, item.oldText) !== item.expectedCount) {
                return {...item, status: "stale" as const};
              }
              return {
                ...item,
                baseHash: hash,
                resultText: applyReplaceAll(content, item.oldText, item.newText),
              };
            }
            const rebased = applyInsert(content, item.anchor, item.position, item.text);
            if (rebased === null) return {...item, status: "stale" as const};
            return {...item, baseHash: hash, resultText: rebased};
          }),
        }));
      }
    }
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
      verdicts: [],
      modelNotice: null,
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
  };
});
