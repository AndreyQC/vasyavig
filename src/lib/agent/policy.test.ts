import {describe, expect, it} from "vitest";
import {
  assertToolAllowed,
  chargeProposal,
  chargeResult,
  chargeToolCall,
  createToolBudget,
  DEFAULT_POLICY_LIMITS,
  isToolAllowed,
  normalizeCreateRelativePath,
  parseToolArgs,
  PolicyError,
  type PolicyLimits,
} from "./policy";
import {
  FORBIDDEN_TOOL_NAMES,
  MODEL_TOOL_NAMES,
  TOOL_DEFINITIONS,
} from "./tools/catalog";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof PolicyError ? e.code : "not-policy";
  }
  return "no-error";
}

describe("policy allowlist", () => {
  it("read-инструменты доступны в read-тире", () => {
    expect(isToolAllowed("get_active_document", "read")).toBe(true);
    expect(isToolAllowed("get_document", "read")).toBe(true);
    expect(isToolAllowed("check_document", "read")).toBe(true);
  });

  it("propose-инструменты запрещены в read-тире", () => {
    expect(isToolAllowed("propose_replace", "read")).toBe(false);
    expect(isToolAllowed("propose_insert", "read")).toBe(false);
    expect(isToolAllowed("propose_create", "read")).toBe(false);
    expect(codeOf(() => assertToolAllowed("propose_replace", "read"))).toBe("tier_denied");
  });

  it("propose-инструменты доступны в propose-тире", () => {
    expect(isToolAllowed("propose_replace", "propose")).toBe(true);
    expect(isToolAllowed("get_document", "propose")).toBe(true);
  });

  it("apply_proposal — app-only, моделью не вызывается", () => {
    expect(isToolAllowed("apply_proposal", "propose")).toBe(false);
    expect(isToolAllowed("apply_proposal", "read")).toBe(false);
    expect(codeOf(() => assertToolAllowed("apply_proposal", "propose"))).toBe("app_only_tool");
    expect(MODEL_TOOL_NAMES).not.toContain("apply_proposal");
  });

  it("неизвестный инструмент отклоняется", () => {
    expect(isToolAllowed("get_everything", "propose")).toBe(false);
    expect(codeOf(() => assertToolAllowed("get_everything", "propose"))).toBe("unknown_tool");
  });

  it("запрещённые имена отсутствуют в каталоге и model-реестре", () => {
    for (const name of FORBIDDEN_TOOL_NAMES) {
      expect(TOOL_DEFINITIONS[name]).toBeUndefined();
      expect(MODEL_TOOL_NAMES).not.toContain(name);
    }
  });

  it("в model-реестре только read/propose, у всех есть схема", () => {
    expect(MODEL_TOOL_NAMES).toHaveLength(12);
    for (const name of MODEL_TOOL_NAMES) {
      const definition = TOOL_DEFINITIONS[name];
      expect(definition).toBeTruthy();
      expect(["read", "propose"]).toContain(definition.tier);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });
});

describe("policy argument validation", () => {
  it("отклоняет неизвестные аргументы", () => {
    expect(
      codeOf(() =>
        parseToolArgs("get_active_document", {path: "C:/secret.txt"}),
      ),
    ).toBe("unknown_argument");
  });

  it("проверяет opaque docId/rootId/proposalId", () => {
    expect(codeOf(() => parseToolArgs("get_document", {docId: "doc-1"}))).toBe("unknown_argument");
    expect(
      codeOf(() =>
        parseToolArgs("propose_replace", {docId: "C:/ws/a.md", oldText: "a", newText: "b"}),
      ),
    ).toBe("invalid_argument");
    expect(
      codeOf(() =>
        parseToolArgs("propose_create", {rootId: "ws", relativePath: "a.md", content: ""}),
      ),
    ).toBe("invalid_argument");
  });

  it("нормализует и валидирует ULID", () => {
    const parsed = parseToolArgs("get_document", {ulid: "01jg2s4h6k"});
    expect(parsed.ulid).toBe("01JG2S4H6K");
    expect(codeOf(() => parseToolArgs("get_document", {ulid: "bad-ulid!"}))).toBe(
      "invalid_argument",
    );
  });

  it("требует непустой oldText и разрешает пустой newText", () => {
    expect(
      codeOf(() =>
        parseToolArgs("propose_replace", {docId: "doc-1", oldText: " ", newText: "x"}),
      ),
    ).toBe("invalid_argument");
    const parsed = parseToolArgs("propose_replace", {
      docId: "doc-1",
      oldText: "a",
      newText: "",
    });
    expect(parsed).toMatchObject({expectedCount: 1, newText: ""});
  });

  it("expectedCount в диапазоне 1..100", () => {
    expect(
      codeOf(() =>
        parseToolArgs("propose_replace", {
          docId: "doc-1",
          oldText: "a",
          newText: "b",
          expectedCount: 0,
        }),
      ),
    ).toBe("invalid_argument");
    expect(
      codeOf(() =>
        parseToolArgs("propose_replace", {
          docId: "doc-1",
          oldText: "a",
          newText: "b",
          expectedCount: 101,
        }),
      ),
    ).toBe("invalid_argument");
  });

  it("проверяет position и непустой text вставки", () => {
    expect(
      codeOf(() =>
        parseToolArgs("propose_insert", {
          docId: "doc-1",
          anchor: "end",
          text: "x",
          position: "middle",
        }),
      ),
    ).toBe("invalid_argument");
    expect(
      codeOf(() => parseToolArgs("propose_insert", {docId: "doc-1", anchor: "end", text: ""})),
    ).toBe("invalid_argument");
    const parsed = parseToolArgs("propose_insert", {
      docId: "doc-1",
      anchor: "end",
      text: "x",
    });
    expect(parsed.position).toBe("after");
  });

  it("проверяет правила check_document", () => {
    expect(
      codeOf(() => parseToolArgs("check_document", {docId: "doc-1", rules: ["nope"]})),
    ).toBe("invalid_argument");
    expect(codeOf(() => parseToolArgs("check_document", {docId: "doc-1", rules: []}))).toBe(
      "invalid_argument",
    );
    expect(parseToolArgs("check_document", {docId: "doc-1", rules: ["links"]})).toEqual({
      docId: "doc-1",
      rules: ["links"],
    });
  });

  it("ограничивает search limit и пустой query", () => {
    expect(codeOf(() => parseToolArgs("search_documents", {query: "  "}))).toBe(
      "invalid_argument",
    );
    expect(
      codeOf(() => parseToolArgs("search_documents", {query: "x", limit: 21})),
    ).toBe("invalid_argument");
    expect(parseToolArgs("search_documents", {query: "x"})).toMatchObject({limit: 10});
  });
});

describe("create path policy", () => {
  it("нормализует разделители и вложенные пути", () => {
    expect(normalizeCreateRelativePath("docs\\sub\\a.md")).toBe("docs/sub/a.md");
    expect(normalizeCreateRelativePath("a.yfm")).toBe("a.yfm");
    expect(normalizeCreateRelativePath(" notes/task.txt ")).toBe("notes/task.txt");
  });

  it("запрещает traversal, абсолютные пути и пустые сегменты", () => {
    for (const bad of [
      "../a.md",
      "docs/../a.md",
      "docs/./a.md",
      "docs//a.md",
      "/etc/a.md",
      "C:\\ws\\a.md",
      "\\\\server\\share\\a.md",
      "",
    ]) {
      expect(codeOf(() => normalizeCreateRelativePath(bad)), bad).toBe("invalid_path");
    }
  });

  it("разрешает только .md/.yfm/.txt и не-Windows-reserved имена", () => {
    for (const bad of ["a.exe", "a", ".md", "docs/con.md", "docs/COM1.txt", "a.md:stream"]) {
      expect(
        ["invalid_path", "invalid_extension"],
        bad,
      ).toContain(codeOf(() => normalizeCreateRelativePath(bad)));
    }
  });

  it("overwrite=true отклоняется", () => {
    expect(
      codeOf(() =>
        parseToolArgs("propose_create", {
          rootId: "root-1",
          relativePath: "a.md",
          content: "x",
          overwrite: true,
        }),
      ),
    ).toBe("overwrite_forbidden");
  });
});

describe("policy budgets", () => {
  const limits: PolicyLimits = {...DEFAULT_POLICY_LIMITS, maxToolCallsPerRun: 1};

  it("считает вызовы инструментов", () => {
    const budget = createToolBudget();
    chargeToolCall(budget, limits);
    expect(budget.calls).toBe(1);
    expect(codeOf(() => chargeToolCall(budget, limits))).toBe("budget_exceeded");
  });

  it("считает суммарный размер результатов", () => {
    const budget = createToolBudget();
    const small: PolicyLimits = {...DEFAULT_POLICY_LIMITS, maxResultChars: 10};
    chargeResult(budget, 6, small);
    expect(codeOf(() => chargeResult(budget, 6, small))).toBe("budget_exceeded");
    expect(budget.resultChars).toBe(12);
  });

  it("ограничивает одно предложение и его размер", () => {
    const budget = createToolBudget();
    const one: PolicyLimits = {...DEFAULT_POLICY_LIMITS, maxProposalsPerRun: 1};
    chargeProposal(budget, 10, one);
    expect(codeOf(() => chargeProposal(budget, 10, one))).toBe("budget_exceeded");
    const tiny: PolicyLimits = {...DEFAULT_POLICY_LIMITS, maxProposalContentChars: 5};
    expect(codeOf(() => chargeProposal(createToolBudget(), 6, tiny))).toBe("content_too_large");
  });
});
