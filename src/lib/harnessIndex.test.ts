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
  JSON.stringify({ulid: ULID_A, path: "_docs_/_tasks_/2026-10-04/a_plan.md", title: "План А", type: "plan"}),
  JSON.stringify({ulid: ULID_B, path: "docs/README.md", title: "Readme", type: "doc", based_on: [ULID_A]}),
  "{битая строка",
  JSON.stringify({ulid: "no-path"}),
  "",
].join("\n");

describe("parseDocumentsJsonl", () => {
  it("читает записи, пропускает пустые/битые/неполные строки, маппит based_on", () => {
    const entries = parseDocumentsJsonl(JSONL);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ulid: ULID_A, path: "_docs_/_tasks_/2026-10-04/a_plan.md", type: "plan"});
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
    expect(ancestorDirs("C:\\repos\\lm\\_docs_\\_tasks_")).toEqual([
      "C:/repos/lm/_docs_/_tasks_",
      "C:/repos/lm/_docs_",
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
  it("находит ближайший индекс; кандидаты идут снизу вверх", async () => {
    const candidates: string[] = [];
    const probe = async (candidate: string) => {
      candidates.push(candidate);
      return candidate === `C:/repos/lm/${HARNESS_INDEX_REL}` ? "{}" : null;
    };
    const found = await findHarnessIndex("C:/repos/lm/_docs_/_tasks_", probe);
    expect(found?.repoRoot).toBe("C:/repos/lm");
    expect(candidates[0]).toBe("C:/repos/lm/_docs_/_tasks_/_docs_/_index/documents.jsonl");
    expect(candidates).toContain(`C:/repos/lm/${HARNESS_INDEX_REL}`);
  });
  it("нигде нет индекса -> null", async () => {
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
  it("манифест в корне — репозиторий", async () => {
    const probe = async (p: string) => (p === "/repo/harness_manifest.json" ? '{"kind":"harness"}' : null);
    expect(await isHarnessRepoDir("/repo", probe)).toBe(true);
  });

  it("реестр в корне — репозиторий", async () => {
    const probe = async (p: string) => (p === `/repo/${HARNESS_INDEX_REL}` ? "{}" : null);
    expect(await isHarnessRepoDir("/repo", probe)).toBe(true);
  });

  it("битый манифест (не JSON) — не репозиторий", async () => {
    const probe = async (p: string) => (p === "/repo/harness_manifest.json" ? "не json" : null);
    expect(await isHarnessRepoDir("/repo", probe)).toBe(false);
  });

  it("ни манифеста, ни реестра — не репозиторий", async () => {
    expect(await isHarnessRepoDir("/repo", async () => null)).toBe(false);
  });
});

describe("treeContainsHarnessRepo", () => {
  it("реестр или манифест в поддереве — найдено", () => {
    const tree = [
      {path: "/repo/docs/a.md", children: null},
      {path: `/repo/${HARNESS_INDEX_REL}`, children: null},
    ];
    expect(treeContainsHarnessRepo(tree)).toBe(true);
    expect(treeContainsHarnessRepo([{path: "/repo/docs/a.md", children: null}])).toBe(false);
  });

  it("вложенный уровень тоже считается", () => {
    const tree = [
      {
        path: "/repo/sub",
        children: [{path: "/repo/sub/harness_manifest.json", children: null}],
      },
    ];
    expect(treeContainsHarnessRepo(tree)).toBe(true);
  });
});
