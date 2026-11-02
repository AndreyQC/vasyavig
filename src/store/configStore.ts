import {create} from "zustand";
import {
  configPathForWorkspace,
  createDefaultConfig,
  parseConfig,
  serializeConfig,
  validateConfig,
  validateModelConfig,
  type AssistantSettings,
  type EditorSettings,
  type FilesSettings,
  type LlmModelConfig,
  type LlmRequestConfig,
  type VasyavigConfig,
} from "../lib/agent/config";

/**
 * Стор `vasyavig.yaml` (Phase 8.1): загрузка, список моделей, выбранная
 * модель, app-настройки, атомарная запись.
 *
 * - Источник правды — файл рядом с workspace; без файла — defaults в памяти,
 *   первый save создаёт файл.
 * - Невалидный/нечитаемый файл не перезаписывается: `writable=false`, UI
 *   показывает ошибку; последний валидный конфиг остаётся в памяти.
 * - Ошибка записи: изменение остаётся в памяти, пользователь видит ошибку.
 */

export type ConfigStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export interface ConfigIo {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

export interface AppSettingsPatch {
  editor?: Partial<EditorSettings>;
  files?: Partial<FilesSettings>;
  assistant?: Partial<Omit<AssistantSettings, "context" | "writes" | "masking" | "audit">> & {
    context?: Partial<AssistantSettings["context"]>;
    writes?: Partial<AssistantSettings["writes"]>;
    masking?: Partial<AssistantSettings["masking"]>;
    audit?: Partial<AssistantSettings["audit"]>;
  };
}

export interface ConfigState {
  config: VasyavigConfig;
  /** Путь `vasyavig.yaml`; null — workspace не открыт. */
  configPath: string | null;
  /** Последний валидный/записанный текст — база для сохранения неизвестных ключей. */
  rawText: string | null;
  /** Стабильная копия config.llm.models для селекторов (без новых объектов). */
  models: Record<string, LlmModelConfig>;
  /** Текущая модель = config.llm.defaultModel. */
  selectedModel: string;
  status: ConfigStatus;
  /** Можно ли писать файл: false при невалидном/нечитаемом конфиге. */
  writable: boolean;
  error: string | null;

  loadForWorkspace: (workspaceFilePath: string | null) => Promise<void>;
  reload: () => Promise<void>;
  setSelectedModel: (id: string) => Promise<SaveResult>;
  addModel: (id: string, model: LlmModelConfig) => Promise<SaveResult>;
  updateModel: (id: string, model: LlmModelConfig) => Promise<SaveResult>;
  removeModel: (id: string) => Promise<SaveResult>;
  updateRequest: (patch: Partial<LlmRequestConfig>) => Promise<SaveResult>;
  updateAppSettings: (patch: AppSettingsPatch) => Promise<SaveResult>;
  getSelectedModel: () => LlmModelConfig | null;
  clearError: () => void;
}

/** Windows/Linux сообщения «файла нет» из Rust `read_file` (os error 2/3). */
function isFileNotFound(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    /os error (2|3)\b/.test(message) ||
    message.includes("no such file") ||
    message.includes("cannot find the file") ||
    message.includes("не удается найти") ||
    message.includes("не может найти")
  );
}

function defaultIo(): ConfigIo {
  // Динамический импорт: модуль стора не тянет Tauri API в unit-тестах.
  return {
    readFile: async (path) => {
      const fs = await import("../hooks/useTauriFS");
      return fs.readFile(path);
    },
    writeFile: async (path, content) => {
      const fs = await import("../hooks/useTauriFS");
      return fs.writeFile(path, content);
    },
  };
}

function initialState(config: VasyavigConfig = createDefaultConfig()) {
  return {
    config,
    models: config.llm.models,
    selectedModel: config.llm.defaultModel,
  };
}

/**
 * Фабрика стора с инъекцией файлового IO — для тестов и для приложения.
 * Счётчик загрузок защищает от гонки при быстром переключении workspace.
 */
