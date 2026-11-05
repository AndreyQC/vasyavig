import {useEffect} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Layout} from "./components/Layout";
import {SidebarHeader} from "./components/Sidebar/SidebarHeader";
import {FileTree} from "./components/Sidebar/FileTree";
import {TaskDashboard} from "./components/Sidebar/TaskDashboard";
import {RegistryPanel} from "./components/Registry/RegistryPanel";
import {DocumentGraphPanel} from "./components/Graph/DocumentGraphPanel";
import {EmptyState} from "./components/EditorArea/EmptyState";
import {EditorTabs} from "./components/EditorArea/EditorTabs";
import {MarkdownEditor} from "./components/EditorArea/MarkdownEditor";
import {MonacoViewer} from "./components/EditorArea/MonacoViewer";
import {ImageViewer} from "./components/EditorArea/ImageViewer";
import {EmlViewer} from "./components/EditorArea/EmlViewer";
import {HtmlViewer} from "./components/EditorArea/HtmlViewer";
import {SplitView} from "./components/EditorArea/SplitView";
import {MainToolbar} from "./components/Toolbar/MainToolbar";
import {StatusBar} from "./components/StatusBar/StatusBar";
import {SaveConfirmModal} from "./components/Modals/SaveConfirmModal";
import {CloseTabModal} from "./components/Modals/CloseTabModal";
import {WorkspaceSwitchModal} from "./components/Modals/WorkspaceSwitchModal";
import {RemoveRootModal} from "./components/Modals/RemoveRootModal";
import {DeleteConfirmModal} from "./components/Modals/DeleteConfirmModal";
import {CreateFileModal} from "./components/Modals/CreateFileModal";
import {ConvertModal} from "./components/Modals/ConvertModal";
import {QuickOpen} from "./components/QuickOpen";
import {RenameModal} from "./components/Modals/RenameModal";
import {AliasModal} from "./components/Modals/AliasModal";
import {TocModal} from "./components/Modals/TocModal";
import {MermaidModal} from "./components/Modals/MermaidModal";
import {ErrorToasts} from "./components/ErrorToasts";
import {NoticeToasts} from "./components/NoticeToasts";
import {HarnessUlidPopover} from "./components/HarnessUlidPopover";
import {VasEntityPopover} from "./components/VasEntityPopover";
import {AssistantPanel} from "./components/Assistant/AssistantPanel";
import {useEditorStore} from "./store/editorStore";
import {useFileStore} from "./store/fileStore";
import {useUiStore} from "./store/uiStore";
import {useAssistantStore} from "./store/assistantStore";
import {useConfigStore} from "./store/configStore";
import {useAgentStore} from "./store/agentStore";
import {isConfigFileName} from "./lib/agent/config";
import {useFileWatcher} from "./hooks/useFileWatcher";
import {useHotkeys} from "./hooks/useHotkeys";
import {useDragDrop} from "./hooks/useDragDrop";
import {ErrorBoundary} from "./components/ErrorBoundary";
import "./components/Sidebar/Sidebar.css";
import "./components/EditorArea/EditorArea.css";

