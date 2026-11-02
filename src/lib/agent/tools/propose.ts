import {normalizePath} from "../../roots";
import type {SessionIds} from "../ids";
import {
  buildCreateProposal,
  buildInsertProposal,
  buildReplaceProposal,
  ProposalError,
  type CreateProposal,
  type InsertProposal,
  type ReplaceProposal,
} from "../proposals";
import type {ToolDeps} from "./deps";
import {ToolError} from "./errors";
import {proposalTargetFor} from "./read";

/**
 * Propose-инструменты (Phase 8.2, D13): только создают proposal, буфер не
 * меняется. Любая неоднозначность (oldText/якорь не найдены или встречаются
 * не столько раз) — ошибка, а не «примерная» правка.
 */

function rethrowProposalError(error: unknown): never {
  if (error instanceof ProposalError) throw new ToolError(error.code, error.message);
  throw error;
}

export function proposeReplace(
  deps: ToolDeps,
  ids: SessionIds,
  args: {
    docId: string;
    oldText: string;
    newText: string;
    expectedCount: number;
    rationale?: string;
  },
): ReplaceProposal {
  const target = proposalTargetFor(deps, ids, args.docId);
  try {
    return buildReplaceProposal({
      target,
      oldText: args.oldText,
      newText: args.newText,
      expectedCount: args.expectedCount,
      rationale: args.rationale,
    });
  } catch (e) {
    return rethrowProposalError(e);
  }
}

export function proposeInsert(
  deps: ToolDeps,
  ids: SessionIds,
  args: {
    docId: string;
    anchor: string;
    position: "before" | "after";
    text: string;
    rationale?: string;
  },
): InsertProposal {
  const target = proposalTargetFor(deps, ids, args.docId);
  try {
    return buildInsertProposal({
      target,
      anchor: args.anchor,
      position: args.position,
      text: args.text,
      rationale: args.rationale,
    });
  } catch (e) {
    return rethrowProposalError(e);
  }
}

export interface CreateProposalArgs {
  rootId: string;
  relativePath: string;
  content: string;
  rationale?: string;
}

export async function proposeCreate(
  deps: ToolDeps,
  ids: SessionIds,
  args: CreateProposalArgs,
): Promise<CreateProposal> {
  const rootPath = ids.pathForRoot(args.rootId);
  if (!rootPath) throw new ToolError("unknown_root_id", "Неизвестный rootId");
  const root = deps
    .getRoots()
    .find((item) => normalizePath(item.path) === normalizePath(rootPath));
  if (!root) throw new ToolError("root_not_open", "Корень больше не открыт");

  let absolutePath: string;
  try {
    // Rust: канонизация родителя, symlink-выход, отсутствие файла, расширение.
    const target = await deps.validateCreateTarget(root.path, args.relativePath);
    absolutePath = target.absolutePath;
  } catch (e) {
    throw new ToolError("invalid_path", `Путь недопустим: ${String(e)}`);
  }
  if (await deps.fileExists(absolutePath)) {
    throw new ToolError("file_exists", "Файл уже существует — overwrite запрещён");
  }

  return buildCreateProposal({
    rootId: args.rootId,
    rootPath: root.path,
    relativePath: args.relativePath,
    absolutePath,
    content: args.content,
    rationale: args.rationale,
  });
}
