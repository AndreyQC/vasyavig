import "./Layout.css";

interface LayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

/** Корневой layout: sidebar (дерево файлов) + main area (редактор/viewer). */
export function Layout({sidebar, children}: LayoutProps) {
  return (
    <div className="layout">
      <aside className="layout__sidebar">{sidebar}</aside>
      <main className="layout__main">{children}</main>
    </div>
  );
}
