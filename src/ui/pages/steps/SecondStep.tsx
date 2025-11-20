import { useState } from "react";
import { Flex, Space, Title } from "@mantine/core";
import GitChangesButton from "@/components/ui/GitChangesButton";
import { GitChangesModal } from "@/components/ui/GitChangesModal";
import { useManual } from "@/context/ManualContext";
import type { RepoStatus } from "@/types/git";

export const SecondStep = () => {
  const {} = useManual();
  const [gitModalOpen, setGitModalOpen] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitData, setGitData] = useState<RepoStatus[]>([]);

  return (
    <>
      <Flex align="center" justify="space-between">
        <Title order={2}>Piezas detalladas</Title>
        <Space my="xs" />
        <Flex align="center" gap="xs">
          <GitChangesButton
            onOpen={({ statuses }) => {
              setGitData(statuses);
              setGitModalOpen(true);
            }}
            onLoadingChange={(loading) => setGitLoading(loading)}
          />
        </Flex>
      </Flex>
      <GitChangesModal
        opened={gitModalOpen}
        onClose={() => setGitModalOpen(false)}
        data={gitData}
        loading={gitLoading}
      />
    </>
  );
};
