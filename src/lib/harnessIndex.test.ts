// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {
  ancestorDirs,
  buildUlidIndex,
  findHarnessIndex,
  HARNESS_INDEX_REL,
  isHarnessRepoDir,
  linkifyUlidsInElement,
  parseDocumentsJsonl,
  resolveUlid,
  treeContainsHarnessRepo,
  type HarnessIndexEntry,
} from "./harnessIndex";

const ULID_A = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ULID_B = "01M43R3YYCBWXD01XW1RXPM575";

const JSONL = [
  JSON.stringify({ulid: ULID_A, path: "harness_docs/harness_tasks/2026-10-04/a_plan.md", title: "План А", type: "plan"}),
  JSON.stringify({ulid: ULID_B, path: "docs/README.md", title: "Readme", type: "doc", based_on: [ULID_A]}),
  "{битая строка",
  JSON.stringify({ulid: "no-path"}),
  "",
].join("\n");

describe("parseDocumentsJsonl", () => {
  it("читает записи, пропускает пустые/битые/неполные строки, маппит based_on", () => {
    const entries = parseDocumentsJsonl(JSONL);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ulid: ULID_A, path: "harness_docs/harness_tasks/2026-10-04/a_plan.md", type: "plan"});
    expect(entries[1].basedOn).toEqual([ULID_A]);
  });
});

describe("resolveUlid", () => {
  const byUlid = buildUlidIndex(parseDocumentsJsonl(JSONL));

  it("точное совпадение", () => {
    expect(resolveUlid(byUlid, ULID_A)).toMatchObject({status: "found", entry: {title: "План А"}});
  });
  it("уникальный префикс -> found", () => {
    expect(resolveUlid(byUlid, "01M43R3ZG").status).toBe("found");
  });
  it("неоднозначный префикс -> ambiguous", () => {
    expect(resolveUlid(byUlid, "01M43R3").status).toBe("ambiguous");
  });
  it("нет совпадения -> unknown", () => {
    expect(resolveUlid(byUlid, "01M5RK385592V1WEET1786GDFN")).toMatchObject({status: "unknown"});
  });
  it("дубль ULID в реестре — побеждает последняя запись", () => {
    const dup = buildUlidIndex([
      {ulid: ULID_A, path: "first.md"},
      {ulid: ULID_A, path: "second.md"},
    ] as HarnessIndexEntry[]);
    expect(dup[ULID_A].path).toBe("second.md");
  });
});

describe("ancestorDirs", () => {
  it("поднимается от каталога к корню диска, нормализуя разделители", () => {
    expect(ancestorDirs("C:\\repos\\lm\\harness_docs\\harness_tasks")).toEqual([
      "C:/repos/lm/harness_docs/harness_tasks",
      "C:/repos/lm/harness_docs",
      "C:/repos/lm",
      "C:/repos",
      "C:",
    ]);
  });
  it("ограничивает глубину maxLevels", () => {
    expect(ancestorDirs("C:/a/b/c/d/e/f/g/h/i/j/k", 3)).toHaveLength(4);
  });
});

describe("findHarnessIndex", () => {
  it("якорь harness.yaml + реестр под ним; пробы yaml идут снизу вверх", async () => {
    const candidates: string[] = [];
    const probe = async (candidate: string) => {
      candidates.push(candidate);
      if (candidate === "C:/repos/lm/harness.yaml") return "project:\n  id: lm\n";
      return candidate === `C:/repos/lm/${HARNESS_INDEX_REL}` ? "{}" : null;
    };
    const found = await findHarnessIndex("C:/repos/lm/harness_docs/harness_tasks", probe);
    expect(found?.repoRoot).toBe("C:/repos/lm");
    expect(found?.content).toBe("{}");
    // первый кандидат — якорь от самого каталога (HY-1: сначала корень, потом реестр)
    expect(candidates[0]).toBe("C:/repos/lm/harness_docs/harness_tasks/harness.yaml");
    expect(candidates).toContain(`C:/repos/lm/${HARNESS_INDEX_REL}`);
  });
  it("якорь есть, реестра нет -> null (репо распознан, ULID-функции отключены)", async () => {
    const probe = async (p: string) => (p === "/repo/harness.yaml" ? "project: x\n" : null);
    expect(await findHarnessIndex("/repo/sub", probe)).toBeNull();
  });
  it("нигде нет якоря -> null", async () => {
    expect(await findHarnessIndex("C:/plain/dir", async () => null)).toBeNull();
  });
});

