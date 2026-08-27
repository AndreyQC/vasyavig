import {useCallback, useRef, useState} from "react";
import "./Layout.css";

interface LayoutProps {
  sidebar: React.ReactNode;
  statusbar?: React.ReactNode;
  children: React.ReactNode;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 260;

/** Корневой layout: resizable sidebar + main area + status bar. */
export function Layout({sidebar, statusbar, children}: LayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

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
    <div className="layout" style={{gridTemplateColumns: `${sidebarWidth}px 5px 1fr`}}>
      <aside className="layout__sidebar">{sidebar}</aside>
      <div className="layout__divider" onMouseDown={onDividerMouseDown} />
      <main className="layout__main">{children}</main>
      <footer className="layout__statusbar">{statusbar}</footer>
    </div>
  );
}
