import { useEffect, useState } from "react";
import {
  Button,
  Divider,
  Flex,
  SimpleGrid,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import GitChangesButton from "@/components/ui/GitChangesButton";
import { GitChangesModal } from "@/components/ui/GitChangesModal";
import { useManual } from "@/context/ManualContext";
import type { RepoStatus, RepoChange } from "@/types/git";
import type { PiezasGrupo, PiezasItem } from "@/types/manual";
import { IconEdit } from "@tabler/icons-react";
import { mainColor } from "@/lib/utils";

export const SecondStep = () => {
  const { data, detailedPieces, setDetailedPieces } = useManual();
  console.log("🟣 SecondStep detailedPieces:", detailedPieces);
  const [gitModalOpen, setGitModalOpen] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitData, setGitData] = useState<RepoStatus[]>([]);

  const groups = detailedPieces || [];

  useEffect(() => {
    if (data?.detailedPieces?.length && !groups.length) {
      setDetailedPieces(data.detailedPieces);
    }
  }, [data, groups.length, setDetailedPieces]);

  function mapChangeToItem(ch: RepoChange): PiezasItem {
    const name = ch.path.split(/[\\/]/).pop() || ch.path || "Objeto sin nombre";

    const ext = ch.ext || name.split(".").pop() || "";
    const tipo = ext ? ext.toUpperCase() : "Archivo";

    let estado: string = "Modificado";
    if (ch.kind === "added") estado = "Nuevo";
    else if (ch.kind === "modified") estado = "Modificado";
    else if (ch.kind === "deleted") estado = "Eliminado";
    else if (ch.kind === "renamed") estado = "Modificado";

    return {
      nombre: name,
      tipo,
      estado,
    };
  }

  return (
    <>
      <Flex align="center" justify="space-between">
        <Title order={2}>Piezas detalladas</Title>
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

      <Divider my="sm" />

      {groups.length === 0 ? (
        <Text c="dimmed" mt="md">
          Aún no has creado tablas de piezas detalladas. Pulsa el botón
          &quot;Github&quot; para importar cambios desde tus repositorios.
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
          {groups.map((grupo: PiezasGrupo, index: number) => (
            <Flex key={grupo.grupo + index} direction="column" gap="xs">
              <Flex gap="xs" align="center" justify="space-between">
                <Flex gap="xs" align="center">
                  <ThemeIcon radius="sm" color={mainColor}>
                    <Text fw={700}>{index + 1}</Text>
                  </ThemeIcon>
                  <Text>{grupo.grupo}</Text>
                </Flex>
                <Button
                  variant="filled"
                  leftSection={<IconEdit size="1.1rem" />}
                  color={mainColor}
                  disabled
                >
                  Editar
                </Button>
              </Flex>

              <Table withTableBorder withColumnBorders striped>
                <Table.Thead bg={mainColor} c="white">
                  <Table.Tr>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th>Nuevo o modificado</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {grupo.items.map((item, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{item.nombre}</Table.Td>
                      <Table.Td>{item.tipo}</Table.Td>
                      <Table.Td>{item.estado}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Flex>
          ))}
        </SimpleGrid>
      )}

      <GitChangesModal
        opened={gitModalOpen}
        onClose={() => setGitModalOpen(false)}
        data={gitData}
        loading={gitLoading}
        onCreate={({ repo, changes, groupName }) => {
          const items: PiezasItem[] = changes.map(mapChangeToItem);

          const newGroup: PiezasGrupo = {
            grupo:
              groupName ||
              repo.repoName ||
              `Grupo ${groups.length + 1}`,
            items,
          };

          setDetailedPieces((prev: any) => [...prev, newGroup]);
        }}
      />
    </>
  );
};
