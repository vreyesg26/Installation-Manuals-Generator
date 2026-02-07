import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type {
  ManualExtract,
  PiezasGrupo,
  PiezasItem,
  KeyValueField,
  UISection,
} from "@/types/manual";

type SupportedInput =
  | Uint8Array
  | ArrayBufferLike
  | ArrayBufferView
  | { type: "Buffer"; data: number[] };

function textFromParagraph(p: any): string {
  const runs = p?.["w:r"]
    ? Array.isArray(p["w:r"])
      ? p["w:r"]
      : [p["w:r"]]
    : [];
  return runs
    .map((r: any) => {
      const t = r?.["w:t"];
      if (typeof t === "string") return t;
      if (t?.["#text"]) return t["#text"];
      return "";
    })
    .join("");
}

function normalize(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function headersMapIndex(headers: string[]) {
  const map: Record<"nombre" | "tipo" | "estado", number> = {
    nombre: -1,
    tipo: -1,
  };
  headers.forEach((h, i) => {
    const key = normalize(h).toLowerCase();
    if (/(^|\s)nombre(\s|$)/.test(key)) map.nombre = i;
    else if (/^tipo$/.test(key)) map.tipo = i;
    else if (/nuevo|modificado|nuevo o modificado/.test(key)) map.estado = i;
  });
  return map;
}

function toUint8Array(input: SupportedInput): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input as any))
    return new Uint8Array((input as ArrayBufferView).buffer);
  if ((input as any)?.type === "Buffer" && Array.isArray((input as any).data)) {
    return Uint8Array.from((input as any).data);
  }
  return new Uint8Array(input as ArrayBufferLike);
}

function walk(node: any, ordered: any[]) {
  if (!node || typeof node !== "object") return;

  if (node["w:p"]) {
    const ps = Array.isArray(node["w:p"]) ? node["w:p"] : [node["w:p"]];
    for (const p of ps) ordered.push({ type: "p", node: p });
  }

  if (node["w:tbl"]) {
    const tbls = Array.isArray(node["w:tbl"]) ? node["w:tbl"] : [node["w:tbl"]];
    for (const t of tbls) ordered.push({ type: "tbl", node: t });
  }

  for (const key of Object.keys(node)) {
    const child = node[key];
    if (!child) continue;

    if (Array.isArray(child)) {
      for (const c of child) walk(c, ordered);
      continue;
    }

    if (typeof child === "object") {
      walk(child, ordered);
    }
  }
}

