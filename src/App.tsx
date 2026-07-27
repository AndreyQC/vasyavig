import {Text} from "@gravity-ui/uikit";
import {Layout} from "./components/Layout";
import {SidebarHeader} from "./components/Sidebar/SidebarHeader";
import {FileTree} from "./components/Sidebar/FileTree";
import {EmptyState} from "./components/EditorArea/EmptyState";
import {useFileStore} from "./store/fileStore";
import {useFileWatcher} from "./hooks/useFileWatcher";
import "./components/Sidebar/Sidebar.css";

function App() {
  const rootPath = useFileStore((s) => s.rootPath);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const activeFileContent = useFileStore((s) => s.activeFileContent);
  const error = useFileStore((s) => s.error);

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
      {activeFilePath !== null && activeFileContent !== null ? (
        <pre className="file-viewer">{activeFileContent}</pre>
      ) : (
        <EmptyState />
      )}
    </Layout>
  );
}

export default App;
