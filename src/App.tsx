import {Text} from "@gravity-ui/uikit";
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
import {useFileStore} from "./store/fileStore";
import {useEditorStore} from "./store/editorStore";
import {useFileWatcher} from "./hooks/useFileWatcher";
import {useSaveHotkeys} from "./hooks/useSaveHotkeys";
import {ErrorBoundary} from "./components/ErrorBoundary";
import "./components/Sidebar/Sidebar.css";
import "./components/EditorArea/EditorArea.css";

function App() {
  const rootPath = useFileStore((s) => s.rootPath);
  const error = useFileStore((s) => s.error);
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.path === s.activePath));

  useFileWatcher();
  useSaveHotkeys();

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
        {error && (
          <Text variant="body-2" color="danger" style={{marginBottom: 12}}>
            {error}
          </Text>
        )}
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
      </ErrorBoundary>
    </Layout>
  );
}

export default App;
