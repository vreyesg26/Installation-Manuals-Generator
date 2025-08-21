import {
  Modal,
  Tabs,
  Group,
  Text,
  Badge,
  Loader,
  ScrollArea,
} from "@mantine/core";
import type { RepoStatus, RepoChange } from "@/types/git";

function changeLabel(ch: RepoChange) {
  if (ch.kind === "renamed" && ch.renameFrom)
    return `renamed: ${ch.renameFrom} → ${ch.path}`;
  return `${ch.kind}: ${ch.path}`;
}

export function GitChangesModal({
  opened,
  onClose,
  data,
  loading,
}: {
  opened: boolean;
  onClose: () => void;
  data: RepoStatus[];
  loading?: boolean;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Cambios por repositorio"
      size="lg"
    >
      {loading ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : (
        <Tabs defaultValue={data[0]?.repoPath}>
          <Tabs.List>
            {data.map((repo) => (
              <Tabs.Tab key={repo.repoPath} value={repo.repoPath}>
                <Group gap="xs">
                  <Text fw={600}>{repo.repoName}</Text>
                  {repo.branch && <Badge variant="light">{repo.branch}</Badge>}
                  {repo.ahead || repo.behind ? (
                    <Badge variant="outline">
                      ↑{repo.ahead ?? 0} ↓{repo.behind ?? 0}
                    </Badge>
                  ) : null}
                  <Badge color={repo.changes.length ? "blue" : "gray"}>
                    {repo.changes.length}
                  </Badge>
                </Group>
              </Tabs.Tab>
            ))}
          </Tabs.List>

          {data.map((repo) => (
            <Tabs.Panel key={repo.repoPath} value={repo.repoPath} pt="md">
              <ScrollArea h={420} type="hover">
                {repo.changes.length === 0 ? (
                  <Text c="dimmed">Sin cambios detectados</Text>
                ) : (
                  repo.changes.map((ch, i) => (
                    <Group key={i} justify="space-between" py={6}>
                      <Group gap="xs">
                        <Badge variant="dot">{ch.ext || "∅"}</Badge>
                        <Text>{changeLabel(ch)}</Text>
                      </Group>
                      <Group gap="xs">
                        {ch.conflicted && <Badge color="red">conflict</Badge>}
                        <Badge variant="outline">index:{ch.index || " "}</Badge>
                        <Badge variant="outline">wt:{ch.worktree || " "}</Badge>
                      </Group>
                    </Group>
                  ))
                )}
              </ScrollArea>
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </Modal>
  );
}
