import "./Layout.css";

interface LayoutProps {
  sidebar: React.ReactNode;
  statusbar?: React.ReactNode;
  children: React.ReactNode;
}

/** Корневой layout: sidebar (дерево файлов) + main area (редактор/viewer) + status bar. */
export function Layout({sidebar, statusbar, children}: LayoutProps) {
  return (
    <div className="layout">
      <aside className="layout__sidebar">{sidebar}</aside>
      <main className="layout__main">{children}</main>
      <footer className="layout__statusbar">{statusbar}</footer>
    </div>
  );
}
