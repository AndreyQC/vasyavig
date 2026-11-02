import {describe, expect, it} from "vitest";
import {parseDocument} from "yaml";
import {createConfigStore, type ConfigIo} from "./configStore";

const WS = "C:\\ws\\project.vasyavig-workspace";
const CONFIG_PATH = "C:\\ws\\vasyavig.yaml";

const BASE_CONFIG = `version: 1
unknown_top: keep
llm:
  default_model: fast
  models:
    fast:
      label: Fast
      base_url: https://llm.example/v1
      model: small
      api_key: crypto__TEST_ENV__abc
      capabilities:
        streaming: true
        json_mode: true
        tools: false
      data_scope: perimeter
    strong:
      label: Strong
      base_url: https://llm.example/v1
      model: large
      api_key: crypto__TEST_ENV__def
`;

function fakeIo(initial: Record<string, string> = {}) {
  const files = {...initial};
  const writes: Array<{path: string; content: string}> = [];
  const io: ConfigIo = {
    readFile: async (path) => {
      if (!(path in files)) {
        throw new Error(`cannot read ${path}: The system cannot find the file specified. (os error 2)`);
      }
      return files[path];
    },
    writeFile: async (path, content) => {
      files[path] = content;
      writes.push({path, content});
    },
  };
  return {io, files, writes};
}

function rawConfig(text: string): Record<string, unknown> {
  return parseDocument(text).toJS() as Record<string, unknown>;
}

describe("configStore loading", () => {
  it("loads models and default model from vasyavig.yaml next to workspace", async () => {
    const {io} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);

    await store.getState().loadForWorkspace(WS);

    const state = store.getState();
    expect(state.status).toBe("ready");
    expect(state.configPath).toBe(CONFIG_PATH);
    expect(Object.keys(state.models)).toEqual(["fast", "strong"]);
    expect(state.selectedModel).toBe("fast");
    expect(state.getSelectedModel()?.model).toBe("small");
    expect(state.writable).toBe(true);
  });

  it("uses defaults without a file and creates it on the first save", async () => {
    const {io, files, writes} = fakeIo();
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);

    expect(store.getState().status).toBe("missing");
    expect(store.getState().models).toEqual({});
    expect(store.getState().writable).toBe(true);

    const result = await store.getState().addModel("fast", {
      label: "Fast",
      baseUrl: "https://llm.example/v1",
      model: "small",
      apiKey: "crypto__TEST_ENV__abc",
      temperature: 0.2,
      maxTokens: 4096,
      contextLimit: 32000,
      timeoutMs: 60000,
      capabilities: {streaming: true, jsonMode: false, tools: false},
      dataScope: "perimeter",
    });

    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(files[CONFIG_PATH]).toContain("version: 1");
    expect(files[CONFIG_PATH]).toContain("default_model: fast");
    expect(store.getState().selectedModel).toBe("fast");
    expect(store.getState().status).toBe("ready");
  });

  it("does not overwrite an invalid config and stays on defaults", async () => {
    const invalid =
      "version: 1\nllm:\n  models:\n    m:\n      base_url: https://llm.example/v1\n      model: x\n      api_key: plain-secret\n";
    const {io, files, writes} = fakeIo({[CONFIG_PATH]: invalid});
    const store = createConfigStore(io);

    await store.getState().loadForWorkspace(WS);

    expect(store.getState().status).toBe("error");
    expect(store.getState().writable).toBe(false);
    expect(store.getState().error).toMatch(/api_key/);
    expect(files[CONFIG_PATH]).toBe(invalid);

    const result = await store.getState().addModel("m", {
      label: "M",
      baseUrl: "https://llm.example/v1",
      model: "x",
      apiKey: "",
      temperature: 0.2,
      maxTokens: 100,
      contextLimit: 1000,
      timeoutMs: 5000,
      capabilities: {streaming: true, jsonMode: false, tools: false},
      dataScope: "perimeter",
    });
    expect(result.ok).toBe(false);
    expect(writes).toHaveLength(0);
    expect(files[CONFIG_PATH]).toBe(invalid);
  });

  it("resets to defaults when the workspace is closed", async () => {
    const {io} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);
    await store.getState().loadForWorkspace(null);

    expect(store.getState().status).toBe("idle");
    expect(store.getState().configPath).toBeNull();
    expect(store.getState().models).toEqual({});
  });
});

describe("configStore model switching", () => {
  it("writes default_model while preserving unknown keys", async () => {
    const {io, files, writes} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);

    const result = await store.getState().setSelectedModel("strong");

    expect(result.ok).toBe(true);
    expect(store.getState().selectedModel).toBe("strong");
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(CONFIG_PATH);

    const raw = rawConfig(files[CONFIG_PATH]);
    const llm = raw.llm as Record<string, unknown>;
    expect(llm.default_model).toBe("strong");
    expect(raw.unknown_top).toBe("keep");
    expect((llm.models as Record<string, unknown>).fast).toBeTruthy();
  });

  it("ignores an unknown model id and does not write", async () => {
    const {io, writes} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);

    const result = await store.getState().setSelectedModel("missing");

    expect(result.ok).toBe(false);
    expect(store.getState().selectedModel).toBe("fast");
    expect(writes).toHaveLength(0);
  });

  it("keeps the in-memory choice but reports a write error", async () => {
    const {io} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const failing: ConfigIo = {
      readFile: io.readFile,
      writeFile: async () => {
        throw new Error("disk full");
      },
    };
    const store = createConfigStore(failing);
    await store.getState().loadForWorkspace(WS);

    const result = await store.getState().setSelectedModel("strong");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disk full/);
    expect(store.getState().selectedModel).toBe("strong");
    expect(store.getState().error).toMatch(/disk full/);
  });

  it("falls back to the first remaining model after removing the default", async () => {
    const {io} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);

    const result = await store.getState().removeModel("fast");

    expect(result.ok).toBe(true);
    expect(Object.keys(store.getState().models)).toEqual(["strong"]);
    expect(store.getState().selectedModel).toBe("strong");
  });

  it("addModel rejects a plain API key", async () => {
    const {io, writes} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);

    const result = await store.getState().addModel("plain", {
      label: "Plain",
      baseUrl: "https://llm.example/v1",
      model: "x",
      apiKey: "sk-plain",
      temperature: 0.2,
      maxTokens: 100,
      contextLimit: 1000,
      timeoutMs: 5000,
      capabilities: {streaming: true, jsonMode: false, tools: false},
      dataScope: "perimeter",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/api_key/);
    expect(writes).toHaveLength(0);
  });
});

describe("configStore reload", () => {
  it("picks up external edits on reload", async () => {
    const {io, files} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);

    files[CONFIG_PATH] = BASE_CONFIG.replace("default_model: fast", "default_model: strong");
    await store.getState().reload();

    expect(store.getState().selectedModel).toBe("strong");
  });

  it("keeps the last valid config if an external edit breaks the file", async () => {
    const {io, files} = fakeIo({[CONFIG_PATH]: BASE_CONFIG});
    const store = createConfigStore(io);
    await store.getState().loadForWorkspace(WS);

    files[CONFIG_PATH] = "version: 1\nllm: [broken";
    await store.getState().reload();

    expect(store.getState().status).toBe("error");
    expect(store.getState().writable).toBe(false);
    expect(Object.keys(store.getState().models)).toEqual(["fast", "strong"]);
  });
});
