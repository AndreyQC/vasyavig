import {FINDING_RULES} from "../findings";

/**
 * Реестр инструментов ассистента (Phase 8.2).
 *
 * Здесь только объявления: имя, тир, схема. Реализации — read.ts/propose.ts.
 * `apply_proposal` — app-only: в model-реестр не попадает и вызывается только
 * из UI. Запрещённых инструментов (shell, generic FS, сеть) здесь нет
 * физически — это и есть запрет, а не строка в промпте.
 */

export type ToolTier = "read" | "propose" | "app";

export interface ToolParameter {
  type: "string" | "integer" | "boolean" | "array";
  description: string;
  enum?: readonly string[];
  items?: {type: "string"};
  minimum?: number;
  maximum?: number;
}

export interface ToolDefinition {
  name: string;
  tier: ToolTier;
  description: string;
  parameters: Record<string, ToolParameter>;
  required: readonly string[];
}

const ULID_DESCRIPTION =
  "ULID документа из harness-реестра (полный или уникальный префикс от 4 символов)";

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  get_active_document: {
    name: "get_active_document",
    tier: "read",
    description:
      "Активная вкладка: opaque docId, имя файла, markdown-текст (с лимитом), режим, dirty, ULID из реестра.",
    parameters: {},
    required: [],
  },
  get_selection: {
    name: "get_selection",
    tier: "read",
    description: "Текущее выделение активной вкладки: текст и позиции (без путей).",
    parameters: {},
    required: [],
  },
  list_open_documents: {
    name: "list_open_documents",
    tier: "read",
    description: "Открытые вкладки: docId, имя, тип, dirty. Максимум 50.",
    parameters: {},
    required: [],
  },
  list_workspace_roots: {
    name: "list_workspace_roots",
    tier: "read",
    description: "Корни workspace: opaque rootId, псевдоним/имя, признак harness. Максимум 20.",
    parameters: {},
    required: [],
  },
  get_document: {
    name: "get_document",
    tier: "read",
    description:
      "Документ harness-реестра по ULID: путь от корня репо, title, содержимое (с лимитом). Только реестр.",
    parameters: {
      ulid: {type: "string", description: ULID_DESCRIPTION},
    },
    required: ["ulid"],
  },
  search_documents: {
    name: "search_documents",
    tier: "read",
    description:
      "Лексический поиск по открытым вкладкам, реестру и файлам корней. Максимум 20 результатов, сниппет 200 символов.",
    parameters: {
      query: {type: "string", description: "Строка поиска (1..200 символов)"},
      rootId: {type: "string", description: "Ограничить поиск одним корнем (opaque rootId)"},
      limit: {type: "integer", description: "Максимум результатов (1..20, по умолчанию 10)"},
    },
    required: ["query"],
  },
  get_related_documents: {
    name: "get_related_documents",
    tier: "read",
    description:
      "Соседи документа по графу реестра: основания, порождённые, related. Максимум 50.",
    parameters: {
      ulid: {type: "string", description: ULID_DESCRIPTION},
    },
    required: ["ulid"],
  },
  list_tasks: {
    name: "list_tasks",
    tier: "read",
    description: "Задачи harness-репозиториев (task-yaml): статус, kind, assignee, приоритет. Максимум 100.",
    parameters: {
      status: {type: "string", description: "Канонический статус задачи"},
      assignee: {type: "string", description: "Исполнитель"},
      project: {type: "string", description: "Проект из реестра"},
    },
    required: [],
  },
  check_document: {
    name: "check_document",
    tier: "read",
    description:
      "Детерминированные проверки открытого документа: legacy-ссылки, якоря, TOC, конверт, картинки, custom-id.",
    parameters: {
      docId: {type: "string", description: "Opaque docId открытой markdown/text-вкладки"},
      rules: {
        type: "array",
        description: "Подмножество правил проверки",
        enum: FINDING_RULES,
        items: {type: "string"},
      },
    },
    required: ["docId"],
  },
  propose_replace: {
    name: "propose_replace",
    tier: "propose",
    description:
      "Предложить замену точного oldText на newText. Буфер не меняется; применяет пользователь после diff.",
    parameters: {
      docId: {type: "string", description: "Opaque docId открытой вкладки"},
      oldText: {type: "string", description: "Точный заменяемый текст (1..20000 символов)"},
      newText: {type: "string", description: "Новый текст; пустая строка — удаление фрагмента"},
      expectedCount: {
        type: "integer",
        description: "Ожидаемое число вхождений oldText (по умолчанию 1)",
      },
      rationale: {type: "string", description: "Короткое объяснение для пользователя"},
    },
    required: ["docId", "oldText", "newText"],
  },
  propose_insert: {
    name: "propose_insert",
    tier: "propose",
    description:
      "Предложить вставку блока до/после уникального якоря или в конец документа (anchor=end). Буфер не меняется.",
    parameters: {
      docId: {type: "string", description: "Opaque docId открытой вкладки"},
      anchor: {type: "string", description: "Точный уникальный якорь или строка end"},
      position: {type: "string", description: "before | after (по умолчанию after)", enum: ["before", "after"]},
      text: {type: "string", description: "Вставляемый текст"},
      rationale: {type: "string", description: "Короткое объяснение для пользователя"},
    },
    required: ["docId", "anchor", "text"],
  },
  propose_create: {
    name: "propose_create",
    tier: "propose",
    description:
      "Предложить создание документа в открытом корне. Путь относительный, только .md/.yfm/.txt, overwrite запрещён.",
    parameters: {
      rootId: {type: "string", description: "Opaque rootId из list_workspace_roots"},
      relativePath: {type: "string", description: "Путь внутри корня (posix или Windows-разделители)"},
      content: {type: "string", description: "Содержимое нового документа"},
      overwrite: {type: "boolean", description: "Не поддерживается: должно быть false/отсутствовать"},
      rationale: {type: "string", description: "Короткое объяснение для пользователя"},
    },
    required: ["rootId", "relativePath", "content"],
  },
  apply_proposal: {
    name: "apply_proposal",
    tier: "app",
    description:
      "Применить proposal после подтверждения пользователем. Только приложение; модель этот инструмент не вызывает.",
    parameters: {
      proposalId: {type: "string", description: "id предложения"},
    },
    required: ["proposalId"],
  },
};

/** Имена, которых в ассистенте нет и не будет (защита от регрессий). */
export const FORBIDDEN_TOOL_NAMES: readonly string[] = [
  "run_command",
  "shell",
  "exec",
  "read_file",
  "write_file",
  "list_dir",
  "delete_document",
  "rename_document",
  "move_document",
  "open_url",
  "http_request",
  "save_document",
  "create_directory",
  "delete_path",
  "rename_path",
];

/** Только тиры, доступные model-исполнителю (app-only исключён). */
export const MODEL_TOOL_NAMES: readonly string[] = Object.values(TOOL_DEFINITIONS)
  .filter((definition) => definition.tier !== "app")
  .map((definition) => definition.name);

export function toolDefinition(name: string): ToolDefinition | null {
  return TOOL_DEFINITIONS[name] ?? null;
}
