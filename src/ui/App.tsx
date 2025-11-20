// import { useState } from "react";
// import { Button } from "@/components/ui/button";
// import { parseDocxArrayBuffer } from "@/lib/docx-parser";
// import type {
//   ManualExtract,
//   UISection,
//   UIField,
//   FieldOption,
//   FieldKind,
// } from "@/types/manual";
// import { FieldsForm } from "@/components/FieldsForm";
// import { GeneralInfo } from "@/components/generalInfo";
// import { fillInfoGeneral } from "@/lib/docx-writer";
// import GitChangesButton from "@/components/ui/GitChangesButton";
// import type { RepoStatus } from "@/types/git";
// import { GitChangesModal } from "@/components/ui/GitChangesModal";

// export default function App() {
//   const [data, setData] = useState<ManualExtract | null>(null);
//   const [sections, setSections] = useState<UISection[] | null>(null);
//   const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);
//   const [gitModalOpen, setGitModalOpen] = useState(false);
//   const [gitLoading, setGitLoading] = useState(false);
//   const [gitData, setGitData] = useState<RepoStatus[]>([]);

//   function b64ToUint8(b64: string): Uint8Array {
//     const bin = atob(b64);
//     const out = new Uint8Array(bin.length);
//     for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
//     return out;
//   }

//   function anyToUint8(input: any): Uint8Array | null {
//     if (!input) return null;

//     // 1) Uint8Array directo
//     if (input instanceof Uint8Array) return input;

//     // 2) ArrayBuffer / SharedArrayBuffer
//     if (input instanceof ArrayBuffer) return new Uint8Array(input);

//     // 3) ArrayBufferView (TypedArray/DataView)
//     if (ArrayBuffer.isView(input))
//       return new Uint8Array((input as ArrayBufferView).buffer);

//     // 4) Buffer serializado { type:'Buffer', data:[...] }
//     if (input?.type === "Buffer" && Array.isArray(input.data))
//       return Uint8Array.from(input.data);

//     // 5) Objeto “array-like” con índices numéricos (por serialización)
//     //    p.ej. { '0': 80, '1': 75, '2': 3, ... length: N }
//     if (typeof input === "object") {
//       const keys = Object.keys(input);
//       const looksIndexed =
//         keys.length > 0 && keys.every((k) => /^\d+$/.test(k) || k === "length");
//       if (looksIndexed) {
//         const arr = Array.from(
//           { length: Number(input.length ?? keys.length) },
//           (_, i) => Number(input[i] ?? 0)
//         );
//         return Uint8Array.from(arr);
//       }
//     }

//     // 6) Si el main antiguo aún manda base64
//     if (typeof input === "string" && /^[A-Za-z0-9+/=]+$/.test(input))
//       return b64ToUint8(input);

//     return null;
//   }

//   async function handleOpen() {
//     try {
//       const res = await window.ipc.selectDocx();
//       if (!res) return;

//       const bytes =
//         anyToUint8((res as any).bytes) ??
//         anyToUint8((res as any).buffer) ??
//         anyToUint8((res as any).base64);
//       if (!bytes) throw new Error("No se recibió un buffer válido del IPC");

//       setTemplateBytes(bytes);

//       const parsed = await parseDocxArrayBuffer(bytes);

//       // ---------- helpers de normalización ----------
//       const normKey = (s: string) =>
//         (s || "")
//           .toLowerCase()
//           .normalize("NFD")
//           .replace(/[\u0300-\u036f]/g, "")
//           .replace(/\s+/g, " ")
//           .trim();

//       const COUNTRY_OPTIONS: Readonly<FieldOption[]> = [
//         { value: "REG", label: "Regional (REG)" },
//         { value: "HN", label: "Honduras (HN)" },
//         { value: "GT", label: "Guatemala (GT)" },
//         { value: "PA", label: "Panamá (PA)" },
//         { value: "NI", label: "Nicaragua (NI)" },
//       ] as const;

//       const toCountryCodes = (v: string | string[]): string[] => {
//         const raw = Array.isArray(v)
//           ? v
//           : String(v ?? "")
//               .split(/[,\s/;|]+/)
//               .filter(Boolean);

//         const out = new Set<string>();
//         for (const s0 of raw) {
//           const s = normKey(s0).toUpperCase();
//           if (s.includes("HONDURAS") || /\bHN\b/.test(s)) out.add("HN");
//           else if (s.includes("NICARAGUA") || /\bNI\b/.test(s)) out.add("NI");
//           else if (s.includes("GUATEMALA") || /\bGT\b/.test(s)) out.add("GT");
//           else if (
//             s.includes("PANAMA") ||
//             s.includes("PANAMÁ") ||
//             /\bPA\b/.test(s)
//           )
//             out.add("PA");
//           else if (s.includes("REG")) out.add("REG");
//           else {
//             const m = s0.match(/\(([A-Z]{2,3})\)\s*$/);
//             const code = m?.[1];
//             if (code && ["REG", "HN", "GT", "PA", "NI"].includes(code))
//               out.add(code);
//           }
//         }
//         return Array.from(out.size ? out : ["REG"]);
//       };

//       const asYesNo = (v: unknown) => {
//         const u = String(v ?? "")
//           .toUpperCase()
//           .replace("SÍ", "SI");
//         return u === "SI" ? "SI" : "NO";
//       };

//       // ---------- 1) dedup por id ----------
//       const dedup: UISection[] = Array.from(
//         (parsed.seccionesReconocidas || [])
//           .reduce((m, s) => {
//             m.set(s.id, s);
//             return m;
//           }, new Map<string, UISection>())
//           .values()
//       );

