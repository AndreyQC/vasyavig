import {describe, expect, it} from "vitest";
import {parseDocument} from "yaml";
import {
  CONFIG_FILE_NAME,
  ConfigError,
  configPathForWorkspace,
  createDefaultConfig,
  isConfigFileName,
  isCryptoToken,
  parseConfig,
  parseCryptoToken,
  serializeConfig,
  validateConfig,
  validateModelConfig,
  type LlmModelConfig,
} from "./config";

const CRYPTO_KEY = "crypto__VASYAVIG_LLM_KEY__gAAAAABsample";

const FULL_YAML = `
# комментарий должен пережить запись известных ключей
version: 1
custom_top:
  keep: me
llm:
  default_model: fast
  custom_llm: keep
  request:
    timeout_ms: 45000
    retries: 1
    retry_backoff_ms: 250
  models:
    fast:
      label: "Быстрая"
      base_url: "https://llm.perimeter.example/v1"
      model: "qwen2.5-7b-instruct"
      api_key: "${CRYPTO_KEY}"
      temperature: 0.15
      max_tokens: 2048
      context_limit: 16000
      timeout_ms: 30000
      capabilities:
        streaming: true
        json_mode: true
        tools: false
      data_scope: perimeter
      custom_model: keep
    strong:
      base_url: "https://llm.perimeter.example/v1/"
      model: "qwen2.5-72b-instruct"
      api_key: ""
app:
  custom_app: keep
  editor:
    spellcheck: en
    custom_editor: keep
  files:
    hidden: true
  assistant:
    enabled: false
    context:
      include_document: false
      include_selection: true
      max_chars: 5000
      chunking: none
    writes:
      require_confirmation: true
    masking:
      mode: preview
      detectors: [email, phone]
    audit:
      enabled: false
      retain_runs: 7
`;

function parseYaml(text: string): Record<string, unknown> {
  return parseDocument(text).toJS() as Record<string, unknown>;
}

describe("config defaults", () => {
  it("returns defaults for an empty document", () => {
    const config = parseConfig("");
    expect(config.version).toBe(1);
    expect(config.llm.models).toEqual({});
    expect(config.llm.defaultModel).toBe("");
    expect(config.llm.request).toEqual({timeoutMs: 60000, retries: 2, retryBackoffMs: 500});
    expect(config.app.editor).toEqual({spellcheck: "ru+en", defaultMode: "wysiwyg", fontSize: 14});
    expect(config.app.assistant.masking).toEqual({
      mode: "off",
      detectors: ["secrets", "email", "phone"],
    });
  });

  it("fills optional model fields with defaults and labels the model by id", () => {
    const config = parseConfig(`
version: 1
llm:
  models:
    minimal:
      base_url: https://example.test/v1
      model: test-model
`);
    const model = config.llm.models.minimal;
    expect(config.llm.defaultModel).toBe("minimal");
    expect(model.label).toBe("minimal");
    expect(model.apiKey).toBe("");
    expect(model.temperature).toBe(0.2);
    expect(model.maxTokens).toBe(4096);
    expect(model.contextLimit).toBe(32000);
    expect(model.timeoutMs).toBe(60000);
    expect(model.capabilities).toEqual({streaming: true, jsonMode: false, tools: false});
    expect(model.dataScope).toBe("perimeter");
  });
});

describe("config parsing", () => {
  it("parses full YAML including crypto keys and capabilities", () => {
    const config = parseConfig(FULL_YAML);
    expect(config.llm.defaultModel).toBe("fast");
    expect(config.llm.request).toEqual({timeoutMs: 45000, retries: 1, retryBackoffMs: 250});
    expect(config.llm.models.fast).toMatchObject({
      label: "Быстрая",
      baseUrl: "https://llm.perimeter.example/v1",
      model: "qwen2.5-7b-instruct",
      apiKey: CRYPTO_KEY,
      temperature: 0.15,
      maxTokens: 2048,
      contextLimit: 16000,
      timeoutMs: 30000,
      capabilities: {streaming: true, jsonMode: true, tools: false},
      dataScope: "perimeter",
    });
    expect(config.llm.models.strong.label).toBe("strong");
    expect(config.llm.models.strong.apiKey).toBe("");
    expect(config.app.editor.spellcheck).toBe("en");
    expect(config.app.files.hidden).toBe(true);
    expect(config.app.assistant.enabled).toBe(false);
    expect(config.app.assistant.context).toEqual({
      includeDocument: false,
      includeSelection: true,
      maxChars: 5000,
      chunking: "none",
    });
    expect(config.app.assistant.masking.detectors).toEqual(["email", "phone"]);
    expect(config.app.assistant.audit).toEqual({enabled: false, retainRuns: 7});
  });

  it("recognizes crypto tokens and extracts the env name", () => {
    expect(isCryptoToken(CRYPTO_KEY)).toBe(true);
    expect(isCryptoToken("sk-plain")).toBe(false);
    expect(isCryptoToken("crypto__ENV__")).toBe(false);
    expect(parseCryptoToken(CRYPTO_KEY)).toEqual({
      env: "VASYAVIG_LLM_KEY",
      ciphertext: "gAAAAABsample",
    });
    expect(parseCryptoToken("plain")).toBeNull();
  });
});

