import {create} from "zustand";
import {recordAudit, type AuditOperation} from "../lib/agent/audit";
import {useFileStore} from "./fileStore";
import {
  deterministicFixFor,
  fixTargetFor,
  type ModelFixTarget,
} from "../lib/agent/fixes";
import type {Finding} from "../lib/agent/findings";
import {contentHash, countOccurrences} from "../lib/agent/hash";
import {resetSessionIds, sessionIds} from "../lib/agent/ids";
import {resolveRoot} from "../lib/roots";
import {getParentDir} from "../lib/utils";
import {isConfigFileName} from "../lib/agent/config";
import {
  buildEmailHtml,
} from "../lib/agent/email/template";
import {
  renderEmailBody,
  type EmailWarning,
} from "../lib/agent/email/render";
import type {ReadImageBytes} from "../lib/agent/email/images";
import {
  buildEmailMetaMessages,
  buildEmailRepairMessages,
  parseEmailMeta,
} from "../lib/agent/recipes/emailHtml";
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
import {maskText, maskingPromptNote} from "../lib/agent/masking/mask";
import {RunRegistry, type ExistingResolver} from "../lib/agent/masking/registry";
import type {EntityType} from "../lib/agent/masking/types";
import {parseEntityLinks} from "../lib/agent/masking/vasEntityMarkup";
import {applyDomainDictionary} from "../lib/agent/masking/ner";
import {ensureEntitiesIndex, matchEntityEntry} from "../lib/entitiesIndex";
import {ensureEntityTypes, systemTypeOfToken} from "../lib/entityTypes";
import {missingAliasIds, scanUnknownAliases, unmaskText} from "../lib/agent/masking/unmask";
import {cancelChatRun, runChat, type ChatMessage} from "../lib/agent/provider";
import {executeTool, type ToolCallResult} from "../lib/agent/tools";
import {defaultToolDeps, proposalApplyDeps} from "../lib/agent/tools/deps";
import {relativePathOf} from "../lib/agent/tools/read";
import type {CheckDocumentResult} from "../lib/agent/tools/read";
import {readFileLatin1} from "../hooks/useTauriFS";
import {currentSelection} from "./selectionStore";
import {useConfigStore} from "./configStore";
import {useEditorStore} from "./editorStore";

/**
 * Состояние прогонов ассистента (Phase 8.2/8.3/8.4): findings, proposals,
 * бюджет инструментов, последний error, результат «Письма HTML». Session-only;
 * содержимое документов здесь не дублируется — только findings/proposals,
 * которые строит приложение, и сгенерированное письмо.
 *
 * `runCheckDocument` — рецепт «Проверка документа» (8.3): детерминированные
 * findings -> детерминированные фиксы (без модели) -> модель -> строгий JSON
 * `{findingId, action, replacement?, rationale?}` -> proposals через
 * propose_* путь. Без модели/endpoint'а findings и локальные фиксы работают.
 *
 * `runEmailHtml` — рецепт «Письмо HTML» (8.4, §6.2): детерминированный рендер
 * тела (renderEmailBody), модель — только тема/preheader (строгий JSON,
 * repair-retry, fallback «тема = имя документа»). Это ЭКСПОРТ, не
 * write-инструмент: никаких propose_* и apply, документ не меняется. Вывод —
 * превью в HtmlViewer (preview-вкладка), сохранение/копирование — действия
 * пользователя в EmailResultCard.
 *
 * `applyProposalById` — app-only путь: UI подтверждает, модель сюда не ходит.
 */

export interface ModelNotice {
  kind: "info" | "error";
  /** Ключ i18n в assistant.modelStage.* / assistant.email.*; params переводит UI. */
  key: string;
  params?: Record<string, unknown>;
}

/** Итог «Письма HTML» (8.4). html session-only; на диск пишет пользователь. */
export interface EmailResult {
  docId: string;
  docName: string;
  /** Путь вкладки-источника (внутренняя связка, наружу не идёт). */
  docPath: string;
  /** Имя для диалога сохранения/preview-вкладки. */
  htmlFileName: string;
  subject: string;
  preheader: string;
  /** model — тема от модели; fallback — имя документа. */
  metaSource: "model" | "fallback";
  warnings: EmailWarning[];
  html: string;
  /** Путь preview-вкладки (виртуальный, kind html). */
  previewPath: string;
}