describe("linkifyUlidsInElement", () => {
  const lookup = (ulid: string) => (ulid === ULID_A ? {title: "План А", type: "plan"} : null);

  function render(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    linkifyUlidsInElement(root, lookup, "нет в реестре");
    return root;
  }

  it("известный ULID -> <a data-ulid> с aria-label «title · type»", () => {
    const root = render(`<p>см. ${ULID_A} далее</p>`);
    const link = root.querySelector("a[data-ulid]");
    expect(link?.getAttribute("data-ulid")).toBe(ULID_A);
    expect(link?.getAttribute("aria-label")).toBe("План А · plan");
    expect(link?.getAttribute("title")).toBeNull();
    expect(link?.textContent).toBe(ULID_A);
    expect(root.textContent).toBe(`см. ${ULID_A} далее`);
  });

  it("неизвестный -> <span data-ulid-unknown> с подсказкой", () => {
    const root = render(`<p>${ULID_B}</p>`);
    const span = root.querySelector("span[data-ulid-unknown]");
    expect(span?.getAttribute("aria-label")).toBe("нет в реестре");
    expect(root.querySelector("a")).toBeNull();
  });

  it("ULID в <code> закладки обрабатывается, текст внутри ссылок не трогается", () => {
    const root = render(`<blockquote>id <code>${ULID_A}</code></blockquote><p><a href="x">${ULID_A}</a></p>`);
    expect(root.querySelectorAll("a[data-ulid]")).toHaveLength(1);
    expect(root.querySelector("code a[data-ulid], code[data-ulid]")).not.toBeNull();
    const plainLink = root.querySelector('a[href="x"]');
    expect(plainLink?.textContent).toBe(ULID_A);
  });

  it("несколько ULID в одном узле: порядок текста сохраняется", () => {
    const root = render(`<p>${ULID_B} и ${ULID_A} и хвост</p>`);
    expect(root.textContent).toBe(`${ULID_B} и ${ULID_A} и хвост`);
    expect(root.querySelectorAll("[data-ulid-unknown], [data-ulid]")).toHaveLength(2);
  });

  it("мусорные 26-символьные токены не оборачиваются", () => {
    const root = render("<p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>");
    expect(root.querySelector("[data-ulid],[data-ulid-unknown]")).toBeNull();
  });
});

describe("isHarnessRepoDir", () => {
  it("harness.yaml в корне — репозиторий (единственный якорь, HY-1)", async () => {
    const probe = async (p: string) => (p === "/repo/harness.yaml" ? "project:\n  id: x\n" : null);
    expect(await isHarnessRepoDir("/repo", probe)).toBe(true);
  });

  it("битый harness.yaml (не YAML-объект) — не репозиторий", async () => {
    const probe = async (p: string) => (p === "/repo/harness.yaml" ? "[битый" : null);
    expect(await isHarnessRepoDir("/repo", probe)).toBe(false);
  });

  it("реестр без якоря — НЕ репозиторий (T3c: один якорь)", async () => {
    const probe = async (p: string) => (p === `/repo/${HARNESS_INDEX_REL}` ? "{}" : null);
    expect(await isHarnessRepoDir("/repo", probe)).toBe(false);
  });

  it("ни yaml, ни реестра — не репозиторий", async () => {
    expect(await isHarnessRepoDir("/repo", async () => null)).toBe(false);
  });
});

describe("treeContainsHarnessRepo", () => {
  it("harness.yaml в поддереве — найдено", () => {
    const tree = [
      {path: "/repo/docs/a.md", children: null},
      {path: "/repo/harness.yaml", children: null},
    ];
    expect(treeContainsHarnessRepo(tree)).toBe(true);
    expect(treeContainsHarnessRepo([{path: "/repo/docs/a.md", children: null}])).toBe(false);
  });

  it("вложенный уровень тоже считается", () => {
    const tree = [
      {
        path: "/repo/sub",
        children: [{path: "/repo/sub/harness.yaml", children: null}],
      },
    ];
    expect(treeContainsHarnessRepo(tree)).toBe(true);
  });
});
