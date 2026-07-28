/** Расширения, открываемые в редакторе Markdown (WYSIWYG/Markup). */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "yfm", "mdx"] as const;

/** Расширения, открываемые в текстовом viewer (read-only, Monaco на этапе 5). */
export const TEXT_EXTENSIONS = [
  "txt",
  "json",
  "py",
  "sql",
  "js",
  "ts",
  "jsx",
  "tsx",
  "yaml",
  "yml",
  "xml",
  "log",
  "rs",
  "go",
  "java",
  "cpp",
  "c",
  "h",
] as const;