/** Сущность в превью отправки (T1b): алиас, тип и исходное значение. */
export interface MaskPreviewEntity {
  alias: string;
  type: EntityType;
  /** Исходное значение; только в памяти (D8), в audit не попадает. */
  value: string;
}

/**
 * Превью отправки (T1b): что именно уйдёт в модель в режиме `masking.mode:
 * preview`. Источник — уже собранные контекст-пак и сообщения: подтверждение
 * отправляет их без повторного маскирования («что показано — то и уйдёт»).
 */
export interface ModelStagePreview {
  docId: string;
  docPath: string;
  docName: string;
  /** Хэш контента на момент превью — защита от устаревшей отправки. */
  contentHash: string;
  /** Маскированный текст контекст-пака (после max_chars) — уйдёт в промпт. */
  maskedText: string;
  /** Символов контекста в промпте (документ + выделение). */
  promptChars: number;
  /** Контекст-пак обрезан по max_chars. */
  truncated: boolean;
  /** Документ включён в контекст настройками. */
  documentIncluded: boolean;
  entities: MaskPreviewEntity[];
  /** Счётчики по типам (без значений). */
  counts: Record<string, number>;
  /** Findings, по которым пойдёт модельная стадия. */
  findings: number;
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
  /** Превью отправки (T1b): маскированный контекст ждёт подтверждения. */
  maskPreview: ModelStagePreview | null;
  /** Валидированные вердикты модели последнего прогона. */
  verdicts: ModelVerdict[];
  proposals: Proposal[];
  toolCalls: ToolCallLog[];
  budget: ToolBudget;
  runId: string | null;
  applyingProposalId: string | null;
  lastError: string | null;
  /** Идёт сборка письма (8.4): рендер + модельная стадия темы. */
  emailRunning: boolean;
  emailResult: EmailResult | null;
  /** Итог сборки письма (i18n-ключ, без содержимого). */
  emailNotice: ModelNotice | null;

  runTool: (
    name: string,
    args: Record<string, unknown>,
    tier?: ModelTier,
    opts?: {modelId?: string | null},
  ) => Promise<ToolCallResult>;
  runCheckDocument: () => Promise<ToolCallResult>;
  cancelCheck: () => void;
  /** Подтвердить превью и отправить маскированный контекст модели (T1b). */
  confirmMaskedSend: () => Promise<void>;
  /** Отменить превью: модель не вызывается, документ не меняется (T1b). */
  cancelMaskedSend: () => void;
  /** Рецепт «Письмо HTML» (8.4): рендер + тема/preheader + превью. */
  runEmailHtml: () => Promise<void>;
  cancelEmail: () => void;
  applyProposalById: (proposalId: string) => Promise<ApplyResult>;
  rejectProposal: (proposalId: string) => void;
  clearProposal: (proposalId: string) => void;
  clearFindings: () => void;
  resetSession: () => void;
}

let toolCallSeq = 0;

/**
 * Подготовленная, но ещё не отправленная модельная стадия (T1b). Живёт только
 * в памяти: маскированный промпт и реестр значений не попадают ни в audit, ни
 * в React-состояние (D8); сбрасывается на confirm/cancel/reset.
 */
interface PendingModelStage {
  check: CheckDocumentResult;
  docId: string;
  docPath: string;
  /** Цели фиксов, построенные по исходному тексту (до маскирования). */
  targets: Map<string, ModelFixTarget>;
  registry: RunRegistry | null;
  messages: ChatMessage[];
  promptUserText: string;
  maskingMeta: {mode: "preview"; entities: number; counts: Record<string, number>} | null;
  /** Хэш исходного контента на момент превью. */
  contentHash: string;
}

let pendingStage: PendingModelStage | null = null;

/** Тема/preheader-fallback: имя документа без расширения. */
function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Байты картинки через latin1-чтение (байт = U+00XX); ошибка — null. */
const readImageFileBytes: ReadImageBytes = async (path) => {
  try {
    const text = await readFileLatin1(path);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
  } catch {
    return null;
  }
};

