// src/types/manual.ts
export type FieldKind = "text" | "select" | "multiselect";

export interface FieldOption {
  label: string;
  value: string;
}

export type FieldValue = string | string[]; // 👈 clave

export interface UIField {
  key: string;                // id interno, p.ej. "id-cambio"
  label: string;              // etiqueta visible
  kind: FieldKind;            // "text" | "select" | "multiselect"
  value: FieldValue;          // 👈 ahora puede ser string o string[]
  options?: FieldOption[];    // usado por select y multiselect
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

export type GitStatus = "Nuevo" | "Modificado" | "Renombrado" | "Eliminado" | "Desconocido";

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