describe("config validation", () => {
  it("rejects plain API keys", () => {
    expect(() =>
      parseConfig(`
version: 1
llm:
  models:
    m:
      base_url: https://example.test/v1
      model: test
      api_key: sk-plain-secret
`),
    ).toThrow(/api_key/);
  });

  it("rejects invalid scalar values with the failing path", () => {
    expect(() =>
      parseConfig(`
version: 1
llm:
  models:
    m:
      base_url: https://example.test/v1
      model: test
      temperature: 3
`),
    ).toThrow(/llm\.models\.m\.temperature/);

    expect(() =>
      parseConfig(`
version: 1
llm:
  default_model: missing
  models:
    m:
      base_url: https://example.test/v1
      model: test
`),
    ).toThrow(/default_model/);

    expect(() => parseConfig("version: 2\n")).toThrow(/version/);
    expect(() =>
      parseConfig(`
version: 1
llm:
  models:
    m:
      base_url: ftp://example.test/v1
      model: test
`),
    ).toThrow(/base_url/);

    expect(() =>
      parseConfig(`
version: 1
app:
  assistant:
    masking:
      detectors: [email, dna]
`),
    ).toThrow(/detectors/);
  });

  it("rejects malformed YAML and duplicate keys", () => {
    expect(() => parseConfig("llm: [unclosed")).toThrow(ConfigError);
    expect(() => parseConfig("version: 1\nversion: 1\n")).toThrow(/YAML/);
  });

  it("validates a typed model independently (form path)", () => {
    const model: LlmModelConfig = {
      label: "M",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "plain",
      temperature: 0.1,
      maxTokens: 100,
      contextLimit: 1000,
      timeoutMs: 5000,
      capabilities: {streaming: true, jsonMode: false, tools: false},
      dataScope: "perimeter",
    };
    expect(() => validateModelConfig("m", model)).toThrow(/api_key/);
    expect(() => validateModelConfig("", {...model, apiKey: ""})).toThrow(/id/);
    expect(() => validateModelConfig("m", {...model, apiKey: "", maxTokens: 0})).toThrow(
      /max_tokens/,
    );
    expect(() => validateModelConfig("m", {...model, apiKey: ""})).not.toThrow();
  });
});

describe("config serialization", () => {
  it("preserves unknown sections and keys while updating known values", () => {
    const config = parseConfig(FULL_YAML);
    config.app.assistant.audit.retainRuns = 99;
    config.llm.models.fast.temperature = 0.5;

    const text = serializeConfig(config, FULL_YAML);
    expect(text).toContain("# комментарий");
    const raw = parseYaml(text);

    expect(raw.custom_top).toEqual({keep: "me"});
    const llm = raw.llm as Record<string, unknown>;
    expect(llm.custom_llm).toBe("keep");
    const models = llm.models as Record<string, Record<string, unknown>>;
    expect(models.fast.custom_model).toBe("keep");
    expect(models.fast.temperature).toBe(0.5);
    const app = raw.app as Record<string, unknown>;
    expect(app.custom_app).toBe("keep");
    const editor = app.editor as Record<string, unknown>;
    expect(editor.custom_editor).toBe("keep");
    expect(editor.spellcheck).toBe("en");
    const assistant = app.assistant as Record<string, unknown>;
    const audit = assistant.audit as Record<string, unknown>;
    expect(audit.retain_runs).toBe(99);
  });

  it("round-trips through parse without losing known values", () => {
    const config = parseConfig(FULL_YAML);
    const roundTripped = parseConfig(serializeConfig(config, FULL_YAML));
    expect(roundTripped).toEqual(config);
  });

  it("writes a complete file from defaults", () => {
    const config = createDefaultConfig();
    const text = serializeConfig(config);
    expect(text).toContain("version: 1");
    expect(text).toContain("default_model:");
    expect(text).toContain("assistant:");
    expect(text).toContain("retry_backoff_ms:");
    expect(parseConfig(text)).toEqual(config);
  });

  it("removes models deleted in the UI but keeps unknown model keys", () => {
    const config = parseConfig(FULL_YAML);
    delete config.llm.models.strong;
    config.llm.defaultModel = "fast";

    const raw = parseYaml(serializeConfig(config, FULL_YAML));
    const models = (raw.llm as Record<string, unknown>).models as Record<string, unknown>;
    expect(Object.keys(models)).toEqual(["fast"]);
    expect((models.fast as Record<string, unknown>).custom_model).toBe("keep");
  });

  it("refuses to serialize an invalid typed config", () => {
    const config = createDefaultConfig();
    config.llm.models.bad = {
      label: "bad",
      baseUrl: "not a url",
      model: "m",
      apiKey: "",
      temperature: 0.2,
      maxTokens: 1,
      contextLimit: 1,
      timeoutMs: 1000,
      capabilities: {streaming: true, jsonMode: false, tools: false},
      dataScope: "perimeter",
    };
    expect(() => validateConfig(config)).toThrow(/base_url/);
    expect(() => serializeConfig(config)).toThrow(/base_url/);
  });
});

describe("config path helpers", () => {
  it("puts vasyavig.yaml next to the workspace file", () => {
    expect(configPathForWorkspace("C:\\work\\project.vasyavig-workspace")).toBe(
      "C:\\work\\vasyavig.yaml",
    );
    expect(configPathForWorkspace("/home/user/project.vasyavig-workspace")).toBe(
      "/home/user/vasyavig.yaml",
    );
  });

  it("recognizes the config file name for read-only mode", () => {
    expect(isConfigFileName("C:\\work\\vasyavig.yaml")).toBe(true);
    expect(isConfigFileName("C:\\work\\VASYAVIG.YML")).toBe(true);
    expect(isConfigFileName("C:\\work\\other.yaml")).toBe(false);
    expect(CONFIG_FILE_NAME).toBe("vasyavig.yaml");
  });
});