export async function parseDocxArrayBuffer(
  input: SupportedInput
): Promise<ManualExtract> {
  const bytes = toUint8Array(input);

  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("No se encontró word/document.xml");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
  const xml: any = parser.parse(docXml);

  const body = xml?.["w:document"]?.["w:body"];
  if (!body) throw new Error("Estructura DOCX no reconocida");

  const paragraphs: string[] = [];
  const tables: string[][][] = [];

  const orderedNodes: Array<{ type: "p" | "tbl"; node: any }> = [];
  walk(body, orderedNodes);

  for (const item of orderedNodes) {
    if (item.type === "p") {
      const t = normalize(textFromParagraph(item.node));
      if (t) paragraphs.push(t);
    } else {
      const rows = item.node?.["w:tr"]
        ? Array.isArray(item.node["w:tr"])
          ? item.node["w:tr"]
          : [item.node["w:tr"]]
        : [];
      const table: string[][] = [];
      for (const tr of rows) {
        const cells = tr?.["w:tc"]
          ? Array.isArray(tr["w:tc"])
            ? tr["w:tc"]
            : [tr["w:tc"]]
          : [];
        const row: string[] = [];
        for (const tc of cells) {
          const paras = tc?.["w:p"]
            ? Array.isArray(tc["w:p"])
              ? tc["w:p"]
              : [tc["w:p"]]
            : [];
          const cellText = normalize(
            paras.map((p: any) => textFromParagraph(p)).join(" ")
          );
          row.push(cellText);
        }
        if (row.some(Boolean)) table.push(row);
      }
      if (table.length) tables.push(table);
    }
  }

  const camposDetectados: KeyValueField[] = [];
  const kvRegex = /^([^:]{2,80}):\s*(.+)$/;
  for (const line of paragraphs) {
    const m = line.match(kvRegex);
    if (m)
      camposDetectados.push({ key: normalize(m[1]), value: normalize(m[2]) });
  }

  function getTitleBeforeTable(index: number): string | null {
    for (let i = index - 1; i >= 0 && index - i <= 6; i--) {
      const node = orderedNodes[i];
      if (!node) continue;
      if (node.type === "tbl") break;
      if (node.type === "p") {
        const txt = normalize(textFromParagraph(node.node));
        if (!txt) continue;
        const lower = txt.toLowerCase();
        if (/^listado de piezas detalladas/.test(lower)) continue;
        if (/^informaci[oó]n general/.test(lower)) continue;
        if (/^paso\s+\d+/.test(lower)) continue;
        if (txt.length > 120) continue;
        return txt
          .replace(/\s*-\s*listado de piezas detalladas.*$/i, "")
          .trim();
      }
    }
    return null;
  }

  // BUSCAR EL INICIO DEL BLOQUE DE PIEZAS DETALLADAS
  let startIndex = -1;

  for (let i = 0; i < tables.length; i++) {
    const flat = normalize(tables[i].flat().join(" ").toLowerCase());
    if (flat.includes("listado de piezas detalladas")) {
      startIndex = i + 1; // Las tablas de piezas empiezan después de esta
      break;
    }
  }

  if (startIndex === -1) {
    console.warn("⚠ No se encontró la sección de piezas detalladas");
    startIndex = 0;
  }

  // Para evitar duplicar grupos con el mismo título
  // ===============================================
  //  NUEVA DETECCIÓN DE TABLAS DE PIEZAS DETALLADAS (DEFINITIVA)
  // ===============================================

  const gruposAgregados = new Set<string>();
  const piezasDetalladas: PiezasGrupo[] = [];
  let detectedStructuredPiezas = false;

  const isPiezasHeaderRow = (row: string[]) => {
    const map = headersMapIndex(row.map((h) => normalize(h)));
    return map.nombre >= 0 && map.tipo >= 0 && map.estado >= 0;
  };

  const normalizeGroupLabel = (label: string) => {
    const t = normalize(label).replace(/\s*\/\s*/g, "/");
    const m = t.match(/(Middleware\/[A-Za-z0-9_-]+)/i);
    if (m?.[1]) return m[1];
    return t;
  };

  const isLikelyGroupTitle = (value: string) => {
    const t = normalize(value);
    if (!t) return false;
    if (/^listado de piezas detalladas/i.test(t)) return false;
    if (/^respuesta\s*:/i.test(t)) return false;
    if (/[:]/.test(t) && !/middleware\//i.test(t)) return false;
    if (/^nombre$|^tipo$|nuevo\s*o\s*modificado/i.test(t)) return false;
    return /middleware\//i.test(t) || /^[A-Za-z][A-Za-z0-9 _-]{1,40}\/[A-Za-z0-9 _-]{1,40}$/.test(t);
  };

  const readGroupNameBeforeHeader = (table: string[][], headerIndex: number) => {
    for (let k = headerIndex - 1; k >= Math.max(0, headerIndex - 6); k--) {
      const row = (table[k] ?? []).map((c) => normalize(c)).filter(Boolean);
      if (!row.length) continue;

      const joined = normalize(row.join(" "));
      if (isLikelyGroupTitle(joined)) return normalizeGroupLabel(joined);

      // Si no es fila combinada, intenta por celda para casos con columnas vacías
      for (const cell of row) {
        if (isLikelyGroupTitle(cell)) return normalizeGroupLabel(cell);
      }
    }
    return "Piezas detalladas";
  };

  const isRowCompletelyEmpty = (row: string[]) => row.every((c) => !normalize(c));

  for (const table of tables) {
    if (!table?.length) continue;

    // Permite detectar múltiples bloques en una sola tabla:
    // [titulo grupo] + [header Nombre/Tipo/Nuevo o Modificado] + [filas]
    for (let h = 0; h < table.length; h++) {
      const headerRow = table[h] ?? [];
      if (!isPiezasHeaderRow(headerRow)) continue;

      const headers = headerRow.map((cell) => normalize(cell));
      const map = headersMapIndex(headers);
      const grupo = readGroupNameBeforeHeader(table, h);
      const items: PiezasItem[] = [];

      for (let i = h + 1; i < table.length; i++) {
        const row = table[i] ?? [];

        // Si arranca otro header de piezas, termina el bloque actual.
        if (isPiezasHeaderRow(row)) break;

        // Si aparece una fila tipo título de grupo y no trae datos tabulares, corta.
        const rowNorm = row.map((c) => normalize(c));
        const rowNonEmpty = rowNorm.filter(Boolean);
        if (rowNonEmpty.length === 1 && isLikelyGroupTitle(rowNonEmpty[0])) break;
        if (isRowCompletelyEmpty(rowNorm)) continue;

        const nombre = row[map.nombre] ?? "";
        const tipo = row[map.tipo] ?? "";
        const estadoRaw = row[map.estado] ?? "";
        const estado = /nuevo/i.test(estadoRaw)
          ? "Nuevo"
          : /modificado/i.test(estadoRaw)
          ? "Modificado"
          : estadoRaw;

        if (nombre || tipo || estadoRaw) {
          items.push({
            nombre: normalize(nombre),
            tipo: normalize(tipo),
            estado: normalize(estado),
          });
        }
      }

      if (items.length) {
        detectedStructuredPiezas = true;
        piezasDetalladas.push({ grupo: normalize(grupo), items });
      }
    }
  }

  // Dedup por grupo (manteniendo orden) + dedup de items dentro de cada grupo
  if (piezasDetalladas.length > 1) {
    const grouped = new Map<string, PiezasItem[]>();
    for (const g of piezasDetalladas) {
      const key = normalizeGroupLabel(g.grupo || "Piezas detalladas");
      const curr = grouped.get(key) ?? [];
      grouped.set(key, curr.concat(g.items || []));
    }

    piezasDetalladas.length = 0;
    for (const [grupo, itemsRaw] of grouped.entries()) {
      const seen = new Set<string>();
      const items: PiezasItem[] = [];
      for (const it of itemsRaw) {
        const sig = `${normalize(it.nombre)}|${normalize(it.tipo)}|${normalize(it.estado)}`.toLowerCase();
        if (seen.has(sig)) continue;
        seen.add(sig);
        items.push({
          nombre: normalize(it.nombre),
          tipo: normalize(it.tipo),
          estado: normalize(it.estado),
        });
      }
      if (items.length) piezasDetalladas.push({ grupo, items });
    }
  }

  // 5.1) Fallback para tablas de "Piezas detalladas" en formato VERTICAL (cabeceras apiladas)
  (function detectVerticalPiezas() {
    // Evita duplicar si ya detectamos piezas estructuradas correctamente
    if (detectedStructuredPiezas) return;

    const isHeaderToken = (s: string) =>
      /^nombre$/i.test(s) ||
      /^tipo$/i.test(s) ||
      /nuevo\s*o\s*modificado/i.test(s);

    const isProbableGroupName = (s: string) => {
      const t = normalize(s);
      if (!t) return false;
      if (isHeaderToken(t)) return false;
      if (/^listado de piezas detalladas/i.test(t)) return false;
      // Nombres de repos suelen ser mayúsculas y sin espacios largos (RGCARD, OSB, DB12, NICARD, etc.)
      return (
        /^[A-Z0-9 _-]{2,}$/.test(t) ||
        /^(RGCARD|NICARD|DB12|OSB|NITRANSFER|RGTRANSFER|DATABASE[_ ]CLOUD|APLICACIONES-ESCRITORIO|SALESFORCE|COBIS|DIGITALIZACION[- ]TARJETAS|OIC)$/i.test(
          t
        )
      );
    };

  // Convertir grupos a estructura final
  for (const g of fixGroups) {
    const header = g.table[0];
    const body = g.table.slice(1);

    const colNombre = header.findIndex((c) => /nombre/i.test(c));
    const colTipo = header.findIndex((c) => /tipo/i.test(c));
    const colEstado = header.findIndex((c) => /(nuevo|modificado)/i.test(c));

    if (colNombre === -1 || colTipo === -1 || colEstado === -1) continue;

    const items = body
      .map((r) => {
        const nombre = normalize(r[colNombre] || "");
        if (!nombre) return null;

        const tipo = normalize(r[colTipo] || "");
        const estadoRaw = normalize(r[colEstado] || "");

        const estado = /nuevo/i.test(estadoRaw)
          ? "Nuevo"
          : /modificado/i.test(estadoRaw)
          ? "Modificado"
          : "Modificado";

        return { nombre, tipo, estado };
      })
      .filter(Boolean) as PiezasItem[];

    if (items.length) {
      piezasDetalladas.push({ grupo: g.title, items });
    }
  }

  (function detectInstallTables() {
    // Si ya detectamos tablas de piezas con estructura clara, evitamos inferencias extra
    // de tablas de implementación para no duplicar grupos (p.ej. OSB/DB repetidos).
    if (detectedStructuredPiezas) return;
    // No duplica si ya hubo detecciones previas; si quieres mergear, quita este return
    // (Yo prefiero MERGEAR en vez de return: por eso no retorno si ya hay piezas)
    const KNOWN_EXTS = [
      "jar",
      "sql",
      "sp",
      "spsql",
      "dtsx",
      "pks",
      "pkb",
      "tps",
      "pkg",
      "xml",
      "xqy",
      "xquery",
      "wsdl",
      "xsd",
      "yaml",
      "yml",
      "json",
      "js",
      "ts",
      "dll",
      "war",
      "ear",
    ];

    const extToTipo = (ext: string) => {
      const e = ext.toLowerCase();
      if (e === "jar") return "JAR";
      if (e === "sql") return "Script SQL";
      if (e === "sp" || e === "spsql") return "Stored Procedure";
      if (e === "dtsx") return "SSIS Package";
      if (e === "pks" || e === "pkb" || e === "pkg") return "Oracle Package";
      if (e === "tps") return "Oracle Type";
      if (e === "xqy" || e === "xquery") return "XQuery";
      if (e === "wsdl") return "WSDL";
      if (e === "xsd") return "XSD";
      if (e === "yaml" || e === "yml") return "YAML";
      if (e === "json") return "JSON";
      if (e === "dll") return "DLL";
      if (e === "war" || e === "ear") return e.toUpperCase();
      if (e === "xml" || e === "js" || e === "ts") return e.toUpperCase();
      return e.toUpperCase();
    };

    const extractFilenames = (text: string): string[] => {
      const t = normalize(text);
      if (!t) return [];
      const re = /[A-Za-z0-9._\-\\\/]+\.([A-Za-z0-9]{1,8})/g;
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) {
        const full = m[0];
        const ext = (m[1] || "").toLowerCase();
        if (!KNOWN_EXTS.includes(ext)) continue;
        const base = full.split(/[/\\]/).pop()!;
        if (/^N\/A$/i.test(base)) continue;
        if (!out.includes(base)) out.push(base);
      }
      return out;
    };

    const looksLikeInstallHeader = (hdr: string) =>
      /^(objeto\s+a\s+instalar|objeto\s+a\s+respaldar|archivo|artefacto)/i.test(
        normalize(hdr)
      );

    const guessEstadoAround = (
      rowTexts: string[]
    ): "Nuevo" | "Modificado" | string => {
      const joined = normalize(rowTexts.join(" "));
      if (/nuevo/i.test(joined) && !/modificad/i.test(joined)) return "Nuevo";
      if (/modificad/i.test(joined) && !/nuevo/i.test(joined))
        return "Modificado";
      return "Modificado";
    };

    for (const table of tables) {
      if (!table?.length) continue;

      let repoName = "";
      const headerRow = table.find((r) =>
        r.some((c) => /repositorio\s*:?\s*$/i.test(normalize(c)))
      );
      if (headerRow) {
        const idx = headerRow.findIndex((c) =>
          /repositorio\s*:?\s*$/i.test(normalize(c))
        );
        const headerRowIndex = table.indexOf(headerRow);
        const below = table[headerRowIndex + 1]?.[idx];
        if (below) repoName = normalize(below);
      }

      if (!repoName) {
        const repoTriple = table.find(
          (r) =>
            r.length >= 3 &&
            /^implementaci[óo]n|^base de datos|^par[áa]metros|^seguridad|^oic|^salesforce/i.test(
              normalize(r[0])
            ) &&
            /^(RGCARD|NICARD|DB12|OSB|NITRANSFER|RGTRANSFER|DATABASE[_ ]CLOUD|APLICACIONES-ESCRITORIO|SALESFORCE|COBIS|DIGITALIZACION(?:[- ]TARJETAS)?|OIC)$/i.test(
              normalize(r[2])
            )
        );
        if (repoTriple) repoName = normalize(repoTriple[2]);
      }

      const firstRow = table[0] || [];
      let idxObjeto = -1;
      for (let c = 0; c < firstRow.length; c++) {
        const h = normalize(firstRow[c]);
        if (looksLikeInstallHeader(h)) {
          idxObjeto = c;
          break;
        }
      }
      if (idxObjeto === -1) {
        for (const row of table.slice(0, 4)) {
          for (let c = 0; c < row.length; c++) {
            if (looksLikeInstallHeader(row[c])) {
              idxObjeto = c;
              break;
            }
          }
          if (idxObjeto !== -1) break;
        }
      }
      if (idxObjeto === -1) continue;

      const items: PiezasItem[] = [];
      for (let r = 1; r < table.length; r++) {
        const row = table[r];
        if (!row) continue;
        const objetoCell = row[idxObjeto] ?? "";
        const files = extractFilenames(objetoCell);

        if (files.length === 0) {
          for (let c = 0; c < row.length; c++) {
            if (c === idxObjeto) continue;
            const more = extractFilenames(row[c] ?? "");
            for (const f of more) files.push(f);
          }
        }

        if (files.length) {
          const estado = guessEstadoAround(row);
          for (const f of files) {
            const ext = (f.split(".").pop() || "").toLowerCase();
            const tipo = extToTipo(ext);
            items.push({ nombre: f, tipo, estado });
          }
        }
      }

      if (items.length) {
        const grupo = repoName || "Piezas Detalladas";
        if (!gruposAgregados.has(grupo)) {
          piezasDetalladas.push({
            grupo,
            items,
          });
          gruposAgregados.add(grupo);
        }
      }
    }
  })();

  (function extractKVFromTables() {
    const seen = new Set<string>();
    const pushKV = (keyRaw: string, valRaw: string) => {
      let key = normalize(keyRaw).replace(/^\*+/, "");
      let value = normalize(valRaw);
      if (!key || !value) return;

      if (/^informaci[óo]n general$/i.test(key)) return;
      if (/^listado de piezas detalladas/i.test(key)) return;
      if (/^repositorio$/i.test(key)) return;
      if (/^paso$/i.test(key)) return;

      const sig = key.toLowerCase();
      if (seen.has(sig)) return;
      seen.add(sig);
      camposDetectados.push({ key, value });
    };

    const kvRegex = /^([^:]{2,120}):\s*(.+)$/;

    for (const table of tables) {
      if (!table?.length) continue;

      for (let r = 0; r < table.length; r++) {
        const row = table[r] ?? [];

        if (row.length === 1) {
          const c0 = normalize(row[0]);
          const m = c0.match(kvRegex);
          if (m) {
            pushKV(m[1], m[2]);
            continue;
          }
        }

        if (row.length >= 2) {
          const c0 = normalize(row[0]);
          const c1 = normalize(row[1]);

          const m0 = c0.match(kvRegex);
          const m1 = c1.match(kvRegex);

          if (m0) {
            pushKV(m0[1], m0[2]);
          } else if (m1 && !c0) {
            pushKV(m1[1], m1[2]);
          } else if (c0 && c1 && !/^respuesta/i.test(c0)) {
            pushKV(c0.replace(/:$/, ""), c1);
          }
        }
      }
    }

    for (const table of tables) {
      const headers = table[10] || table[11] || [];
      const headerIdx: Record<string, number> = {};
      headers.forEach((h, i) => {
        const k = normalize(h).toUpperCase();
        if (["REG", "HN", "GT", "PA", "NI"].includes(k)) headerIdx[k] = i;
      });

      const selRow = table.find((r) =>
        normalize(r[0]).toLowerCase().startsWith("seleccionar país afectado")
      );
      if (selRow && Object.keys(headerIdx).length) {
        let elegido = "";
        for (const [pais, idx] of Object.entries(headerIdx)) {
          const cell = normalize(selRow[idx] ?? "");
          if (cell.toUpperCase() === "X") {
            elegido = pais;
            break;
          }
        }
        if (elegido) pushKV("País afectado", elegido);
      }
    }
  })();

  const seccionesReconocidas: UISection[] = [];

  function findInfoGeneralTable(tables: any[][][]): any[][] | null {
    for (const tbl of tables) {
      const flat = tbl.flat().join(" ");
      const hasHeader = /informacion general|información general/i.test(flat);
      const hasId = tbl.some((row) =>
        row.some((c) => /id\s*de\s*cambio\s*:/i.test(c))
      );
      const hasTipo = tbl.some((row) =>
        row.some((c) => /\*?\s*tipo\s*de\s*requerimiento\s*:/i.test(c))
      );
      if (hasHeader || (hasId && hasTipo)) return tbl;
    }
    return null;
  }

  function extractYesNo(table: any[][], label: RegExp): "SI" | "NO" | "" {
    for (const row of table) {
      const joined = row.join(" ");
      if (label.test(joined)) {
        const rev = [...row].reverse();
        for (const cell of rev) {
          const t = cell.trim().toUpperCase().replace("SÍ", "SI");
          if (t === "SI" || t === "NO") return t as "SI" | "NO";
        }
        if (row.length >= 2) {
          const v = row[row.length - 1]
            .trim()
            .toUpperCase()
            .replace("SÍ", "SI");
          if (v === "SI" || v === "NO") return v as "SI" | "NO";
        }
      }
    }
    return "";
  }

  function extractOtros(table: any[][]): string {
    for (const row of table) {
      const idx = row.findIndex((c) => /^otros\s*:?/i.test(c));
      if (idx >= 0) {
        if (row.length > idx + 1) return row[idx + 1].trim();
        const m = row[idx].match(/^otros\s*:?\s*(.+)$/i);
        if (m) return m[1].trim();
        return "";
      }
    }
    return "";
  }

  function extractIdCambio(table: any[][]): string {
    for (const row of table) {
      for (const c of row) {
        const m = c.match(/id\s*de\s*cambio\s*:\s*(.+)$/i);
        if (m) return m[1].trim();
      }
    }
    return "";
  }

  function extractTipoReq(table: any[][]): string {
    for (const row of table) {
      for (const c of row) {
        const m = c.match(/\*?\s*tipo\s*de\s*requerimiento\s*:\s*(.+)$/i);
        if (m) return m[1].trim();
      }
    }
    return "";
  }

  function extractCountries(table: any[][]): string[] {
    let header: string[] | null = null;
    let select: string[] | null = null;

    for (let i = 0; i < table.length; i++) {
      const row = table[i];
      const hasAll =
        row.some((c) => /\bREG\b/i.test(c)) &&
        row.some((c) => /\bHN\b/i.test(c)) &&
        row.some((c) => /\bGT\b/i.test(c)) &&
        row.some((c) => /\bPA\b/i.test(c)) &&
        row.some((c) => /\bNI\b/i.test(c));
      if (hasAll) {
        header = row.map((c) => c.trim().toUpperCase());
        if (i + 1 < table.length) {
          select = table[i + 1].map((c) => c.trim().toUpperCase());
        }
        break;
      }
    }
    if (!header || !select) return [];

    const out: string[] = [];
    for (let i = 0; i < header.length; i++) {
      const h = header[i];
      if (!/^(REG|HN|GT|PA|NI)$/.test(h)) continue;
      const v = select[i] ?? "";
      if (v === "X" || v === "SI" || v === "✔") {
        out.push(h);
      }
    }
    return out;
  }

  const infoTbl = findInfoGeneralTable(tables);

  if (infoTbl) {
    const idCambio = extractIdCambio(infoTbl);
    const tipoReq = extractTipoReq(infoTbl);
    const dwh = extractYesNo(infoTbl, /afecta\s+dwh/i) || "NO";
    const cierre = extractYesNo(infoTbl, /afecta\s+cierre/i) || "NO";
    const robot = extractYesNo(infoTbl, /afecta\s+robot/i) || "NO";
    const noc = extractYesNo(infoTbl, /notific[oó] al noc/i) || "NO";
    const regul = extractYesNo(infoTbl, /es\s+regulatorio/i) || "NO";
    const otros = extractOtros(infoTbl);
    const paises = extractCountries(infoTbl);

    seccionesReconocidas.push({
      id: "informacion-general",
      title: "Información general",
      fields: [
        {
          key: "id-cambio",
          label: "ID de Cambio",
          kind: "text",
          value: idCambio,
        },
        {
          key: "tipo-requerimiento",
          label: "Tipo de Requerimiento",
          kind: "text",
          value: tipoReq,
        },
        {
          key: "afecta-dwh",
          label: "Afecta DWH",
          kind: "select",
          value: dwh,
          options: [
            { label: "SI", value: "SI" },
            { label: "NO", value: "NO" },
          ],
        },
        {
          key: "afecta-cierre",
          label: "Afecta Cierre",
          kind: "select",
          value: cierre,
          options: [
            { label: "SI", value: "SI" },
            { label: "NO", value: "NO" },
          ],
        },
        {
          key: "afecta-robot",
          label: "Afecta Robot",
          kind: "select",
          value: robot,
          options: [
            { label: "SI", value: "SI" },
            { label: "NO", value: "NO" },
          ],
        },
        {
          key: "notificó-al-noc-sobre-los-servicios-a-monitorear",
          label: "Notificó al NOC sobre los servicios a monitorear",
          kind: "select",
          value: noc,
          options: [
            { label: "SI", value: "SI" },
            { label: "NO", value: "NO" },
          ],
        },
        {
          key: "es-regulatorio",
          label: "Es Regulatorio",
          kind: "select",
          value: regul,
          options: [
            { label: "SI", value: "SI" },
            { label: "NO", value: "NO" },
          ],
        },
        { key: "otros", label: "Otros", kind: "text", value: otros },
        {
          key: "pais-afectado",
          label: "Seleccionar país afectado",
          kind: "multiselect",
          value: paises,
          options: [
            { label: "REG", value: "REG" },
            { label: "HN", value: "HN" },
            { label: "GT", value: "GT" },
            { label: "PA", value: "PA" },
            { label: "NI", value: "NI" },
          ],
        },
        {
          key: "participa-proveedor",
          label: "Participa Proveedor",
          kind: "select",
          value: extractYesNo(infoTbl, /participa\s+proveedor/i) || "NO",
          options: [
            { label: "SI", value: "SI" },
            { label: "NO", value: "NO" },
          ],
        },
      ],
    });
  }

  return {
    camposDetectados,
    piezasDetalladas,
    seccionesReconocidas,
    raw: { paragraphs, tables },
  };
}
