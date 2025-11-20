import { useState, useMemo } from "react";
import {
  Container,
  Progress,
  Group,
  Text,
  Stepper,
  Button,
  Box,
  Flex,
} from "@mantine/core";
import { steps } from "@/lib/constants";
import { FirstStep } from "./steps/FirstStep";
import { useManual } from "@/context/ManualContext";
import { SecondStep } from "./steps/SecondStep";
import {
  IconChevronLeft,
  IconChevronRight,
  IconFileUpload,
} from "@tabler/icons-react";

export default function StepsPage() {
  const { data, sections, handleExport } = useManual();
  const [active, setActive] = useState(0);
  const completed = active === steps.length;

  const percent = useMemo(
    () => Math.round((active / steps.length) * 100),
    [active]
  );

  const next = () => setActive((a) => Math.min(a + 1, steps.length));
  const prev = () => setActive((a) => Math.max(a - 1, 0));

  const renderStepContent = () => {
    const key = steps[active]?.key;

    switch (key) {
      case "general":
        return <FirstStep />;
      case "pieces":
        return <SecondStep />;
      default:
        return null;
    }
  };

  if (!data || !sections) {
    return (
      <Container>
        <Text>No hay datos cargados</Text>
      </Container>
    );
  }

  return (
    <Container fluid px="lg" py="md">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Progreso del manual</Text>
        <Text c="dimmed">{percent}%</Text>
      </Group>

      <Progress value={percent} size="lg" radius="xl" />

      <Box mt="xl" w="100%">
        <Stepper
          active={active}
          onStepClick={setActive}
          allowNextStepsSelect={false}
        >
          {steps.map((s, i) => (
            <Stepper.Step key={i} label={s.label} />
          ))}

          <Stepper.Completed>
            <Text ta="center" c="dimmed">
              Manual completado
            </Text>
          </Stepper.Completed>
        </Stepper>
      </Box>

      <Box mt="xl">{renderStepContent()}</Box>

      <Group justify="space-between" mt="xl">
        <Button
          leftSection={<IconChevronLeft size="1.1rem" />}
          variant="default"
          onClick={prev}
          disabled={active === 0}
        >
          Atrás
        </Button>

        <Flex gap="xs">
          <Button
            leftSection={<IconFileUpload size="1.1rem" />}
            onClick={handleExport}
            variant="outline"
          >
            Exportar
          </Button>
          <Button
            rightSection={<IconChevronRight size="1.1rem" />}
            onClick={next}
            disabled={completed}
          >
            {completed
              ? "Listo"
              : active < steps.length - 1
              ? "Siguiente"
              : "Finalizar"}
          </Button>
        </Flex>
      </Group>
    </Container>
  );
}
