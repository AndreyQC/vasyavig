import {describe, expect, it} from "vitest";
import {
  AUDIT_STORAGE_KEY,
  AuditLog,
  createMemoryAuditStorage,
} from "./audit";

describe("AuditLog", () => {
  it("пишет только метаданные и не сохраняет содержимое", () => {
    const storage = createMemoryAuditStorage();
    const log = new AuditLog(storage, () => 1000);

    log.record(
      {
        operation: "propose_replace",
        result: "proposed",
        model: "minimax-m2",
        docId: "doc-1",
        path: "docs/a.md",
        hash: "abc123",
        proposalKind: "replace",
        // лишние поля не должны попасть в запись
        content: "SECRET CONTENT",
        oldText: "SECRET OLD",
      } as Parameters<AuditLog["record"]>[0],
      {enabled: true, retainRuns: 10},
    );

    const [entry] = log.list();
    expect(entry).toMatchObject({
      operation: "propose_replace",
      result: "proposed",
      model: "minimax-m2",
      docId: "doc-1",
      path: "docs/a.md",
      hash: "abc123",
      proposalKind: "replace",
    });
    expect(entry.timestamp).toBe(new Date(1000).toISOString());
    const raw = storage.value ?? "";
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain("content");
    expect(raw).not.toContain("oldText");
  });

  it("держит retention в пределах retainRuns", () => {
    const storage = createMemoryAuditStorage();
    const log = new AuditLog(storage, () => 1000);
    for (let i = 0; i < 5; i++) {
      log.record(
        {operation: "check_document", result: "ok", findings: i},
        {enabled: true, retainRuns: 2},
      );
    }
    expect(log.list()).toHaveLength(2);
    expect(log.list().map((entry) => entry.findings)).toEqual([3, 4]);
  });

  it("disabled не пишет, clear удаляет", () => {
    const storage = createMemoryAuditStorage();
    const log = new AuditLog(storage, () => 1000);
    log.record({operation: "check_document", result: "ok"}, {enabled: false});
    expect(log.list()).toHaveLength(0);
    expect(storage.value).toBeNull();

    log.record({operation: "check_document", result: "ok"}, {enabled: true});
    expect(storage.getItem(AUDIT_STORAGE_KEY)).toBeTruthy();
    log.clear();
    expect(log.list()).toHaveLength(0);
  });

  it("битый JSON не роняет чтение", () => {
    const storage = createMemoryAuditStorage("{not-json");
    const log = new AuditLog(storage, () => 1000);
    expect(log.list()).toEqual([]);
  });

  it("без storage работает как no-op", () => {
    const log = new AuditLog(null, () => 1000);
    expect(log.record({operation: "run", result: "ok"})).toBeNull();
    expect(log.list()).toEqual([]);
  });
});
