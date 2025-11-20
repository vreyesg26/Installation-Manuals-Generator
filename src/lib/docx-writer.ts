// src/lib/docx-writer.ts
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  evaluateXPathToFirstNode,
  evaluateXPathToNodes,
  evaluateXPathToNumber,
} from "fontoxpath";
import type { UISection } from "@/types/manual";

/* ============================== Namespaces ============================== */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const nsResolver = (prefix: string | null) => (prefix === "w" ? W_NS : null);

/* ============================= XPath helpers ============================ */

function xpNode(xpath: string, ctx: Node | null): Node | null {
  if (!ctx) return null;
  return evaluateXPathToFirstNode(xpath, ctx, null, null, {
    namespaceResolver: nsResolver,
  });
}
function xpNodes(xpath: string, ctx: Node | null): Node[] {
  if (!ctx) return [];
  return evaluateXPathToNodes(xpath, ctx, null, null, {
    namespaceResolver: nsResolver,
  }) as Node[];
}
function xpNum(xpath: string, ctx: Node | null): number {
  if (!ctx) return 0;
  const n = evaluateXPathToNumber(xpath, ctx, null, null, {
    namespaceResolver: nsResolver,
  });
  return Number.isFinite(n) ? (n as number) : 0;
}

/* ============================ Text utilities ============================ */

