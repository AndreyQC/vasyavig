import React from "react";
import ReactDOM from "react-dom/client";
import {ThemeProvider, Toaster, ToasterComponent, ToasterProvider} from "@gravity-ui/uikit";
import App from "./App";

import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "@gravity-ui/markdown-editor/styles/styles.css";

// Toaster обязателен: MarkdownEditorView использует useToaster (без провайдера — белый экран)
const toaster = new Toaster();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme="system">
      <ToasterProvider toaster={toaster}>
        <App />
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
