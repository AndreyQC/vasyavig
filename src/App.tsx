import {Text} from "@gravity-ui/uikit";
import {Layout} from "./components/Layout";
import {SidebarHeader} from "./components/Sidebar/SidebarHeader";
import {FileTree} from "./components/Sidebar/FileTree";
import {EmptyState} from "./components/EditorArea/EmptyState";
import {EditorTabs} from "./components/EditorArea/EditorTabs";
import {MarkdownEditor} from "./components/EditorArea/MarkdownEditor";
import {ModeSwitcher} from "./components/Toolbar/ModeSwitcher";
import {useFileStore} from "./store/fileStore";
import {useEditorStore} from "./store/editorStore";
import {useFileWatcher} from "./hooks/useFileWatcher";
import "./components/Sidebar/Sidebar.css";
import "./components/EditorArea/EditorArea.css";

function App() {
  const rootPath = useFileStore((s) => s.rootPath);
  const error = useFileStore((s) => s.error);
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.path === s.activePath));

  useFileWatcher();

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
    <Layout sidebar={sidebar}>
      {error && (
        <Text variant="body-2" color="danger" style={{marginBottom: 12}}>
          {error}
        </Text>
      )}
      {activeTab ? (
        <div className="editor-area">
          <div className="editor-area__header">
            <EditorTabs />
            {activeTab.kind === "markdown" && <ModeSwitcher path={activeTab.path} />}
          </div>
          <div className="editor-area__content">
            {activeTab.kind === "markdown" ? (
              <MarkdownEditor
                key={activeTab.path}
                path={activeTab.path}
                initialContent={activeTab.content}
              />
            ) : (
              <pre className="file-viewer">{activeTab.content}</pre>
            )}
          </div>
        </div>
      ) : (
        <EmptyState />
      )}
    </Layout>
  );
}

export default App;
