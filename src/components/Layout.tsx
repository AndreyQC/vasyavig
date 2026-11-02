import {useCallback, useRef, useState} from "react";
import "./Layout.css";

interface LayoutProps {
  sidebar: React.ReactNode;
  statusbar?: React.ReactNode;
  /** Панель ассистента справа; null/undefined — панель закрыта. */
  assistant?: React.ReactNode;
  children: React.ReactNode;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 260;
const ASSISTANT_WIDTH = 340;

/** Корневой layout: resizable sidebar + main area + optional assistant + status bar. */
export function Layout({sidebar, statusbar, assistant, children}: LayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;
  const assistantOpen = assistant !== undefined && assistant !== null;
  const columns = assistantOpen
    ? `${sidebarWidth}px 5px minmax(0, 1fr) ${ASSISTANT_WIDTH}px`
    : `${sidebarWidth}px 5px minmax(0, 1fr)`;

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      const width = Math.min(
        Math.max(startWidth + (ev.clientX - startX), MIN_SIDEBAR_WIDTH),
        MAX_SIDEBAR_WIDTH,
      );
      setSidebarWidth(width);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div
      className={assistantOpen ? "layout layout--assistant" : "layout"}
      style={{gridTemplateColumns: columns}}
    >
      <aside className="layout__sidebar">{sidebar}</aside>
      <div className="layout__divider" onMouseDown={onDividerMouseDown} />
      <main className="layout__main">{children}</main>
      {assistantOpen && <aside className="layout__assistant">{assistant}</aside>}
      <footer className="layout__statusbar">{statusbar}</footer>
    </div>
  );
}
