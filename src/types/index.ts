/** Узел файлового дерева (зеркало Rust FileNode). */
export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileNode[] | null;
}
