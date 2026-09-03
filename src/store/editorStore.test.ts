import {beforeEach, describe, expect, it} from "vitest";
import {useEditorStore} from "./editorStore";

const initialState = useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState(initialState, true);
});

describe("editorStore.openTab", () => {
  it("добавляет вкладку и делает её активной", () => {
    useEditorStore.getState().openTab({path: "/a.md", kind: "markdown", content: "# A"});
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({path: "/a.md", name: "a.md", dirty: false, mode: "wysiwyg"});
    expect(s.activePath).toBe("/a.md");
  });

  it("повторное открытие не дублирует вкладку, а активирует существующую", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    st.openTab({path: "/b.md", kind: "markdown", content: "B"});
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activePath).toBe("/a.md");
  });
});

describe("editorStore.updateContent", () => {
  it("dirty=true при изменении и false при возврате к сохранённому", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "orig"});
    st.updateContent("/a.md", "changed");
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true);
    st.updateContent("/a.md", "orig");
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false);
  });

  it("не трогает другие вкладки", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    st.openTab({path: "/b.md", kind: "markdown", content: "B"});
    st.updateContent("/a.md", "A2");
    const s = useEditorStore.getState();
    expect(s.tabs.find((t) => t.path === "/b.md")?.content).toBe("B");
    expect(s.tabs.find((t) => t.path === "/b.md")?.dirty).toBe(false);
  });
});

describe("editorStore.closeTab", () => {
  it("при закрытии активной вкладки активирует последнюю оставшуюся", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    st.openTab({path: "/b.md", kind: "markdown", content: "B"});
    st.closeTab("/b.md");
    expect(useEditorStore.getState().activePath).toBe("/a.md");
  });

  it("при закрытии последней вкладки activePath=null", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    st.closeTab("/a.md");
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activePath).toBeNull();
  });

  it("закрытие неактивной вкладки не меняет activePath", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    st.openTab({path: "/b.md", kind: "markdown", content: "B"});
    st.closeTab("/a.md");
    expect(useEditorStore.getState().activePath).toBe("/b.md");
  });
});

describe("editorStore.setMode", () => {
  it("переключает режим конкретной вкладки", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    st.setMode("/a.md", "markup");
    expect(useEditorStore.getState().tabs[0].mode).toBe("markup");
  });
});

describe("editorStore.saveTab", () => {
  it("не сохраняет чистую вкладку", async () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    await expect(st.saveTab("/a.md")).resolves.toBeNull();
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false);
  });

  it("не сохраняет текстовую вкладку", async () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.txt", kind: "text", content: "A"});
    st.updateContent("/a.txt", "B");
    await expect(st.saveTab("/a.txt")).resolves.toBeNull();
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true);
  });
});

describe("editorStore.closeAllTabs", () => {
  it("закрывает все вкладки", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    st.openTab({path: "/b.md", kind: "markdown", content: "B"});
    st.closeAllTabs();
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activePath).toBeNull();
  });
});

describe("editorStore preview-вкладки (спека preview-tabs)", () => {
  it("preview-открытие закрывает предыдущую preview-вкладку, закреплённые не трогает", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"}); // закреплённая
    st.openTab({path: "/b.md", kind: "markdown", content: "B"}, {preview: true});
    st.openTab({path: "/c.md", kind: "markdown", content: "C"}, {preview: true});
    const s = useEditorStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["/a.md", "/c.md"]);
    expect(s.tabs[1].preview).toBe(true);
    expect(s.activePath).toBe("/c.md");
  });

  it("последовательные preview A→B→C оставляют одну preview-вкладку", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"}, {preview: true});
    st.openTab({path: "/b.md", kind: "markdown", content: "B"}, {preview: true});
    st.openTab({path: "/c.md", kind: "markdown", content: "C"}, {preview: true});
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].path).toBe("/c.md");
  });

  it("повторный preview-клик по тому же файлу не создаёт дубль и не меняет статус", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"}, {preview: true});
    st.openTab({path: "/a.md", kind: "markdown", content: "A"}, {preview: true});
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].preview).toBe(true);
  });

  it("закреплённое открытие существующей preview-вкладки закрепляет её (двойной клик)", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"}, {preview: true});
    st.openTab({path: "/a.md", kind: "markdown", content: "A"});
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].preview).toBe(false);
    // закреплённая больше не замещается следующим preview
    st.openTab({path: "/b.md", kind: "markdown", content: "B"}, {preview: true});
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(["/a.md", "/b.md"]);
  });

  it("первая правка (переход в dirty) закрепляет preview-вкладку необратимо", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "orig"}, {preview: true});
    st.updateContent("/a.md", "changed");
    let s = useEditorStore.getState();
    expect(s.tabs[0].dirty).toBe(true);
    expect(s.tabs[0].preview).toBe(false);
    st.updateContent("/a.md", "orig"); // dirty снова false — закрепление остаётся
    s = useEditorStore.getState();
    expect(s.tabs[0].preview).toBe(false);
  });

  it("программный updateContent без изменения текста не закрепляет", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "orig"}, {preview: true});
    st.updateContent("/a.md", "orig");
    expect(useEditorStore.getState().tabs[0].preview).toBe(true);
  });

  it("preview-вкладка не бывает dirty до закрепления", () => {
    const st = useEditorStore.getState();
    st.openTab({path: "/a.md", kind: "markdown", content: "A"}, {preview: true});
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false);
  });
});
