/** Расширения, открываемые в редакторе Markdown (WYSIWYG/Markup). */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "yfm", "mdx"] as const;

/** Расширения офисных документов, конвертируемых в Markdown (anydoc). */
export const OFFICE_EXTENSIONS = [
  "doc",
  "docx",
  "docm",
  "ppt",
  "pps",
  "pot",
  "pptx",
  "pptm",
  "ppsx",
  "ppsm",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "csv",
  "pdf",
] as const;

/** Расширения графических файлов, открываемых в вкладке-просмотрщике. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"] as const;

/** Расширения писем (MIME), открываемых в вкладке-просмотрщике. */
export const EML_EXTENSIONS = ["eml"] as const;

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
