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
