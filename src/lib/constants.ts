import { IconFileTypeDocx, IconUpload } from "@tabler/icons-react";
import type { FieldOption, HomeFeatureProps, StepsProps } from "@/types/manual";

export const steps: StepsProps[] = [
  { key: "general", label: "Paso 1", description: "Información general" },
  { key: "pieces", label: "Paso 2", description: "Piezas detalladas" },
  { key: "services", label: "Paso 3", description: "Listar áreas y servicios" },
  {
    key: "repos",
    label: "Paso 4",
    description: "Repositorios y matriz de comunicación",
  },
  { key: "prevsteps", label: "Paso 5", description: "Describir pasos previos" },
  { key: "backup", label: "Paso 6", description: "Respaldo de objetos" },
  { key: "installation", label: "Paso 7", description: "Pasos de instalación" },
  { key: "reverse", label: "Paso 8", description: "Pasos de reversión" },
];

export const mainButtonsData: HomeFeatureProps[] = [
  {
    key: "existing",
    title: "Usar plantilla existente",
    description:
      "Aquí podrás seleccionar una de las plantillas predefinidas para comenzar rápidamente con la creación de tu manual de usuario desde 0.",
    icon: IconFileTypeDocx,
  },
  {
    key: "import",
    title: "Importar nueva plantilla",
    description:
      "Si ya tienes una plantilla personalizada, puedes importarla fácilmente para adaptarla y mejorarla según tus necesidades.",
    icon: IconUpload,
  },
];

export const countryOptions: Readonly<FieldOption[]> = [
  { value: "REG", label: "Regional (REG)" },
  { value: "HN", label: "Honduras (HN)" },
  { value: "GT", label: "Guatemala (GT)" },
  { value: "PA", label: "Panamá (PA)" },
  { value: "NI", label: "Nicaragua (NI)" },
];
