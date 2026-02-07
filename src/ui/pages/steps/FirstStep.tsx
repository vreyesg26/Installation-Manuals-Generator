import { FieldsForm } from "@/components/FieldsForm";
import { useManual } from "@/context/ManualContext";
import { Divider, Title } from "@mantine/core";

export function FirstStep() {
  const { sections, setSections } = useManual();

  if (!sections) {
    return <div>No hay información cargada.</div>;
  }

  return (
    <>
      <Title order={2}>Información general</Title>
      <Divider my="sm" />
      <FieldsForm sections={sections} onChange={setSections} />
    </>
  );
}
