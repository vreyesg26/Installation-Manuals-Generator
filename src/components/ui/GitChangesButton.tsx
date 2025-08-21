import { useState } from "react";
import { Button } from "./button";
import { GitChangesModal } from "./GitChangesModal";
import type { RepoStatus } from "@/types/git";
import { Group } from "@mantine/core";

export default function GitChangesButton() {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RepoStatus[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [repos, setRepos] = useState<string[]>([]);

  const handleDiscover = async () => {
    // protección por si el preload no cargó
    if (!window.ipc?.chooseRoots) {
      alert(
        "El puente IPC (window.ipc) no está disponible. Revisa que preload.js esté apuntado correctamente en BrowserWindow."
      );
      return;
    }

    setLoading(true);
    try {
      // 1) Elegir raíces (solo si no hay)
      let r = roots;
      if (!r.length) {
        r = await window.ipc.chooseRoots();
        setRoots(r);
      }
      if (!r.length) return;

      // 2) Descubrir repos bajo esas raíces
      const found = await window.ipc.discover(r);
      setRepos(found);

      // 3) Escanear estados de esos repos
      const statuses = await window.ipc.scan(found); // o scanDiscovered()
      setData(statuses);
      setOpened(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRescan = async () => {
    if (!repos.length) return;
    setLoading(true);
    try {
      const statuses = await window.ipc.scan(repos);
      setData(statuses);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Group gap="sm">
        <Button onClick={handleDiscover} disabled={loading}>
          {loading ? "Buscando repos…" : "Detectar cambios Git"}
        </Button>
        {repos.length > 0 && (
          <Button variant="outline" onClick={handleRescan} disabled={loading}>
            Refrescar
          </Button>
        )}
      </Group>

      <GitChangesModal
        opened={opened}
        onClose={() => setOpened(false)}
        data={data}
        loading={loading}
      />
    </>
  );
}
