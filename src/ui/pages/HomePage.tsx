import {
  Badge,
  Card,
  Center,
  Container,
  Group,
  SimpleGrid,
  Text,
  Title,
  useMantineTheme,
} from "@mantine/core";
import classes from "./HomePage.module.css";
import { mainButtonsData } from "@/lib/constants";
import { useNavigate } from "react-router-dom";
import { useManual } from "@/context/ManualContext";

export default function HomePage() {
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const { handleOpen } = useManual();

  const onImportClick = async () => {
    const ok = await handleOpen();
    if (ok) navigate("/import");
  };

  const features = mainButtonsData.map((feature) => (
    <Card
      key={feature.title}
      shadow="md"
      radius="md"
      className={classes.card}
      padding="xl"
      onClick={feature.key === "import" ? onImportClick : undefined}
    >
      <feature.icon size={50} stroke={1.5} color={theme.colors.blue[6]} />
      <Text fz="lg" fw={500} className={classes.cardTitle} mt="md">
        {feature.title}
      </Text>
      <Text fz="sm" c="dimmed" mt="sm">
        {feature.description}
      </Text>
    </Card>
  ));

  return (
    <Center style={{ minHeight: "100vh" }}>
      <Container strategy="grid" size="lg" py="xl" fluid>
        <Group justify="center" gap='xs'>
          <Badge variant="filled" size="lg">
            FireDocs
          </Badge>
          <Text size='sm'>Version beta 1.0</Text>
        </Group>

        <Title order={2} className={classes.title} ta="center" mt="sm">
          Manuales de instalación automatizados
        </Title>

        <Text c="dimmed" className={classes.description} ta="center" mt="md">
          Este sistema te permite crear manuales de instalación de manera rápida
          y sencilla, optimizando su tiempo y recursos.
        </Text>
        <SimpleGrid
          cols={{ base: 1, sm: 1, md: 2, lg: 2 }}
          spacing="sm"
          mt={50}
        >
          {features}
        </SimpleGrid>
      </Container>
    </Center>
  );
}
