import { useEffect, useMemo, useState } from "react";
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
  Checkbox,
  TextInput,
  Button,
  Stack,
} from "@mantine/core";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import type { RepoStatus, RepoChange } from "@/types/git";
import { mainColor } from "@/lib/utils";

const COPY_ABSOLUTE = false;

function kindToLabel(kind: string) {
  switch (kind) {
    case "modified":
      return "modified";
    case "new":
      return "new";
    case "deleted":
      return "deleted";
    case "untracked":
      return "untracked";
    case "renamed":
      return "renamed";
    case "copied":
      return "copied";
    case "unknown":
      return "nuevo";
    default:
      return kind;
  }
}

function changeLabel(ch: RepoChange) {
  if (ch.kind === "renamed" && ch.renameFrom)
    return `renamed: ${ch.renameFrom} → ${ch.path}`;
  return `${kindToLabel(ch.kind)}: ${ch.path}`;
}

function joinFs(a: string, b: string) {
  if (!a) return b;
  const sep = a.includes("\\") ? "\\" : "/";
  return a.replace(/[\\/]+$/, "") + sep + b.replace(/^[\\/]+/, "");
}

type GitChangesModalProps = {
  opened: boolean;
  onClose: () => void;
  data: RepoStatus[];
  loading?: boolean;
  onCreate?: (payload: {
    repo: RepoStatus;
    changes: RepoChange[];
    groupName: string;
  }) => void;
};

type SelectedMap = Record<string, Set<number>>;

export function GitChangesModal({
  opened,
  onClose,
  data,
  loading,
  onCreate,
}: GitChangesModalProps) {
  const hasRepos = Array.isArray(data) && data.length > 0;

  const [activeRepoPath, setActiveRepoPath] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<SelectedMap>({});

  useEffect(() => {
    if (!hasRepos) {
      setActiveRepoPath(null);
      setGroupName("");
      setSelected({});
      return;
    }

    const first = data[0];
    setActiveRepoPath(first.repoPath);
    setGroupName(first.repoName || "");

    const initial: SelectedMap = {};
    for (const repo of data) {
      const set = new Set<number>();
      repo.changes.forEach((ch, idx) => {
        if (
          ch.kind === "unknown" ||
          ch.kind === "modified" ||
          ch.kind === "renamed"
        ) {
          set.add(idx);
        }
      });
      initial[repo.repoPath] = set;
    }
    setSelected(initial);
  }, [opened, hasRepos, data]);

  const activeRepo = useMemo(
    () => data.find((r) => r.repoPath === activeRepoPath) || null,
    [data, activeRepoPath]
  );

  function toggleChange(repoPath: string, index: number, checked: boolean) {
    setSelected((prev) => {
      const current = new Set(prev[repoPath] ?? []);
      if (checked) current.add(index);
      else current.delete(index);
      return { ...prev, [repoPath]: current };
    });
  }

  function handleCreate() {
    if (!onCreate || !activeRepo) {
      onClose();
      return;
    }

    const indices = selected[activeRepo.repoPath] ?? new Set<number>();
    const chosen = activeRepo.changes.filter((_, i) => indices.has(i));
    if (chosen.length === 0) {
      onClose();
      return;
    }

    const name = groupName.trim() || activeRepo.repoName || "Piezas detalladas";

    onCreate({
      repo: activeRepo,
      changes: chosen.map((ch) => ({
        ...ch,
        kind: ch.kind === "unknown" ? "added" : ch.kind,
      })),
      groupName: name,
    });

    onClose();
  }

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
      color={mainColor}
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
        <Stack gap="md">
          <Tabs
            value={activeRepoPath ?? data[0].repoPath}
            onChange={(val) => setActiveRepoPath(val)}
            color={mainColor}
          >
            <Tabs.List>
              {data.map((repo) => (
                <Tabs.Tab key={repo.repoPath} value={repo.repoPath}>
                  <Group gap="xs">
                    <Text fw={600}>{repo.repoName}</Text>
                    {repo.branch && (
                      <Badge variant="light" color={mainColor}>
                        {repo.branch}
                      </Badge>
                    )}
                    {repo.ahead || repo.behind ? (
                      <Badge variant="outline" color={mainColor}>
                        ↑{repo.ahead ?? 0} ↓{repo.behind ?? 0}
                      </Badge>
                    ) : null}
                    <Badge color={repo.changes.length ? mainColor : "gray"}>
                      {repo.changes.length}
                    </Badge>
                  </Group>
                </Tabs.Tab>
              ))}
            </Tabs.List>

            {data.map((repo) => {
              const selectedSet = selected[repo.repoPath] ?? new Set<number>();

              return (
                <Tabs.Panel key={repo.repoPath} value={repo.repoPath} pt="md">
                  <ScrollArea h={340} type="hover">
                    {repo.changes.length === 0 ? (
                      <Text c="dimmed">Sin cambios detectados</Text>
                    ) : (
                      repo.changes.map((ch, i) => {
                        const pathToCopy = COPY_ABSOLUTE
                          ? joinFs(repo.repoPath, ch.path)
                          : ch.path;

                        const checked = selectedSet.has(i);

                        return (
                          <Group
                            key={i}
                            justify="space-between"
                            py={6}
                            align="center"
                          >
                            <Group gap="xs" align="center">
                              <Checkbox
                                checked={checked}
                                onChange={(e) =>
                                  toggleChange(
                                    repo.repoPath,
                                    i,
                                    e.currentTarget.checked
                                  )
                                }
                                color={mainColor}
                              />
                              <Badge
                                variant="dot"
                                color={
                                  ch.kind === "unknown" ? "green" : "orange"
                                }
                              >
                                {ch.ext || "∅"}
                              </Badge>
                              <Text>{changeLabel(ch)}</Text>
                              {ch.conflicted && (
                                <Badge color="red">conflict</Badge>
                              )}
                            </Group>

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
                        );
                      })
                    )}
                  </ScrollArea>
                </Tabs.Panel>
              );
            })}
          </Tabs>

          <Group justify="space-between" mt="sm" gap="xs" align="center">
            <TextInput
              placeholder="Nombre de la tabla"
              value={groupName}
              onChange={(e) => setGroupName(e.currentTarget.value)}
              style={{ flexGrow: 1 }}
            />
            <Button
              onClick={handleCreate}
              disabled={!activeRepo}
              color={mainColor}
            >
              Crear tabla
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