export function createConfigStore(io: ConfigIo = defaultIo()) {
  let loadSeq = 0;

  return create<ConfigState>((set, get) => {
    function applyMemory(next: VasyavigConfig): void {
      set({
        config: next,
        models: next.llm.models,
        selectedModel: next.llm.defaultModel,
      });
    }

    async function persist(next: VasyavigConfig): Promise<SaveResult> {
      try {
        validateConfig(next);
      } catch (e) {
        const error = String(e);
        set({error});
        return {ok: false, error};
      }

      const {configPath, rawText, writable} = get();
      if (!configPath) {
        // Workspace не открыт: выбор живёт только в памяти.
        applyMemory(next);
        const error = "Workspace не открыт: vasyavig.yaml некуда сохранить";
        set({error});
        return {ok: false, error};
      }
      if (!writable) {
        const error = "Конфиг невалиден или недоступен: запись заблокирована";
        set({error});
        return {ok: false, error};
      }

      let text: string;
      try {
        text = serializeConfig(next, rawText);
      } catch (e) {
        const error = String(e);
        set({error});
        return {ok: false, error};
      }

      try {
        await io.writeFile(configPath, text);
      } catch (e) {
        // Спека §4: при ошибке записи выбор остаётся в памяти.
        applyMemory(next);
        const error = `Не удалось записать ${configPath}: ${String(e)}`;
        set({error});
        return {ok: false, error};
      }

      set({
        ...initialState(next),
        rawText: text,
        status: "ready",
        writable: true,
        error: null,
      });
      return {ok: true};
    }

    async function load(configPath: string): Promise<void> {
      const seq = ++loadSeq;
      const sameWorkspace = get().configPath === configPath;
      set({status: "loading", configPath, error: null});

      let text: string;
      try {
        text = await io.readFile(configPath);
      } catch (e) {
        if (seq !== loadSeq) return;
        if (isFileNotFound(e)) {
          const config = createDefaultConfig();
          set({
            ...initialState(config),
            configPath,
            rawText: null,
            status: "missing",
            writable: true,
            error: null,
          });
          return;
        }
        const config = sameWorkspace ? get().config : createDefaultConfig();
        const error = `Не удалось прочитать ${configPath}: ${String(e)}`;
        set({
          ...initialState(config),
          configPath,
          rawText: sameWorkspace ? get().rawText : null,
          status: "error",
          writable: false,
          error,
        });
        return;
      }

      if (seq !== loadSeq) return;
      try {
        const config = parseConfig(text);
        set({
          ...initialState(config),
          configPath,
          rawText: text,
          status: "ready",
          writable: true,
          error: null,
        });
      } catch (e) {
        const config = sameWorkspace ? get().config : createDefaultConfig();
        set({
          ...initialState(config),
          configPath,
          rawText: text,
          status: "error",
          writable: false,
          error: `Ошибка конфига ${configPath}: ${String(e)}`,
        });
      }
    }

    return {
      ...initialState(),
      configPath: null,
      rawText: null,
      status: "idle",
      writable: false,
      error: null,

      loadForWorkspace: async (workspaceFilePath) => {
        if (!workspaceFilePath) {
          loadSeq++;
          const config = createDefaultConfig();
          set({
            ...initialState(config),
            configPath: null,
            rawText: null,
            status: "idle",
            writable: false,
            error: null,
          });
          return;
        }
        await load(configPathForWorkspace(workspaceFilePath));
      },

      reload: async () => {
        const {configPath} = get();
        if (!configPath) return;
        await load(configPath);
      },

      setSelectedModel: async (id) => {
        const {config} = get();
        if (!(id in config.llm.models)) {
          return {ok: false, error: `Модель "${id}" не найдена`};
        }
        if (config.llm.defaultModel === id) return {ok: true};
        return persist({...config, llm: {...config.llm, defaultModel: id}});
      },

      addModel: async (id, model) => {
        const trimmedId = id.trim();
        try {
          validateModelConfig(trimmedId, model);
        } catch (e) {
          return {ok: false, error: String(e)};
        }
        const {config} = get();
        if (trimmedId in config.llm.models) {
          return {ok: false, error: `Модель "${trimmedId}" уже существует`};
        }
        const models = {...config.llm.models, [trimmedId]: model};
        const defaultModel = config.llm.defaultModel || trimmedId;
        return persist({...config, llm: {...config.llm, models, defaultModel}});
      },

      updateModel: async (id, model) => {
        const trimmedId = id.trim();
        const {config} = get();
        if (!(trimmedId in config.llm.models)) {
          return {ok: false, error: `Модель "${trimmedId}" не найдена`};
        }
        try {
          validateModelConfig(trimmedId, model);
        } catch (e) {
          return {ok: false, error: String(e)};
        }
        const models = {...config.llm.models, [trimmedId]: model};
        return persist({...config, llm: {...config.llm, models}});
      },

      removeModel: async (id) => {
        const {config} = get();
        if (!(id in config.llm.models)) {
          return {ok: false, error: `Модель "${id}" не найдена`};
        }
        const models = {...config.llm.models};
        delete models[id];
        const defaultModel =
          config.llm.defaultModel === id
            ? (Object.keys(models)[0] ?? "")
            : config.llm.defaultModel;
        return persist({...config, llm: {...config.llm, models, defaultModel}});
      },

      updateRequest: async (patch) => {
        const {config} = get();
        return persist({
          ...config,
          llm: {...config.llm, request: {...config.llm.request, ...patch}},
        });
      },

      updateAppSettings: async (patch) => {
        const {config} = get();
        const assistant = patch.assistant;
        return persist({
          ...config,
          app: {
            editor: {...config.app.editor, ...patch.editor},
            files: {...config.app.files, ...patch.files},
            assistant: {
              ...config.app.assistant,
              ...(assistant
                ? {
                    ...assistant,
                    context: {...config.app.assistant.context, ...assistant.context},
                    writes: {...config.app.assistant.writes, ...assistant.writes},
                    masking: {...config.app.assistant.masking, ...assistant.masking},
                    audit: {...config.app.assistant.audit, ...assistant.audit},
                  }
                : {}),
            },
          },
        });
      },

      getSelectedModel: () => {
        const {config} = get();
        return config.llm.models[config.llm.defaultModel] ?? null;
      },

      clearError: () => set({error: null}),
    };
  });
}

export const useConfigStore = createConfigStore();
