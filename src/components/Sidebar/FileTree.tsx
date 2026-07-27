import {Loader, Text} from "@gravity-ui/uikit";
import {useFileStore} from "../../store/fileStore";
import {FileTreeNode} from "./FileTreeNode";

export function FileTree() {
  const tree = useFileStore((s) => s.tree);
  const isLoadingTree = useFileStore((s) => s.isLoadingTree);
  const hasRoot = useFileStore((s) => s.rootPath !== null);

  if (!hasRoot) {
    return (
      <Text variant="body-2" color="secondary" className="file-tree__empty">
        Папка не открыта
      </Text>
    );
  }

  if (isLoadingTree) {
    return <Loader size="m" className="file-tree__loader" />;
  }

  return (
    <div className="file-tree">
      {tree.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} />
      ))}
    </div>
  );
}
