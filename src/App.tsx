import {useEffect} from "react";
import {Text} from "@gravity-ui/uikit";
import {invoke} from "@tauri-apps/api/core";
import {Layout} from "./components/Layout";
import {SidebarHeader} from "./components/Sidebar/SidebarHeader";
import {FileTree} from "./components/Sidebar/FileTree";
import {EmptyState} from "./components/EditorArea/EmptyState";
import {EditorTabs} from "./components/EditorArea/EditorTabs";
import {MarkdownEditor} from "./components/EditorArea/MarkdownEditor";
import {MonacoViewer} from "./components/EditorArea/MonacoViewer";
import {SplitView} from "./components/EditorArea/SplitView";
import {MainToolbar} from "./components/Toolbar/MainToolbar";
import {StatusBar} from "./components/StatusBar/StatusBar";
import {SaveConfirmModal} from "./components/Modals/SaveConfirmModal";
import {CloseTabModal} from "./components/Modals/CloseTabModal";
import {OpenFolderModal} from "./components/Modals/OpenFolderModal";
import {DeleteConfirmModal} from "./components/Modals/DeleteConfirmModal";
import {CreateFileModal} from "./components/Modals/CreateFileModal";
import {ConvertModal} from "./components/Modals/ConvertModal";
import {RenameModal} from "./components/Modals/RenameModal";
import {TocModal} from "./components/Modals/TocModal";
import {ErrorToasts} from "./components/ErrorToasts";
import {useFileStore} from "./store/fileStore";
import {useEditorStore} from "./store/editorStore";
import {useFileWatcher} from "./hooks/useFileWatcher";
import {useHotkeys} from "./hooks/useHotkeys";
import {useDragDrop} from "./hooks/useDragDrop";
import {ErrorBoundary} from "./components/ErrorBoundary";
import "./components/Sidebar/Sidebar.css";
import "./components/EditorArea/EditorArea.css";

function App() {
  const rootPath = useFileStore((s) => s.rootPath);
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.path === s.activePath));

  useFileWatcher();
  useHotkeys();
  useDragDrop();

  // Пользовательский словарь орфографии (слова, добавленные ранее)
  useEffect(() => {
    invoke("load_user_dictionary").catch((e) => console.warn("load_user_dictionary failed:", e));
  }, []);

  // Заголовок окна: {filename} — Vasyavig (идея §4.1.2)
  const activeName = activeTab?.name ?? null;
  useEffect(() => {
    document.title = activeName ? `${activeName} — Vasyavig` : "Vasyavig";
  }, [activeName]);

  const sidebar = (
    <>
      <SidebarHeader />
      <FileTree />
      {rootPath && (
        <div className="sidebar-footer">
          <Text variant="caption-2" color="secondary" ellipsis title={rootPath}>
            {rootPath}
          </Text>
        </div>
      )}
    </>
  );

  return (
    <Layout sidebar={sidebar} statusbar={<StatusBar />}>
      <ErrorBoundary>
        {activeTab ? (
          <div className="editor-area">
            <MainToolbar path={activeTab.path} />
            <div className="editor-area__header">
              <EditorTabs />
            </div>
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
              ) : (
                <MonacoViewer content={activeTab.content} path={activeTab.path} />
              )}
            </div>
          </div>
        ) : (
          <EmptyState />
        )}
        <SaveConfirmModal />
        <CloseTabModal />
        <OpenFolderModal />
        <DeleteConfirmModal />
        <CreateFileModal />
        <ConvertModal />
        <RenameModal />
        <TocModal />
        <ErrorToasts />
      </ErrorBoundary>
    </Layout>
  );
}

export default App;
