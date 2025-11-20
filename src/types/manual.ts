import type { RepoStatus } from "./git";

export type FieldKind = "text" | "select" | "multiselect";

export interface FieldOption {
  label: string;
  value: string;
}

export type FieldValue = string | string[];

export interface UIField {
  key: string; 
  label: string; 
  kind: FieldKind;
  value: FieldValue;
  options?: FieldOption[];
}

export interface UISection {
  id: string;
  title: string;
  fields: UIField[];
}

export interface PiezasItem {
  nombre: string;
  tipo: string;
  estado: "Nuevo" | "Modificado" | string;
}
export interface PiezasGrupo {
  grupo: string;
  items: PiezasItem[];
}

export interface KeyValueField {
  key: string;
  value: string;
}

export interface ManualExtract {
  camposDetectados: KeyValueField[];
  piezasDetalladas: PiezasGrupo[];
  seccionesReconocidas: UISection[];
  raw: { paragraphs: string[]; tables: string[][][] };
}

export type GitStatus =
  | "Nuevo"
  | "Modificado"
  | "Renombrado"
  | "Eliminado"
  | "Desconocido";

export interface GitFileChange {
  path: string;
  nombre: string;
  ext: string;
  tipo: string;
  estado: GitStatus;
}

export interface RepoChanges {
  repoName: string;
  repoPath: string;
  files: GitFileChange[];
}

export type FeatureKey = "existing" | "import";

export interface HomeFeatureProps {
  key: FeatureKey;
  title: string;
  description: string;
  icon: React.ElementType;
}

export interface StepsProps {
  key: string;
  label: string;
  description: string;
}

export type GithubChangesProps = {
  onOpen: (payload: { statuses: RepoStatus[]; repos: string[] }) => void;
  onLoadingChange?: (loading: boolean) => void;
};