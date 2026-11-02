import type {SessionIds} from "../ids";
import {
  assertToolAllowed,
  chargeProposal,
  chargeResult,
  chargeToolCall,
  DEFAULT_POLICY_LIMITS,
  parseToolArgs,
  PolicyError,
  type ModelTier,
  type PolicyLimits,
  type ToolBudget,
} from "../policy";
import type {Proposal} from "../proposals";
import type {ToolDeps} from "./deps";
import {ToolError} from "./errors";
import {
  checkDocument,
  getActiveDocument,
  getDocument,
  getRelatedDocuments,
  getSelection,
  listOpenDocuments,
  listTasks,
  listWorkspaceRoots,
  searchDocuments,
} from "./read";
import {proposeCreate, proposeInsert, proposeReplace} from "./propose";

/**
 * Исполнитель инструментов (Phase 8.2): policy → валидация аргументов →
 * реализация → бюджет → результат. Модель получает только model-тиры;
 * `apply_proposal` сюда не попадает (app-only).
 *
 * Полные proposal-объекты остаются в приложении (`onProposal`); модели
 * возвращается безопасное представление без absolute path и без дублей
 * oldText/newText.
 */

export interface ToolCallContext {
  tier: ModelTier;
  ids: SessionIds;
  deps: ToolDeps;
  budget: ToolBudget;
  limits?: PolicyLimits;
  onProposal?: (proposal: Proposal) => void;
  runId?: string;
  modelId?: string;
}

export interface ToolCallResult {
  ok: boolean;
  name: string;
  result?: unknown;
  error?: string;
  code?: string;
  durationMs?: number;
}

function proposalForModel(proposal: Proposal): Record<string, unknown> {
  const common = {
    proposalId: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    path: proposal.relativePath,
    baseHash: proposal.baseHash,
    rationale: proposal.rationale,
  };
  if (proposal.kind === "replace") {
    return {
      ...common,
      docId: proposal.docId,
      oldTextLength: proposal.oldText.length,
      newTextLength: proposal.newText.length,
      expectedCount: proposal.expectedCount,
    };
  }
  if (proposal.kind === "insert") {
    return {
      ...common,
      docId: proposal.docId,
      anchor: proposal.anchor,
      position: proposal.position,
      textLength: proposal.text.length,
    };
  }
  return {
    ...common,
    rootId: proposal.rootId,
    contentLength: proposal.content.length,
  };
}

export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolCallContext,
): Promise<ToolCallResult> {
  const limits = ctx.limits ?? DEFAULT_POLICY_LIMITS;
  const started = ctx.deps.now();

  try {
    assertToolAllowed(name, ctx.tier);
    const args = parseToolArgs(name, rawArgs, limits);
    chargeToolCall(ctx.budget, limits);

    let result: unknown;
    switch (name) {
      case "get_active_document":
        result = getActiveDocument(ctx.deps, ctx.ids, limits);
        break;
      case "get_selection":
        result = getSelection(ctx.deps, ctx.ids);
        break;
      case "list_open_documents":
        result = listOpenDocuments(ctx.deps, ctx.ids);
        break;
      case "list_workspace_roots":
        result = listWorkspaceRoots(ctx.deps, ctx.ids);
        break;
      case "get_document":
        result = await getDocument(ctx.deps, ctx.ids, limits, args as {ulid: string});
        break;
      case "search_documents":
        result = await searchDocuments(ctx.deps, ctx.ids, args as {
          query: string;
          rootId?: string;
          limit: number;
        });
        break;
      case "get_related_documents":
        result = getRelatedDocuments(ctx.deps, args as {ulid: string});
        break;
      case "list_tasks":
        result = await listTasks(ctx.deps, args as {
          status?: string;
          assignee?: string;
          project?: string;
        });
        break;
      case "check_document":
        result = await checkDocument(ctx.deps, ctx.ids, args as {
          docId: string;
          rules?: Parameters<typeof checkDocument>[2]["rules"];
        });
        break;
      case "propose_replace": {
        const proposal = proposeReplace(ctx.deps, ctx.ids, args as {
          docId: string;
          oldText: string;
          newText: string;
          expectedCount: number;
          rationale?: string;
        });
        chargeProposal(ctx.budget, proposal.oldText.length + proposal.newText.length, limits);
        ctx.onProposal?.(proposal);
        result = {proposal: proposalForModel(proposal)};
        break;
      }
      case "propose_insert": {
        const proposal = proposeInsert(ctx.deps, ctx.ids, args as {
          docId: string;
          anchor: string;
          position: "before" | "after";
          text: string;
          rationale?: string;
        });
        chargeProposal(ctx.budget, proposal.text.length, limits);
        ctx.onProposal?.(proposal);
        result = {proposal: proposalForModel(proposal)};
        break;
      }
      case "propose_create": {
        const proposal = await proposeCreate(ctx.deps, ctx.ids, args as {
          rootId: string;
          relativePath: string;
          content: string;
          rationale?: string;
        });
        chargeProposal(ctx.budget, proposal.content.length, limits);
        ctx.onProposal?.(proposal);
        result = {proposal: proposalForModel(proposal)};
        break;
      }
      default:
        throw new ToolError("unknown_tool", `неизвестный инструмент: ${name}`);
    }

    const serialized = JSON.stringify(result ?? null);
    chargeResult(ctx.budget, serialized.length, limits);
    return {
      ok: true,
      name,
      result,
      durationMs: ctx.deps.now() - started,
    };
  } catch (e) {
    if (e instanceof PolicyError) {
      return {ok: false, name, code: e.code, error: e.message, durationMs: ctx.deps.now() - started};
    }
    if (e instanceof ToolError) {
      return {ok: false, name, code: e.code, error: e.message, durationMs: ctx.deps.now() - started};
    }
    return {
      ok: false,
      name,
      code: "tool_error",
      error: e instanceof Error ? e.message : String(e),
      durationMs: ctx.deps.now() - started,
    };
  }
}