function getTextDeep(n: Node | null): string {
  if (!n) return "";
  const ts = xpNodes(".//w:t", n);
  return ts
    .map((t) =>
      ((t as Element).textContent || "").replace(/\u00A0/g, " ").trim()
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Escribe texto dentro de la celda sin tocar estructura:
 * - Usa el PRIMER <w:p> existente.
 * - Si ese <w:p> no tiene <w:r>/<w:t>, los crea dentro de ese mismo <w:p>.
 * - No cambia alineación ni spacing si el párrafo ya existía.
 */
function setCellTextKeepParagraph(
  tc: Node | null,
  text: string,
  doc: Document
) {
  if (!tc) return;

  let p = xpNode("./w:p[1]", tc);
  if (!p) {
    // Celda totalmente vacía: creamos un p mínimo.
    p = (tc as Element).appendChild(doc.createElementNS(W_NS, "w:p"));
  }

  let r = xpNode("./w:r[1]", p);
  if (!r) r = (p as Element).appendChild(doc.createElementNS(W_NS, "w:r"));

  let t = xpNode("./w:t[1]", r);
  if (!t) t = (r as Element).appendChild(doc.createElementNS(W_NS, "w:t"));

  (t as Element).textContent = text;
  try {
    (t as Element).setAttribute("xml:space", "preserve");
  } catch {}
}

function normalizeKey(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function sameKey(a: string, b: string) {
  return normalizeKey(a) === normalizeKey(b);
}
function valOf(sections: UISection[], key: string, def = ""): string {
  for (const s of sections) {
    const f = s.fields.find((x) => sameKey(x.key, key));
    if (f) return ((f.value as any) ?? "").toString().trim();
  }
  return def;
}
function valOfAny(sections: UISection[], keys: string[], def = ""): string {
  for (const k of keys) {
    const v = valOf(sections, k);
    if (v !== "") return v;
  }
  return def;
}
function yn(v: string): "SI" | "NO" {
  const u = (v || "").toUpperCase().replace("SÍ", "SI");
  return u === "SI" ? "SI" : "NO";
}

/* ===================== localizar filas/columnas (JS) ==================== */

function findTableByRowLabel(root: Document, needle: string): Node | null {
  const tables = xpNodes("//w:tbl", root);
  for (const tbl of tables) {
    const rows = xpNodes(".//w:tr", tbl);
    for (const tr of rows) {
      const txt = getTextDeep(tr);
      if (txt.includes(needle)) return tbl;
    }
  }
  return null;
}

function findRowInTableByText(table: Node, containsText: string): Node | null {
  const rows = xpNodes(".//w:tr", table);
  for (const tr of rows) {
    if (getTextDeep(tr).includes(containsText)) return tr;
  }
  return null;
}

function findColumnIndexByHeader(headerRow: Node, headerText: string): number {
  const cells = xpNodes("./w:tc", headerRow);
  for (let i = 0; i < cells.length; i++) {
    const txt = getTextDeep(cells[i]);
    if (txt.includes(headerText)) return i + 1;
  }
  return 0;
}

function findRespuestaColumnIndex(table: Node): number {
  const rows = xpNodes(".//w:tr", table);
  for (const tr of rows) {
    const txt = getTextDeep(tr);
    if (
      txt.includes("Afectación a otras áreas") &&
      txt.includes("Respuesta: SI/NO")
    ) {
      const idx = findColumnIndexByHeader(tr, "Respuesta: SI/NO");
      if (idx > 0) return idx;
    }
  }
  const anyRow = xpNode(".//w:tr[1]", table);
  const cols = anyRow ? xpNum("count(./w:tc)", anyRow) : 0;
  return cols > 0 ? cols : 0;
}

/* ================== escritores para SI/NO, Otros, País =================== */

function setYesNoByLabel(
  doc: Document,
  root: Document,
  labelContains: string,
  value: "SI" | "NO"
) {
  const table = findTableByRowLabel(root, labelContains);
  if (!table) return;

  const row = findRowInTableByText(table, labelContains);
  if (!row) return;

  const respuestaCol = findRespuestaColumnIndex(table);
  if (!respuestaCol) return;

  const cells = xpNodes("./w:tc", row);
  const targetCell = cells[respuestaCol - 1] ?? cells[cells.length - 1] ?? null;

  setCellTextKeepParagraph(targetCell, value, doc);
}

function setOtros(doc: Document, root: Document, value: string) {
  const table = findTableByRowLabel(root, "Otros");
  if (!table) return;
  const row = findRowInTableByText(table, "Otros");
  if (!row) return;

  const cells = xpNodes("./w:tc", row);
  if (cells.length >= 2) {
    setCellTextKeepParagraph(cells[1], value, doc);
  } else if (cells.length >= 1) {
    const first = cells[0];
    const current = getTextDeep(first);
    const newText = /^\s*Otros\s*:?\s*/i.test(current)
      ? current.replace(/^\s*Otros\s*:?\s*/i, `Otros: ${value}`)
      : `Otros: ${value}`;
    setCellTextKeepParagraph(first, newText, doc);
  }
}

/* -------------------- País afectado: múltiple, sin cambiar altura ------ */

type CountryCode = "REG" | "HN" | "GT" | "PA" | "NI";

function toCountryCodes(input: string | string[]): CountryCode[] {
  const raw = Array.isArray(input)
    ? input
    : String(input)
        .split(/[,\s/;|]+/)
        .filter(Boolean);

  const out = new Set<CountryCode>();
  for (const s0 of raw) {
    const s = normalizeKey(s0).toUpperCase();
    if (s.includes("honduras") || /\bHN\b/.test(s)) out.add("HN");
    else if (s.includes("nicaragua") || /\bNI\b/.test(s)) out.add("NI");
    else if (s.includes("guatemala") || /\bGT\b/.test(s)) out.add("GT");
    else if (s.includes("panama") || s.includes("panamá") || /\bPA\b/.test(s))
      out.add("PA");
    else if (s.includes("reg")) out.add("REG");
    else {
      const m = s0.match(/\(([A-Z]{2,3})\)\s*$/);
      const code = m?.[1] as CountryCode | undefined;
      if (code && ["REG", "HN", "GT", "PA", "NI"].includes(code)) out.add(code);
    }
  }
  return out.size ? Array.from(out) : ["REG"];
}

/**
 * Escribe "X" dentro de la celda SIN crear nuevos <w:p> cuando ya existe uno.
 * Esto evita que varíe la altura de la fila y respeta la centralización que trae la plantilla.
 */
function setCountryX(
  doc: Document,
  root: Document,
  uiValue: string | string[]
) {
  const codes = toCountryCodes(uiValue);

  const table = findTableByRowLabel(root, "Seleccionar país afectado");
  if (!table) return;

  // localizar cabecera con REG/HN/GT/PA/NI
  let headerRow: Node | null = null;
  const rows = xpNodes(".//w:tr", table);
  for (const tr of rows) {
    const tx = getTextDeep(tr);
    if (["REG", "HN", "GT", "PA", "NI"].every((w) => tx.includes(w))) {
      headerRow = tr;
      break;
    }
  }
  if (!headerRow) return;

  const selectRow = xpNode("./following-sibling::w:tr[1]", headerRow);
  if (!selectRow) return;

  const idx: Record<CountryCode, number> = {
    REG: findColumnIndexByHeader(headerRow, "REG"),
    HN: findColumnIndexByHeader(headerRow, "HN"),
    GT: findColumnIndexByHeader(headerRow, "GT"),
    PA: findColumnIndexByHeader(headerRow, "PA"),
    NI: findColumnIndexByHeader(headerRow, "NI"),
  };

  // Limpiar celdas (sin crear p nuevos)
  (Object.keys(idx) as CountryCode[]).forEach((k) => {
    const i = idx[k];
    if (i > 0) {
      const tc = xpNode(`./w:tc[${i}]`, selectRow);
      setCellTextKeepParagraph(tc, "", doc);
    }
  });

  // Colocar X en seleccionados (también sin crear p nuevos si ya existen)
  for (const code of codes) {
    const i = idx[code] || 0;
    if (!i) continue;
    const target = xpNode(`./w:tc[${i}]`, selectRow);
    setCellTextKeepParagraph(target, "X", doc);
  }
}

/* =================== Líneas con label en la primera fila ================ */

/**
 * Rellena un “label: valor” dentro de la MISMA celda que contiene el label.
 * Tolera asterisco inicial, NBSP y splits en varios <w:t>.
 * Busca cualquier <w:tc> cuyo texto contenga el label base (sin asterisco) y
 * sobrescribe el PRIMER <w:t> con `"{labelCanonical}{valor}"`.
 */
function setInlineValueInCellByLabel(
  doc: Document,
  labelBase: string,
  value: string
) {
  if (value == null) value = "";
  const labelCanon = labelBase.replace(/\s+/g, " ").trim() + " ";

  const cells = xpNodes("//w:tc", doc);
  for (const tc of cells) {
    const txt = getTextDeep(tc)
      .replace(/\*/g, "")
      .replace(/\u00A0/g, " ");
    if (normalizeKey(txt).includes(normalizeKey(labelBase))) {
      // Sobrescribe el primer w:t de la celda con "Label: valor"
      //const firstT = xpNode(".//w:t[1]", tc);
      const labelPrefix = txt.includes(":")
        ? txt.split(":")[0] + ": "
        : labelCanon;
      const finalText = `${labelPrefix}${value}`;
      setCellTextKeepParagraph(tc, finalText, doc);
      return;
    }
  }
}

/* ================================ Public API ============================ */

export async function fillInfoGeneral(
  template: Uint8Array,
  sections: UISection[]
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("No se encontró word/document.xml");

  const doc = new DOMParser().parseFromString(xml, "application/xml");

  // Cabeceras en primera fila
  const idCambio = valOfAny(sections, ["id-cambio", "id de cambio"]);
  const tipoReq = valOfAny(sections, [
    "tipo-de-requerimiento",
    "tipo de requerimiento",
    "tipo-requerimiento",
  ]);

  if (idCambio) {
    setInlineValueInCellByLabel(doc, "ID de Cambio:", idCambio);
  }
  // Tolera "*Tipo de Requerimiento:" o "Tipo de Requerimiento:"
  setInlineValueInCellByLabel(doc, "Tipo de Requerimiento:", tipoReq);

  // Bloque “Afectación a otras áreas” (todas las filas SI/NO)
  setYesNoByLabel(
    doc,
    doc,
    "Afecta DWH",
    yn(valOfAny(sections, ["afecta-dwh", "afecta dwh"])) as "SI" | "NO"
  );
  setYesNoByLabel(
    doc,
    doc,
    "Afecta Cierre",
    yn(valOfAny(sections, ["afecta-cierre", "afecta cierre"])) as "SI" | "NO"
  );
  setYesNoByLabel(
    doc,
    doc,
    "Afecta Robot",
    yn(valOfAny(sections, ["afecta-robot", "afecta robot"])) as "SI" | "NO"
  );
  setYesNoByLabel(
    doc,
    doc,
    "Notificó al NOC sobre los servicios a monitorear",
    yn(
      valOfAny(sections, [
        "notificó-al-noc-sobre-los-servicios-a-monitorear",
        "notificó al noc sobre los servicios a monitorear",
      ])
    ) as "SI" | "NO"
  );
  setYesNoByLabel(
    doc,
    doc,
    "Es Regulatorio",
    yn(valOfAny(sections, ["es-regulatorio", "es regulatorio"])) as "SI" | "NO"
  );

  // Otros
  const otros = valOfAny(sections, ["otros", "otros:"]);
  if (otros) setOtros(doc, doc, otros);

  // País afectado (múltiple)
  const paisField = sections
    .flatMap((s) => s.fields)
    .find((f) =>
      ["pais-afectado", "país-afectado"].includes(normalizeKey(f.key))
    );
  const paisValue = paisField?.value as any; // string | string[]
  setCountryX(
    doc,
    doc,
    Array.isArray(paisValue) ? paisValue : paisValue ?? "REG"
  );

  // Participa Proveedor
  setYesNoByLabel(
    doc,
    doc,
    "Participa Proveedor",
    yn(valOfAny(sections, ["participa-proveedor", "participa proveedor"])) as
      | "SI"
      | "NO"
  );

  const outXml = new XMLSerializer().serializeToString(doc);
  zip.file("word/document.xml", outXml);
  return await zip.generateAsync({ type: "uint8array" });
}