//       // ---------- 2) normalización tipada ----------
//       const norm: UISection[] = dedup.map((sec) => {
//         if (sec.id !== "informacion-general") return sec;

//         const fields: UIField[] = sec.fields.map((f0) => {
//           const key = normKey(f0.key);

//           // País afectado -> multiselect + string[]
//           if (key.includes("pais-afectado") || key.includes("país-afectado")) {
//             return {
//               key: f0.key,
//               label: f0.label,
//               kind: "multiselect" as const,
//               options: [...COUNTRY_OPTIONS],
//               value: toCountryCodes(f0.value as any),
//             };
//           }

//           // Otros -> text, quitar prefijo "Otros:"
//           if (key === "otros" || key === "otros:") {
//             const txt = typeof f0.value === "string" ? f0.value : "";
//             let clean = txt.replace(/^\s*otros\s*:?\s*/i, "");
//             if (/^\s*[:]*\s*$/.test(clean)) clean = ""; // si quedó solo ":" o espacios
//             return {
//               key: f0.key,
//               label: f0.label,
//               kind: "text" as const,
//               value: clean,
//             };
//           }

//           // SI/NO
//           const isYesNo =
//             key.includes("afecta dwh") ||
//             key.includes("afecta-dwh") ||
//             key.includes("afecta cierre") ||
//             key.includes("afecta-cierre") ||
//             key.includes("afecta robot") ||
//             key.includes("afecta-robot") ||
//             key.includes("notifico al noc") ||
//             key.includes("notificó al noc") ||
//             key.includes("notifico-al-noc") ||
//             key.includes("es regulatorio") ||
//             key.includes("es-regulatorio") ||
//             key.includes("participa proveedor") ||
//             key.includes("participa-proveedor");

//           if (isYesNo) {
//             return {
//               key: f0.key,
//               label: f0.label,
//               kind: "select" as const,
//               options: [
//                 { value: "SI", label: "SI" },
//                 { value: "NO", label: "NO" },
//               ],
//               value: asYesNo(f0.value),
//             };
//           }

//           // ID de Cambio / Tipo de Requerimiento -> text
//           if (key.includes("id-cambio") || key.includes("id de cambio")) {
//             return {
//               key: f0.key,
//               label: f0.label,
//               kind: "text" as const,
//               value: String(f0.value ?? ""),
//             };
//           }
//           if (
//             key.includes("tipo-requerimiento") ||
//             key.includes("tipo de requerimiento")
//           ) {
//             return {
//               key: f0.key,
//               label: f0.label,
//               kind: "text" as const,
//               value: String(f0.value ?? ""),
//             };
//           }

//           // Por defecto: conserva tipo si encaja, si no, lo tratamos como text
//           const kind: FieldKind =
//             f0.kind === "select" ||
//             f0.kind === "multiselect" ||
//             f0.kind === "text"
//               ? (f0.kind as FieldKind)
//               : ("text" as const);

//           return {
//             key: f0.key,
//             label: f0.label,
//             kind,
//             options: f0.options,
//             value: f0.value as any,
//           };
//         });

//         return { ...sec, fields };
//       });

//       setData(parsed);
//       setSections(norm); // <-- ahora sí coincide con UISection[]
//     } catch (e: any) {
//       console.error(e);
//       alert(e.message ?? String(e));
//     }
//   }

//   async function handleExport() {
//     try {
//       if (!templateBytes) throw new Error("Primero carga un DOCX.");
//       if (!sections || sections.length === 0)
//         throw new Error("No hay datos de Información general para exportar.");

//       // Genera un DOCX nuevo con la Info General rellenada
//       const out = await fillInfoGeneral(templateBytes, sections);

//       // Pide ruta de guardado y escribe el archivo
//       await window.ipc.saveDocx(out, "Manual-actualizado.docx");
//       alert("Documento exportado");
//     } catch (e: any) {
//       console.error(e);
//       alert(e.message ?? String(e));
//     }
//   }

//   return (
//     <main className="min-h-screen w-screen">
//       <div className="max-w-6xl mx-auto p-6 space-y-6">
//         <div className="flex gap-3 flex-wrap">
//           <Button onClick={handleOpen}>Importar</Button>
//           <Button onClick={handleExport}>Exportar</Button>

//           <GitChangesButton
//             onOpen={({ statuses }) => {
//               setGitData(Array.isArray(statuses) ? statuses : []);
//               setGitModalOpen(true);
//             }}
//             onLoadingChange={setGitLoading}
//           />
//         </div>

//         {data && sections && (
//           <>
//             <FieldsForm sections={sections} onChange={setSections} />
//             {data.piezasDetalladas.map((g, i) => (
//               <GeneralInfo key={i} grupo={g} onUpdate={() => {}} />
//             ))}
//           </>
//         )}
//       </div>

//       {/* 👇 Modal centrado, independiente del árbol del botón */}
//       <GitChangesModal
//         opened={gitModalOpen}
//         onClose={() => setGitModalOpen(false)}
//         data={gitData}
//         loading={gitLoading}
//       />
//     </main>
//   );
// }

import { AppShell } from "@mantine/core";
import { HeaderMenu } from "./components/HeaderMenu";
import { Outlet } from "react-router-dom";

const App = () => {

  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
    >
      <AppShell.Header>
        <HeaderMenu />
      </AppShell.Header>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};

export default App;