/** Виртуальный путь preview-вкладки письма: уникален на прогон, kind — html. */
function emailPreviewPath(docName: string): string {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `vasyavig-email-preview/${unique}/${baseName(docName)}.html`;
}

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
  maskPreview: null as ModelStagePreview | null,
  verdicts: [] as ModelVerdict[],
  proposals: [] as Proposal[],
  toolCalls: [] as ToolCallLog[],
  budget: createToolBudget(),
  runId: null as string | null,
  applyingProposalId: null as string | null,
  lastError: null as string | null,
  emailRunning: false,
  emailResult: null as EmailResult | null,
  emailNotice: null as ModelNotice | null,
};

export const useAgentStore = create<AgentState>((set, get) => {
  /**
   * Отправка подготовленной модельной стадии (T1b): модель -> строгий JSON ->
   * валидация масок -> unmask -> proposals. Вызывается сразу (режим off) или
   * после подтверждения превью (режим preview); повторного маскирования нет —
   * отправляются уже собранные сообщения.
   */
  const sendModelStage = async (
    pending: PendingModelStage,
    confirmation: "none" | "confirmed",
  ): Promise<void> => {
    set({modelRunning: true});
    const config = useConfigStore.getState();
    const model = config.models[config.selectedModel];
    const modelId = config.selectedModel;
    const requestConfig = config.config.llm.request;
    const runId = get().runId ?? undefined;
    const findingsMap = new Map(pending.check.findings.map((finding) => [finding.id, finding]));

    const auditModelStage = (result: "ok" | "error" | "cancelled") => {
      recordAudit(
        {
          operation: "run",
          result,
          model: modelId,
          runId,
          path: pending.check.path,
          findings: pending.check.findings.length,
          ...(pending.maskingMeta
            ? {
                masking: {
                  mode: pending.maskingMeta.mode,
                  confirmation,
                  entities: pending.maskingMeta.entities,
                  counts: pending.maskingMeta.counts,
                },
              }
            : {}),
        },
        auditOptions(),
      );
    };

    const finish = (notice: ModelNotice) => {
      set({modelRunning: false, modelNotice: notice});
    };

    if (!model) {
      // Модель убрали из конфига между превью и подтверждением.
      finish({kind: "error", key: "assistant.modelStage.noModel"});
      return;
    }

    const messages = pending.messages;

    try {
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

      // Валидация маскирования (§3.9 п.5): неизвестный алиас — модель
      // выдумала идентификатор, replacements могут нести мусор → все вердикты
      // отбрасываются. Потерянные алиасы — предупреждение, apply не блокируем:
      // replacement проверяется по oldText/baseHash независимо.
      const unknownAliases = pending.registry
        ? scanUnknownAliases(chat.text, pending.registry)
        : [];
      if (unknownAliases.length > 0) {
        auditModelStage("error");
        finish({
          kind: "error",
          key: "assistant.modelStage.maskUnknown",
          params: {count: unknownAliases.length},
        });
        return;
      }
      const activeRegistry = pending.registry;
      const verdicts = activeRegistry
        ? parsed.verdicts.map((verdict) => ({
            ...verdict,
            replacement:
              verdict.replacement !== undefined
                ? unmaskText(verdict.replacement, activeRegistry).text
                : undefined,
            rationale:
              verdict.rationale !== undefined
                ? unmaskText(verdict.rationale, activeRegistry).text
                : undefined,
          }))
        : parsed.verdicts;
      const lostAliases =
        pending.registry && pending.maskingMeta
          ? missingAliasIds(pending.promptUserText, chat.text, pending.registry).length
          : 0;

      let fixes = 0;
      let dropped = 0;
      let notes = 0;
      for (const verdict of verdicts) {
        if (verdict.rationale) notes++;
        if (verdict.action !== "fix" || verdict.replacement === undefined) continue;
        const target = pending.targets.get(verdict.findingId);
        if (!target) {
          dropped++;
          continue;
        }
        const proposalResult = await get().runTool(
          "propose_replace",
          {
            docId: pending.docId,
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

      set({verdicts});
      auditModelStage("ok");
      finish({
        kind: "info",
        key:
          lostAliases > 0 && verdicts.length > 0
            ? "assistant.modelStage.maskLost"
            : verdicts.length === 0
              ? "assistant.modelStage.empty"
              : dropped > 0
                ? "assistant.modelStage.okWithDropped"
                : "assistant.modelStage.ok",
        params: {fixes, notes, dropped, lost: lostAliases},
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

  /**
   * Подготовка модельной стадии рецепта 8.3 (T1b): findings -> маскирование ->
   * контекст-пак (D15) -> сообщения. В режиме `preview` дальше только превью и
   * подтверждение (модель не зовётся); в режиме `off` — немедленная отправка.
   * Маскирование: контекст уходит модели с алиасами `[[VAS_<TYPE>_<ULID>]]`
   * вместо секретов, unmask — в вердиктах; таблица соответствий — только в
   * памяти (D8), в audit — счётчики (R2).
   */
  const prepareModelStage = async (
    check: CheckDocumentResult,
    tab: {path: string; name: string; content: string},
    docId: string,
    proposedIds: ReadonlySet<string>,
  ): Promise<void> => {
    const config = useConfigStore.getState();
    const model = config.models[config.selectedModel];
    // Модель не настроена — модельной стадии нет (как и до T1b).
    if (!model) return;

    try {
      const maskingSettings = config.config.app.assistant.masking;
      const maskingOn = maskingSettings.mode !== "off";
      let registry: RunRegistry | null = null;
      let maskingMeta: PendingModelStage["maskingMeta"] = null;

      const targets = new Map<string, ModelFixTarget>();
      for (const finding of check.findings) {
        if (proposedIds.has(finding.id)) continue;
        const target = fixTargetFor(finding, tab.content);
        if (target) targets.set(finding.id, target);
      }

      const selection = currentSelection();
      let content = tab.content;
      let selectionInput =
        selection && selection.path === tab.path && selection.text !== ""
          ? {text: selection.text, from: selection.from, to: selection.to}
          : null;
      let maskingNote: string | undefined;
      if (maskingOn) {
        // T3 (план 20261105_001, T3-5): разметка `vas-entity:` даёт постоянные
        // ULID; значения без разметки сверяются со словарём identities
        // (entities.jsonl) — известное получает тот же ULID (связность между
        // документами), новое — per-run (R3). T3c: справочник типов и доменный
        // словарь NER — из harness.yaml (HY-5).
        const entitySpans = parseEntityLinks(tab.content);
        let resolver: ExistingResolver | undefined;
        try {
          await ensureEntityTypes(getParentDir(tab.path));
          applyDomainDictionary();
          const index = await ensureEntitiesIndex(getParentDir(tab.path));
          resolver = (value, type) => matchEntityEntry(index.entries, value, type)?.ulid ?? null;
        } catch {
          resolver = undefined; // индекс недоступен — только per-run ULID
        }
        registry = new RunRegistry(tab.content, resolver);
        for (const span of entitySpans) {
          const systemType = systemTypeOfToken(span.type);
          if (systemType != null) {
            registry.registerExisting(span.ulid, systemType, span.value);
          }
        }
        const maskDoc = maskText(tab.content, registry, maskingSettings.detectors, entitySpans);
        content = maskDoc.text;
        if (selectionInput) {
          const selSpans = parseEntityLinks(selectionInput.text);
          const maskSelection = maskText(
            selectionInput.text,
            registry,
            maskingSettings.detectors,
            selSpans,
          );
          selectionInput = {...selectionInput, text: maskSelection.text};
        }
        maskingNote = maskingPromptNote(registry) || undefined;
        maskingMeta = {
          mode: "preview",
          entities: registry.size,
          counts: Object.fromEntries(
            Object.entries(maskDoc.stats).filter(([, count]) => typeof count === "number"),
          ),
        };
      }
      const pack = buildContextPack({
        docId,
        name: tab.name,
        content,
        selection: selectionInput,
        settings: config.config.app.assistant.context,
      });
      const messages = buildCheckMessages({
        docName: tab.name,
        document: pack.document?.content ?? "(документ не включён в контекст настройками)",
        selection: pack.selection?.text ?? "",
        items: buildFindingItems(check.findings, targets, proposedIds),
        maskingNote,
      });

      const pending: PendingModelStage = {
        check,
        docId,
        docPath: tab.path,
        targets,
        registry,
        messages,
        promptUserText: messages[1]?.content ?? "",
        maskingMeta,
        contentHash: contentHash(tab.content),
      };

      if (maskingSettings.mode === "preview") {
        // T1b: без подтверждения пользователя модель не вызывается — даже
        // когда сущностей не найдено (превью показывает, что уйдёт).
        const activeRegistry = registry;
        pendingStage = pending;
        set({
          maskPreview: {
            docId,
            docPath: tab.path,
            docName: tab.name,
            contentHash: pending.contentHash,
            maskedText: pack.document?.content ?? "",
            promptChars: pack.totalChars,
            truncated: pack.document?.truncated === true || pack.selection?.truncated === true,
            documentIncluded: pack.document !== null,
            entities:
              activeRegistry === null
                ? []
                : activeRegistry.allRecords().map((record) => ({
                    alias: activeRegistry.aliasOf(record),
                    type: record.type,
                    value: record.value,
                  })),
            counts: maskingMeta?.counts ?? {},
            findings: check.findings.length,
          },
          modelNotice: null,
        });
        return;
      }

      return sendModelStage(pending, "none");
    } catch (e) {
      pendingStage = null;
      set({
        maskPreview: null,
        modelNotice: {
          kind: "error",
          key: "assistant.modelStage.error",
          params: {error: e instanceof Error ? e.message : String(e)},
        },
      });
      return Promise.resolve();
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
    if (get().checkRunning || get().emailRunning) {
      return {
        ok: false,
        name: "check_document",
        code: "already_running",
        error: "Прогон уже выполняется",
      };
    }

    // Новый прогон отменяет неподтверждённое превью предыдущего.
    pendingStage = null;
    set({checkRunning: true, lastError: null, modelNotice: null, verdicts: [], maskPreview: null});
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
      await prepareModelStage(
        check,
        {path: tab.path, name: tab.name, content: tab.content},
        docId,
        proposedIds,
      );
    }

    set({checkRunning: false, lastError: null});
    return result;
  },

  cancelCheck: () => {
    const runId = get().runId;
    if (runId) cancelChatRun(runId);
  },

  confirmMaskedSend: async () => {
    const pending = pendingStage;
    if (pending === null || get().modelRunning) return;
    // Превью устарело: вкладка закрыта/переключена или текст изменился после
    // показа — отправка не идёт, документ нужно проверить заново.
    const tab = useEditorStore.getState().tabs.find((item) => item.path === pending.docPath);
    if (!tab || contentHash(tab.content) !== pending.contentHash) {
      pendingStage = null;
      set({
        maskPreview: null,
        modelNotice: {kind: "error", key: "assistant.modelStage.previewStale"},
      });
      return;
    }
    pendingStage = null;
    set({maskPreview: null});
    await sendModelStage(pending, "confirmed");
  },

  cancelMaskedSend: () => {
    if (pendingStage === null) return;
    pendingStage = null;
    set({
      maskPreview: null,
      modelNotice: {kind: "info", key: "assistant.modelStage.previewCancelled"},
    });
  },

  /**
   * «Письмо HTML» (8.4, §6.2): детерминированный рендер тела, модель — только
   * тема/preheader (строгий JSON, один repair-retry), затем fallback «тема =
   * имя документа» с понятным notice. Экспорт, не write-инструмент: документ
   * не меняется, propose_* не вызываются; audit — только метаданные
   * (operation email_html, model/path/hash/result, без содержимого).
   */
  runEmailHtml: async () => {
    const editor = useEditorStore.getState();
    const tab = editor.tabs.find((item) => item.path === editor.activePath);
    if (!tab || (tab.kind !== "markdown" && tab.kind !== "text") || isConfigFileName(tab.path)) {
      set({lastError: "Активная вкладка не редактируется"});
      return;
    }
    if (get().emailRunning || get().checkRunning) return;

    set({emailRunning: true, emailResult: null, emailNotice: null, lastError: null});
    let runId = get().runId;
    if (!runId) {
      runId = `run-${Date.now().toString(36)}`;
      set({runId});
    }
    const docId = sessionIds().docId(tab.path);

    const auditEmail = (result: "ok" | "error" | "cancelled", model?: string) => {
      const deps = defaultToolDeps();
      recordAudit(
        {
          operation: "email_html",
          result,
          ...(model ? {model} : {}),
          runId,
          path: relativePathOf(tab.path, deps.getRoots(), deps.getHarnessIndexes()),
          hash: contentHash(tab.content),
        },
        auditOptions(),
      );
    };

    let usedModel: string | undefined;
    try {
      const roots = useFileStore.getState().roots;
      const body = await renderEmailBody({
        markdown: tab.content,
        basePath: getParentDir(tab.path),
        rootPath: resolveRoot(tab.path, roots)?.path ?? null,
        readImageBytes: readImageFileBytes,
      });

      // Модельная стадия: только тема и preheader; любой сбой — fallback.
      const config = useConfigStore.getState();
      const model = config.models[config.selectedModel] ?? null;
      let subject = baseName(tab.name);
      let preheader = "";
      let metaSource: "model" | "fallback" = "fallback";
      let notice: ModelNotice | null = null;
      usedModel = model ? config.selectedModel : undefined;

      if (model) {
        const pack = buildContextPack({
          docId,
          name: tab.name,
          content: tab.content,
          selection: null,
          settings: config.config.app.assistant.context,
        });
        const messages = buildEmailMetaMessages({
          docName: tab.name,
          document: pack.document?.content ?? "",
        });
        const ask = (msgs: readonly ChatMessage[]) =>
          runChat({
            model,
            requestConfig: config.config.llm.request,
            messages: [...msgs],
            jsonMode: true,
            stream: false,
            runId,
          });

        const chat = await ask(messages);
        if (!chat.ok) {
          if (chat.cancelled) {
            auditEmail("cancelled", usedModel);
            set({
              emailRunning: false,
              emailNotice: {kind: "info", key: "assistant.email.cancelled"},
            });
            return;
          }
          notice = {
            kind: "error",
            key: "assistant.email.sourceError",
            params: {error: chat.error ?? "модель недоступна"},
          };
        } else {
          let parsed = parseEmailMeta(chat.text);
          if (!parsed.ok) {
            // один repair-retry, затем fallback (§6.2, паттерн 8.3)
            const retry = await ask(buildEmailRepairMessages(messages, chat.text, parsed.errors));
            if (!retry.ok) {
              if (retry.cancelled) {
                auditEmail("cancelled", usedModel);
                set({
                  emailRunning: false,
                  emailNotice: {kind: "info", key: "assistant.email.cancelled"},
                });
                return;
              }
              notice = {
                kind: "error",
                key: "assistant.email.sourceError",
                params: {error: retry.error ?? "модель недоступна"},
              };
            } else {
              parsed = parseEmailMeta(retry.text);
            }
          }
          if (parsed.ok) {
            subject = parsed.meta.subject;
            preheader = parsed.meta.preheader;
            metaSource = "model";
          } else if (!notice) {
            notice = {
              kind: "info",
              key: "assistant.email.sourceInvalid",
              params: {errors: parsed.errors.slice(0, 3).join("; ")},
            };
          }
        }
      }

      const html = buildEmailHtml({subject, preheader, bodyHtml: body.html});
      const previewPath = emailPreviewPath(tab.name);
      // Превью в HtmlViewer: эфемерная preview-вкладка, документ не меняется.
      useEditorStore.getState().openTab(
        {path: previewPath, kind: "html", content: html},
        {preview: true},
      );
      set({
        emailRunning: false,
        emailResult: {
          docId,
          docName: tab.name,
          docPath: tab.path,
          htmlFileName: `${baseName(tab.name)}.html`,
          subject,
          preheader,
          metaSource,
          warnings: body.warnings,
          html,
          previewPath,
        },
        emailNotice:
          notice ??
          (metaSource === "model"
            ? {kind: "info", key: "assistant.email.sourceModel"}
            : {kind: "info", key: "assistant.email.sourceFallback"}),
        lastError: null,
      });
      auditEmail("ok", usedModel);
    } catch (e) {
      auditEmail("error", usedModel);
      set({
        emailRunning: false,
        emailNotice: {
          kind: "error",
          key: "assistant.email.renderError",
          params: {error: e instanceof Error ? e.message : String(e)},
        },
      });
    }
  },

  cancelEmail: () => {
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

  clearFindings: () => {
    pendingStage = null;
    set({
      findings: [],
      findingsDocId: null,
      findingsDocName: null,
      findingsAt: null,
      verdicts: [],
      modelNotice: null,
      maskPreview: null,
      lastError: null,
    });
  },

  resetSession: () => {
    resetSessionIds();
    pendingStage = null;
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
