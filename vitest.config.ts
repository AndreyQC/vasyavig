import {defineConfig} from "vitest/config";

/**
 * Конфигурация vitest.
 * - stub-css: пакеты (gravity-ui) тянут .css-импорты, которые vite-node не умеет
 *   исполнять как JS; в юнит-тестах стили не нужны — заменяем на пустой модуль.
 * - environment: node по умолчанию; тестам с DOM нужна прагма
 *   `// @vitest-environment jsdom` в шапке файла (devDep jsdom установлен).
 */
export default defineConfig({
  plugins: [
    {
      name: "stub-css",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith(".css")) return "\0stub-css";
        return null;
      },
      load(id) {
        if (id === "\0stub-css") return "";
      },
    },
  ],
});
