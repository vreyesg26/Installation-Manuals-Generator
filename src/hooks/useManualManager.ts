import { useState } from "react";
import { parseDocxArrayBuffer } from "@/lib/docx-parser";
import { fillInfoGeneral } from "@/lib/docx-writer";
import type {
  ManualExtract,
  UISection,
  UIField,
  PiezasGrupo,
} from "@/types/manual";
import type { RepoStatus } from "@/types/git";
import { countryOptions } from "@/lib/constants";

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function anyToUint8(input: any): Uint8Array | null {
  if (!input) return null;
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input))
    return new Uint8Array((input as ArrayBufferView).buffer);

  if (input?.type === "Buffer" && Array.isArray(input.data))
    return Uint8Array.from(input.data);

  if (typeof input === "object") {
    const keys = Object.keys(input);
    const looksIndexed =
      keys.length > 0 && keys.every((k) => /^\d+$/.test(k) || k === "length");
    if (looksIndexed) {
      const arr = Array.from(
        { length: Number(input.length ?? keys.length) },
        (_, i) => Number(input[i] ?? 0)
      );
      return Uint8Array.from(arr);
    }
  }

  if (typeof input === "string" && /^[A-Za-z0-9+/=]+$/.test(input))
    return b64ToUint8(input);

  return null;
}

export function useManualManager() {
  const [data, setData] = useState<ManualExtract | null>(null);
  const [sections, setSections] = useState<UISection[] | null>(null);
  const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);

  const [gitModalOpen, setGitModalOpen] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitData, setGitData] = useState<RepoStatus[]>([]);

  const [detailedPieces, setDetailedPieces] = useState<PiezasGrupo[]>([]);

  async function handleOpen() {
    try {
      const res = await window.ipc.selectDocx();
      if (!res) return;

      const bytes =
        anyToUint8((res as any).bytes) ??
        anyToUint8((res as any).buffer) ??
        anyToUint8((res as any).base64);

      if (!bytes) throw new Error("No se recibió un buffer válido del IPC");

      setTemplateBytes(bytes);

      const parsed = await parseDocxArrayBuffer(bytes);

      const normKey = (s: string) =>
        (s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim();

      const toCountryCodes = (v: string | string[]) => {
        const raw = Array.isArray(v)
          ? v
          : String(v ?? "")
              .split(/[,\s/;|]+/)
              .filter(Boolean);

        const out = new Set<string>();
        for (const s0 of raw) {
          const s = normKey(s0).toUpperCase();
          if (s.includes("HONDURAS") || /\bHN\b/.test(s)) out.add("HN");
          else if (s.includes("NICARAGUA") || /\bNI\b/.test(s)) out.add("NI");
          else if (s.includes("GUATEMALA") || /\bGT\b/.test(s)) out.add("GT");
          else if (s.includes("PANAMA") || /\bPA\b/.test(s)) out.add("PA");
          else if (s.includes("REG")) out.add("REG");
        }
        return Array.from(out.size ? out : ["REG"]);
      };

      const asYesNo = (v: unknown) => {
        const u = String(v ?? "")
          .toUpperCase()
          .replace("SÍ", "SI");
        return u === "SI" ? "SI" : "NO";
      };

      const dedup: UISection[] = Array.from(
        (parsed.seccionesReconocidas || [])
          .reduce((m, s) => {
            m.set(s.id, s);
            return m;
          }, new Map<string, UISection>())
          .values()
      );

      const norm: UISection[] = dedup.map((sec) => {
        if (sec.id !== "informacion-general") return sec;

        const fields: UIField[] = sec.fields.map((f0) => {
          const key = normKey(f0.key);

          if (key.includes("pais-afectado"))
            return {
              key: f0.key,
              label: f0.label,
              kind: "multiselect",
              options: [...countryOptions],
              value: toCountryCodes(f0.value as any),
            };

          if (key === "otros" || key === "otros:") {
            const txt = typeof f0.value === "string" ? f0.value : "";
            let clean = txt.replace(/^\s*otros\s*:?\s*/i, "");
            if (/^\s*[:]*\s*$/.test(clean)) clean = "";
            return {
              key: f0.key,
              label: f0.label,
              kind: "text",
              value: clean,
            };
          }

          const isYesNo =
            key.includes("afecta dwh") ||
            key.includes("afecta cierre") ||
            key.includes("afecta robot") ||
            key.includes("notifico al noc") ||
            key.includes("es regulatorio") ||
            key.includes("participa proveedor");

          if (isYesNo)
            return {
              key: f0.key,
              label: f0.label,
              kind: "select",
              options: [
                { value: "SI", label: "SI" },
                { value: "NO", label: "NO" },
              ],
              value: asYesNo(f0.value),
            };

          return {
            key: f0.key,
            label: f0.label,
            kind: f0.kind ?? "text",
            options: f0.options,
            value: f0.value,
          };
        });

        return { ...sec, fields };
      });

      setData(parsed);
      setSections(norm);

      setDetailedPieces(parsed.piezasDetalladas ?? []);

      return true;
    } catch (e: any) {
      alert(e.message ?? String(e));
      return false;
    }
  }

  async function handleExport() {
    if (!templateBytes) throw new Error("Primero carga un DOCX.");
    if (!sections || sections.length === 0)
      throw new Error("No hay datos de Información general para exportar.");

    const out = await fillInfoGeneral(templateBytes, sections);
    await window.ipc.saveDocx(out, "Manual-actualizado.docx");
  }

  return {
    data,
    sections,
    detailedPieces,
    templateBytes,
    gitModalOpen,
    gitLoading,
    gitData,

    setSections,
    setDetailedPieces,
    setGitData,
    setGitModalOpen,
    setGitLoading,

    handleOpen,
    handleExport,
  };
}
