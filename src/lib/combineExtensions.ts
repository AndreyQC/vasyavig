import type {Extension} from "@gravity-ui/markdown-editor";

/** Объединяет несколько расширений редактора в одно (wysiwygConfig.extensions принимает одно). */
export function combineExtensions(...extensions: Extension[]): Extension {
  return (builder) => {
    for (const extension of extensions) extension(builder);
  };
}
