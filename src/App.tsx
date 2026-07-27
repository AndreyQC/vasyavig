import {Button, Text} from "@gravity-ui/uikit";
import {FolderOpen} from "@gravity-ui/icons";
import {Layout} from "./components/Layout";

function App() {
  const sidebar = (
    <>
      <Button view="outlined" width="max">
        <FolderOpen />
        Открыть папку
      </Button>
      <Text variant="body-2" color="secondary" style={{marginTop: 12}}>
        Папка не открыта
      </Text>
    </>
  );

  return (
    <Layout sidebar={sidebar}>
      <Text variant="header-1">Vasyavig</Text>
      <Text variant="body-2" color="secondary" style={{marginTop: 8}}>
        Откройте папку, чтобы начать работу с Markdown/YFM файлами
      </Text>
    </Layout>
  );
}

export default App;