function App() {
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.path === s.activePath));

  useFileWatcher();
  useHotkeys();
  useDragDrop();

  // Пользовательский словарь орфографии (слова, добавленные ранее)
  useEffect(() => {
    invoke("load_user_dictionary").catch((e) => console.warn("load_user_dictionary failed:", e));
  }, []);

  // Восстановление последнего workspace на старте (спека workspace-file);
  // отсутствие/ошибка файла — чистый старт внутри openWorkspaceFile
  useEffect(() => {
    void useFileStore.getState().restoreLastWorkspace();
  }, []);

  // Конфиг ассистента живёт рядом с workspace-файлом: перечитываем при смене
  // workspace. Внутри — defaults, если файла ещё нет (Phase 8.1).
  const workspaceFilePath = useFileStore((s) => s.workspaceFilePath);
  useEffect(() => {
    // opaque docId/rootId и предложения живут в рамках workspace (8.2)
    useAgentStore.getState().resetSession();
    void useConfigStore.getState().loadForWorkspace(workspaceFilePath);
  }, [workspaceFilePath]);

  // Заголовок окна: [● ]{filename} — Vasyavig (идея §4.1.2; маркер dirty —
  // план 20261028_004, D6)
  const activeName = activeTab?.name ?? null;
  const hasDirty = useEditorStore((s) => s.tabs.some((t) => t.dirty));
  useEffect(() => {
    const base = activeName ? `${activeName} — Vasyavig` : "Vasyavig";
    document.title = hasDirty ? `● ${base}` : base;
  }, [activeName, hasDirty]);

  // шапка сайдбара закреплена; скроллится только содержимое (flex-колонка);
  // содержимое — дерево файлов, дашборд задач или панель справочника (T6-2)
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const sidebar = (
    <div className="sidebar">
      <SidebarHeader />
      <div className="sidebar__content">
        {sidebarMode === "tasks" ? (
          <TaskDashboard />
        ) : sidebarMode === "registry" ? (
          <RegistryPanel />
        ) : (
          <FileTree />
        )}
      </div>
    </div>
  );

  // главная панель: вкладка документа или вкладка «Граф» (план 20261028_001)
  const mainPane = useUiStore((s) => s.mainPane);
  // vasyavig.yaml — read-only: правки только через форму настроек (D5).
  const assistantOpen = useAssistantStore((s) => s.panelOpen);
  const activeIsConfig = activeTab ? isConfigFileName(activeTab.path) : false;
  return (
    <Layout
      sidebar={sidebar}
      statusbar={<StatusBar />}
      assistant={
        assistantOpen ? (
          <ErrorBoundary>
            <AssistantPanel />
          </ErrorBoundary>
        ) : undefined
      }
    >
      <ErrorBoundary>
        <div className="editor-area">
          <div className="editor-area__header">
            <EditorTabs />
          </div>
          {mainPane === "graph" ? (
            <div className="editor-area__content">
              <DocumentGraphPanel />
            </div>
          ) : activeTab ? (
            <>
              <MainToolbar path={activeTab.path} />
              <div className="editor-area__content">
                {activeTab.kind === "markdown" ? (
                  activeTab.mode === "split" ? (
                    <SplitView key={activeTab.path} tab={activeTab} />
                  ) : (
                    <MarkdownEditor
                      key={activeTab.path}
                      path={activeTab.path}
                      initialContent={activeTab.content}
                    />
                  )
                ) : activeTab.kind === "image" ? (
                  <ImageViewer key={activeTab.path} path={activeTab.path} name={activeTab.name} />
                ) : activeTab.kind === "email" ? (
                  <EmlViewer key={activeTab.path} content={activeTab.content} />
                ) : activeTab.kind === "html" ? (
                  <HtmlViewer
                    key={activeTab.path}
                    content={activeTab.content}
                    path={activeTab.path}
                    name={activeTab.name}
                  />
                ) : (
                  <MonacoViewer
                    content={activeTab.content}
                    path={activeTab.path}
                    editable={!activeIsConfig}
                    onChange={
                      activeIsConfig
                        ? undefined
                        : (value) =>
                            useEditorStore.getState().updateContent(activeTab.path, value)
                    }
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </div>
        <SaveConfirmModal />
        <CloseTabModal />
        <WorkspaceSwitchModal />
        <RemoveRootModal />
        <DeleteConfirmModal />
        <CreateFileModal />
        <ConvertModal />
        <RenameModal />
        <AliasModal />
        <QuickOpen />
        <TocModal />
        <MermaidModal />
        <ErrorToasts />
        <NoticeToasts />
        <HarnessUlidPopover />
        <VasEntityPopover />
      </ErrorBoundary>
    </Layout>
  );
}

export default App;
