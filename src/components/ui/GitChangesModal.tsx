import {
  Modal,
  Tabs,
  Group,
  Text,
  Badge,
  Loader,
  ScrollArea,
  CopyButton,
  Tooltip,
  ActionIcon,
} from "@mantine/core";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import type { RepoStatus, RepoChange } from "@/types/git";

const COPY_ABSOLUTE = false;

function changeLabel(ch: RepoChange) {
  if (ch.kind === "renamed" && ch.renameFrom)
    return `renamed: ${ch.renameFrom} → ${ch.path}`;
  return `${ch.kind}: ${ch.path}`;
}

function joinFs(a: string, b: string) {
  if (!a) return b;
  const sep = a.includes("\\") ? "\\" : "/";
  return a.replace(/[\\/]+$/, "") + sep + b.replace(/^[\\/]+/, "");
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
  const hasRepos = Array.isArray(data) && data.length > 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Listado de fuentes afectados"
      size="lg"
      radius="md"
      centered
      withinPortal={false}
      zIndex={10000}
      overlayProps={{ opacity: 0.55, blur: 3 }}
      withCloseButton
      returnFocus
      trapFocus
    >
      {loading ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : !hasRepos ? (
        <Group justify="center" p="xl">
          <Text c="dimmed">
            No se encontraron repositorios o no hay cambios para mostrar.
          </Text>
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
                  repo.changes.map((ch, i) => {
                    const pathToCopy = COPY_ABSOLUTE
                      ? joinFs(repo.repoPath, ch.path)
                      : ch.path;

                    return (
                      <Group key={i} justify="space-between" py={6}>
                        <Group gap="xs">
                          <Badge variant="dot">{ch.ext || "∅"}</Badge>
                          <Text>{changeLabel(ch)}</Text>
                        </Group>
                        <Group gap="xs">
                          {ch.conflicted && <Badge color="red">conflict</Badge>}

                          <CopyButton value={pathToCopy} timeout={2000}>
                            {({ copied, copy }) => (
                              <Tooltip
                                label={copied ? "Copiado" : "Copiar ruta"}
                                withArrow
                                position="left"
                              >
                                <ActionIcon
                                  color={copied ? "teal" : "gray"}
                                  variant="subtle"
                                  onClick={copy}
                                >
                                  {copied ? (
                                    <IconCheck size={16} />
                                  ) : (
                                    <IconCopy size={16} />
                                  )}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </Group>
                      </Group>
                    );
                  })
                )}
              </ScrollArea>
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </Modal>
  );
}
