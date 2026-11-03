// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {useEntityScanStore} from "./entityScanStore";
import {useEditorStore} from "./editorStore";
import {ensureEntitiesIndex, resetEntitiesIndexCache} from "../lib/entitiesIndex";

vi.mock("../hooks/useTauriFS", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
}));

// i18n тянет @gravity-ui/uikit (configure, css) — в vitest не нужен
vi.mock("../lib/i18n", () => ({default: {t: (key: string) => key}}));

const {readFile, writeFile} = await import("../hooks/useTauriFS");

const REPO = "C:/repos/repo";
const DOC = `${REPO}/docs/a.md`;
const P = "01JBBCCCCDDDDDDDDDDDDDDDDD";

const YAML = "project: x\n";

/** readFile: якорь + документ; writeFile пишет в карту. */
function mockFs(files: Record<string, string>) {
  (readFile as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  });
  (writeFile as ReturnType<typeof vi.fn>).mockImplementation(async (path: string, content: string) => {
    files[path] = content;
  });
}

const initialEditor = useEditorStore.getState();

beforeEach(() => {
  resetEntitiesIndexCache();
  useEditorStore.setState(initialEditor, true);
});

describe("entityScanStore.resolveTypeConflict (T3e-2)", () => {
  it("href в открытой вкладке переписан на выбранный тип; индекс обновлён", async () => {
    const files: Record<string, string> = {
      [`${REPO}/harness.yaml`]: YAML,
      [`${REPO}/harness_docs/harness_index/entities.jsonl`]: JSON.stringify({ulid: P, type: "org", canonical: "Иванов", forms: ["Иванов"]}),
      [DOC]: `А [Иванов](vas-entity:person:${P}) и [ООО](vas-entity:org:${P}).`,
    };
    mockFs(files);
    useEditorStore.getState().openTab({
      path: DOC,
      kind: "markdown",
      content: `А [Иванов](vas-entity:person:${P}) и [ООО](vas-entity:org:${P}).`,
    });

    await useEntityScanStore.getState().resolveTypeConflict(REPO, P, "person");

    // открытая вкладка: неверный href переписан, вкладка dirty
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe(`А [Иванов](vas-entity:person:${P}) и [ООО](vas-entity:person:${P}).`);
    expect(tab.dirty).toBe(true);
    // индекс: type записи — person
    const index = await ensureEntitiesIndex(REPO);
    expect(index.entries.find((e) => e.ulid === P)?.type).toBe("person");
  });

  it("повторный скан после решения — конфликт исчез", async () => {
    const files: Record<string, string> = {
      [`${REPO}/harness.yaml`]: YAML,
      [DOC]: `А [Иванов](vas-entity:person:${P}) и [ООО](vas-entity:org:${P}).`,
    };
    mockFs(files);
    useEditorStore.getState().openTab({
      path: DOC,
      kind: "markdown",
      content: `А [Иванов](vas-entity:person:${P}) и [ООО](vas-entity:org:${P}).`,
    });

    await useEntityScanStore.getState().resolveTypeConflict(REPO, P, "person");

    const rootKey = REPO.replace(/\\/g, "/");
    const diff = useEntityScanStore.getState().byRoot[rootKey]?.diff;
    expect(diff?.typeConflicts).toEqual([]);
  });
});
