import { FieldsForm } from "@/components/FieldsForm";
import { GeneralInfo } from "@/components/generalInfo";
import { useManual } from "@/context/ManualContext";
import { Space, Title } from "@mantine/core";

export function FirstStep() {
  const { data, sections, setSections } = useManual();

  if (!data || !sections) {
    return <div>No hay información cargada.</div>;
  }

  return (
    <>
      <Title order={2}>Información general</Title>
      <Space my='xs'  />
      <FieldsForm sections={sections} onChange={setSections} />

      {data.piezasDetalladas.map((g: any, i: any) => (
        <GeneralInfo key={i} grupo={g} onUpdate={() => {}} />
      ))}
    </>
  );
}
