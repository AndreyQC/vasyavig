import {beforeEach, describe, expect, it} from "vitest";
import {
  buildDocumentGraph,
  buildForest,
  hasLinks,
  listProjects,
  listTypes,
  neighborsOf,
  type DocumentGraph,
} from "./harnessGraph";
import type {HarnessIndexEntry} from "./harnessIndex";

const entry = (over: Partial<HarnessIndexEntry> & {ulid: string; path: string}): HarnessIndexEntry => ({
  title: undefined,
  type: undefined,
  related: [],
  basedOn: [],
  ...over,
});

/**
 * План -> result (основание/порождённый), plan <-> plan (related в одну
 * сторону), изолированный документ.
 */
function fixture(): HarnessIndexEntry[] {
  return [
    entry({ulid: "PLAN", path: "_docs_/_plans_/a.md", title: "План A", type: "plan", related: ["RES"]}),
    entry({
      ulid: "RES",
      path: "_docs_/_tasks_/a_result.md",
      title: "Результат A",
      type: "result",
      basedOn: ["PLAN"],
    }),
    entry({ulid: "PLAN2", path: "_docs_/_plans_/b.md", title: "План B", type: "plan"}),
    entry({ulid: "ISO", path: "docs/iso.md", title: "", type: "doc"}),
  ];
}

describe("buildDocumentGraph", () => {
  it("узлы: заголовок из реестра, запасной — имя файла", () => {
    const graph = buildDocumentGraph(fixture());
    expect(graph.nodes.PLAN.title).toBe("План A");
    expect(graph.nodes.ISO.title).toBe("iso.md"); // заголовка нет — имя файла
    expect(graph.nodes.ISO.type).toBe("doc");
    expect(Object.keys(graph.nodes)).toHaveLength(4);
  });

  it("обратный `based_on`: основание -> порождённые и наоборот (D3)", () => {
    const graph = buildDocumentGraph(fixture());
    expect(graph.parentsByChild.RES).toEqual(["PLAN"]);
    expect(graph.childrenByParent.PLAN).toEqual(["RES"]);
    expect(graph.childrenByParent.RES).toBeUndefined();
  });

  it("`related` симметричен, направление помечено (D4)", () => {
    const graph = buildDocumentGraph(fixture());
    // A -> B записано только у PLAN: у PLAN связь «прямая», у RES — «обратная»
    expect(graph.relatedByNode.PLAN).toEqual([{ulid: "RES", direction: "out"}]);
    expect(graph.relatedByNode.RES).toEqual([{ulid: "PLAN", direction: "in"}]);
  });

  it("взаимная запись `related` помечается как «both»", () => {
    const graph = buildDocumentGraph([
      entry({ulid: "A", path: "a.md", related: ["B"]}),
      entry({ulid: "B", path: "b.md", related: ["A"]}),
    ]);
    expect(graph.relatedByNode.A).toEqual([{ulid: "B", direction: "both"}]);
    expect(graph.relatedByNode.B).toEqual([{ulid: "A", direction: "both"}]);
  });

  it("битые ULID рёбрами не становятся", () => {
    const graph = buildDocumentGraph([
      entry({ulid: "A", path: "a.md", basedOn: ["NOPE"], related: ["NOPE"]}),
    ]);
    expect(graph.parentsByChild.A).toBeUndefined();
    expect(graph.childrenByParent.NOPE).toBeUndefined();
    expect(graph.relatedByNode.A).toBeUndefined();
    expect(graph.relatedByNode.NOPE).toBeUndefined();
  });

  it("ссылка на себя игнорируется (нет петель)", () => {
    const graph = buildDocumentGraph([entry({ulid: "A", path: "a.md", basedOn: ["A"], related: ["A"]})]);
    expect(graph.parentsByChild.A).toBeUndefined();
    expect(graph.relatedByNode.A).toBeUndefined();
  });

  it("поиск по пути реестра", () => {
    const graph = buildDocumentGraph(fixture());
    expect(graph.byPath["_docs_/_plans_/a.md"]).toBe("PLAN");
  });
});

describe("hasLinks", () => {
  it("изолированный документ без связей", () => {
    const graph = buildDocumentGraph(fixture());
    expect(hasLinks(graph, "ISO")).toBe(false);
    expect(hasLinks(graph, "PLAN")).toBe(true); // related + порождённый
    expect(hasLinks(graph, "RES")).toBe(true);
  });
});

