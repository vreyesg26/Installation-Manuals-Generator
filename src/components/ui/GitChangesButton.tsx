import { useState } from "react";
import { Button } from "@mantine/core";
import { IconBrandGithub, IconRefresh } from "@tabler/icons-react";
import type { GithubChangesProps } from "@/types/manual";

export default function GitChangesButton({
  onOpen,
  onLoadingChange,
}: GithubChangesProps) {
  const [loading, setLoading] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);

  const setBusy = (v: boolean) => {
    setLoading(v);
    onLoadingChange?.(v);
  };

  const handlePickManual = async () => {
    setBusy(true);
    try {
      const picks = await window.ipc.pickRepos();
      const paths = (picks ?? []).map((p: any) => p.repoPath);
      if (!paths.length) return;
      setRepos(paths);

      const statuses = await window.ipc.scan(paths);
      onOpen({ statuses: statuses ?? [], repos: paths });
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRescan = async () => {
    if (!repos.length) return;
    setBusy(true);
    try {
      const statuses = await window.ipc.scan(repos);
      console.log(statuses);
      onOpen({ statuses: statuses ?? [], repos });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        leftSection={<IconBrandGithub size="1.1rem" />}
        onClick={handlePickManual}
        disabled={loading}
        color="violet"
      >
        Github
      </Button>
      {repos.length > 0 && (
        <Button
          leftSection={<IconRefresh />}
          onClick={handleRescan}
          disabled={loading}
          variant="outline"
          color="violet"
        >
          Refrescar
        </Button>
      )}
    </>
  );
}
