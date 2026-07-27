import React from "react";
import ReactDOM from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import App from "./App";

import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme="system">
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