describe("neighborsOf", () => {
  let graph: DocumentGraph;
  beforeEach(() => {
    graph = buildDocumentGraph(fixture());
  });

  it("окрестность: основания, порождённые, связанные", () => {
    const around = neighborsOf(graph, "RES");
    expect(around.bases.map((n) => n.ulid)).toEqual(["PLAN"]);
    expect(around.children).toEqual([]);
    expect(around.related.map((r) => [r.node.ulid, r.direction])).toEqual([["PLAN", "in"]]);
  });

  it("окрестность основания: порождённые видны, оснований нет", () => {
    const around = neighborsOf(graph, "PLAN");
    expect(around.bases).toEqual([]);
    expect(around.children.map((n) => n.ulid)).toEqual(["RES"]);
  });

  it("неизвестный ULID — пустая окрестность", () => {
    expect(neighborsOf(graph, "NOPE")).toEqual({bases: [], children: [], related: []});
  });
});

describe("buildForest", () => {
  it("лес: корень — документ без видимого основания", () => {
    const graph = buildDocumentGraph(fixture());
    const forest = buildForest(graph);
    const roots = forest.map((t) => t.node.ulid);
    expect(roots).toContain("PLAN");
    expect(roots).toContain("PLAN2");
    expect(roots).toContain("ISO");
    expect(roots).not.toContain("RES"); // у RES есть основание
  });

  it("дерево: порождённый вложен в основание", () => {
    const graph = buildDocumentGraph(fixture());
    const forest = buildForest(graph);
    const plan = forest.find((t) => t.node.ulid === "PLAN");
    expect(plan?.children.map((c) => c.node.ulid)).toEqual(["RES"]);
  });

  it("фильтр по типу: отфильтрованное основание поднимает порождённого в корень", () => {
    const graph = buildDocumentGraph(fixture());
    const forest = buildForest(graph, {type: "result"});
    expect(forest.map((t) => t.node.ulid)).toEqual(["RES"]);
    expect(forest[0].children).toEqual([]);
  });

  it("фильтр «только с связями» прячет изолированные документы", () => {
    const graph = buildDocumentGraph(fixture());
    const forest = buildForest(graph, {onlyLinked: true});
    const roots = forest.map((t) => t.node.ulid);
    expect(roots).not.toContain("ISO");
    expect(roots).toContain("PLAN");
  });

  it("фильтр по проекту и текстовый поиск", () => {
    const entries = [
      entry({ulid: "A", path: "a.md", title: "Альфа", project: "p1", type: "doc"}),
      entry({ulid: "B", path: "b.md", title: "Бета", project: "p2", type: "doc"}),
    ];
    const graph = buildDocumentGraph(entries);
    expect(buildForest(graph, {project: "p1"}).map((t) => t.node.ulid)).toEqual(["A"]);
    expect(buildForest(graph, {query: "бета"}).map((t) => t.node.ulid)).toEqual(["B"]);
    expect(buildForest(graph, {query: "a.md"}).map((t) => t.node.ulid)).toEqual(["A"]);
  });

  it("цикл в реестре не приводит к зацикливанию", () => {
    const graph = buildDocumentGraph([
      entry({ulid: "A", path: "a.md", basedOn: ["B"]}),
      entry({ulid: "B", path: "b.md", basedOn: ["A"]}),
    ]);
    const forest = buildForest(graph);
    const flat: string[] = [];
    const walk = (nodes: ReturnType<typeof buildForest>) => {
      for (const n of nodes) {
        flat.push(n.node.ulid);
        walk(n.children);
      }
    };
    walk(forest);
    expect(flat.sort()).toEqual(["A", "B"]);
  });
});

describe("словари фильтров", () => {
  it("проекты и типы из реестра", () => {
    const graph = buildDocumentGraph([
      entry({ulid: "A", path: "a.md", project: "p1", type: "plan"}),
      entry({ulid: "B", path: "b.md", project: "p1", type: "result"}),
      entry({ulid: "C", path: "c.md", project: "p2", type: "plan"}),
    ]);
    expect(listProjects(graph)).toEqual(["p1", "p2"]);
    expect(listTypes(graph)).toEqual(["plan", "result"]);
  });
});
