import React from "react";
import ReactDOM from "react-dom/client";
import {ThemeProvider, Toaster, ToasterComponent, ToasterProvider} from "@gravity-ui/uikit";
import App from "./App";
import {useUiStore} from "./store/uiStore";
import "./lib/i18n";

import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "@gravity-ui/markdown-editor/styles/styles.css";
import "./styles/root-colors.css";
import "./styles/global.css";

// Toaster обязателен: MarkdownEditorView использует useToaster (без провайдера — белый экран)
const toaster = new Toaster();

function Root() {
  const theme = useUiStore((s) => s.theme);
  return (
    <ThemeProvider theme={theme}>
      <ToasterProvider toaster={toaster}>
        <App />
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
