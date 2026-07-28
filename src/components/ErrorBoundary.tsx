import {Component, type ErrorInfo, type ReactNode} from "react";
import {Text} from "@gravity-ui/uikit";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Ловит падения рендера, чтобы вместо белого экрана показать текст ошибки.
 * Ошибка также пишется в localStorage (ключ vasyavig.lastError) для диагностики.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const payload = `${error.message}\n\n${error.stack ?? ""}\n\n${info.componentStack ?? ""}`;
    try {
      localStorage.setItem("vasyavig.lastError", payload);
    } catch {
      // ignore
    }
    console.error(payload);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 24, whiteSpace: "pre-wrap", overflow: "auto"}}>
          <Text variant="header-1" color="danger">
            Ошибка рендеринга
          </Text>
          <Text variant="body-2" as="div" style={{marginTop: 12}}>
            {this.state.error.message}
          </Text>
          <Text variant="caption-2" color="secondary" as="div" style={{marginTop: 12}}>
            {this.state.error.stack}
          </Text>
        </div>
      );
    }
    return this.props.children;
  }
}
