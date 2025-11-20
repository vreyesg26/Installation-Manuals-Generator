import {
  ActionIcon,
  Flex,
  Group,
  Image,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import logo from "@/ui/assets/firedocs-logo.png";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

export function HeaderMenu() {
  const { setColorScheme, colorScheme } = useMantineColorScheme();
  const navigate = useNavigate();

  return (
    <Flex h="100%" px="lg" justify="space-between" align="center">
      <Group onClick={() => navigate('/')}>
        <Image src={logo} w={52} />
        <Title order={5}>FireDocs</Title>
      </Group>

      <Group>
        <Flex align="center" gap={10}>
          <Title order={5}>Banco Ficohsa</Title>
          <ActionIcon
            variant="default"
            size="lg"
            onClick={() =>
              setColorScheme(colorScheme === "dark" ? "light" : "dark")
            }
          >
            {colorScheme === "dark" ? (
              <IconSun size={20} stroke={1.5} />
            ) : (
              <IconMoon size={20} stroke={1.5} />
            )}
          </ActionIcon>
        </Flex>
      </Group>
    </Flex>
  );
}
