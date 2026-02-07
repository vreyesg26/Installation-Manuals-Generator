import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type {
  ManualExtract,
  PiezasGrupo,
  PiezasItem,
  KeyValueField,
  UIField,
  FieldOption,
  UISection,
} from "@/types/manual";

/** Tipos de entrada que pueden venir desde IPC (preload/main) */
type SupportedInput =
  | Uint8Array
  | ArrayBufferLike // incluye ArrayBuffer y SharedArrayBuffer
  | ArrayBufferView // DataView/TypedArray
  | { type: "Buffer"; data: number[] }; // Buffer serializado

/** Extrae texto concatenado de un párrafo w:p (runs) */
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

/** Mapea índices de columnas para una tabla de piezas detalladas */
function headersMapIndex(headers: string[]) {
  const map: Record<"nombre" | "tipo" | "estado", number> = {
    nombre: -1,
    tipo: -1,
    estado: -1,
  };
  headers.forEach((h, i) => {
    const key = normalize(h).toLowerCase();
    if (/(^|\s)nombre(\s|$)/.test(key)) map.nombre = i;
    else if (/^tipo$/.test(key)) map.tipo = i;
    else if (/nuevo|modificado|nuevo o modificado/.test(key)) map.estado = i;
  });
  return map;
}

/** Normaliza cualquier input soportado a Uint8Array (JSZip-friendly) */
function toUint8Array(input: SupportedInput): Uint8Array {
  if (input instanceof Uint8Array) return input;
  // ArrayBufferView: TypedArrays/DataView
  if (ArrayBuffer.isView(input as any))
    return new Uint8Array((input as ArrayBufferView).buffer);
  // Buffer serializado { type: 'Buffer', data: [...] }
  if ((input as any)?.type === "Buffer" && Array.isArray((input as any).data)) {
    return Uint8Array.from((input as any).data);
  }
  // ArrayBufferLike (incluye SharedArrayBuffer)
  return new Uint8Array(input as ArrayBufferLike);
}

/**
 * Parsea un .docx y retorna:
 * - camposDetectados: pares "Clave: Valor" encontrados en párrafos
 * - piezasDetalladas: tablas con columnas (Nombre|Tipo|Nuevo/Modificado)
 * - seccionesReconocidas: (reservado para versiones futuras)
 * - raw: texto plano de párrafos y tablas (para depuración)
 */
export async function parseDocxArrayBuffer(
  input: SupportedInput
): Promise<ManualExtract> {
  const bytes = toUint8Array(input);

  // 1) Descomprimir DOCX
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("No se encontró word/document.xml");

  // 2) Parsear XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
  const xml: any = parser.parse(docXml);

  const body = xml?.["w:document"]?.["w:body"];
  if (!body) throw new Error("Estructura DOCX no reconocida");

  // 3) Recorrer body preservando el orden de párrafos y tablas
  const paragraphs: string[] = [];
  const tables: string[][][] = [];
  const orderedNodes: Array<{ type: "p" | "tbl"; node: any }> = [];

  for (const key of Object.keys(body)) {
    const v = body[key];
    if (key === "w:p") {
      (Array.isArray(v) ? v : [v]).forEach((x: any) =>
        orderedNodes.push({ type: "p", node: x })
      );
    } else if (key === "w:tbl") {
      (Array.isArray(v) ? v : [v]).forEach((x: any) =>
        orderedNodes.push({ type: "tbl", node: x })
      );
    }
  }

  for (const item of orderedNodes) {
    if (item.type === "p") {
      const t = normalize(textFromParagraph(item.node));
      if (t) paragraphs.push(t);
    } else {
      // Tabla → filas → celdas → concatenar texto de sus párrafos
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

  // 4) Campos sueltos "Clave: Valor" detectados en párrafos
  const camposDetectados: KeyValueField[] = [];
  const kvRegex = /^([^:]{2,80}):\s*(.+)$/; // sencillo pero efectivo
  for (const line of paragraphs) {
    const m = line.match(kvRegex);
    if (m)
      camposDetectados.push({ key: normalize(m[1]), value: normalize(m[2]) });
  }

  // 5) Detección de tablas de "Piezas detalladas"
  const piezasDetalladas: PiezasGrupo[] = [];
  let detectedStructuredPiezas = false;

  const isPiezasHeaderRow = (row: string[]) => {
    const map = headersMapIndex(row.map((h) => normalize(h)));
    return map.nombre >= 0 && map.tipo >= 0 && map.estado >= 0;
  };

  const readGroupNameBeforeHeader = (table: string[][], headerIndex: number) => {
    for (let k = headerIndex - 1; k >= Math.max(0, headerIndex - 4); k--) {
      const row = (table[k] ?? []).map((c) => normalize(c)).filter(Boolean);
      if (!row.length) continue;

      // Evita tomar títulos globales del bloque como nombre de grupo
      if (/^listado de piezas detalladas/i.test(row.join(" "))) continue;

      // El nombre suele venir en una sola celda: Middleware/OSB, Middleware/DB, etc.
      if (row.length === 1) return row[0];
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
        if (rowNonEmpty.length === 1 && /middleware\//i.test(rowNonEmpty[0])) break;
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

    for (const table of tables) {
      if (!table?.length) continue;

      // Aplanamos la tabla en una sola columna tomando la 1ª celda no vacía de cada fila
      const col0 = table.map((row) =>
        normalize(row.find((c) => !!normalize(c)) ?? "")
      );

      // Buscar secuencias "Nombre" -> "Tipo" -> "Nuevo o Modificado"
      for (let i = 0; i < col0.length - 3; i++) {
        const h1 = col0[i];
        const h2 = col0[i + 1];
        const h3 = col0[i + 2];

        if (
          !/^nombre$/i.test(h1) ||
          !/^tipo$/i.test(h2) ||
          !/nuevo\s*o\s*modificado/i.test(h3)
        )
          continue;

        // Intenta hallar nombre de grupo en alguna fila inmediatamente anterior no vacía
        let grupo = "Piezas Detalladas";
        for (let k = i - 1; k >= Math.max(0, i - 5); k--) {
          if (isProbableGroupName(col0[k])) {
            grupo = col0[k];
            break;
          }
        }

        const items: PiezasItem[] = [];
        let j = i + 3;
        while (j + 2 < col0.length) {
          const nombre = normalize(col0[j]);
          const tipo = normalize(col0[j + 1]);
          const estadoRaw = normalize(col0[j + 2]);

          // Si viene otra cabecera o un posible título de grupo, cortamos
          if (
            /^nombre$/i.test(nombre) &&
            /^tipo$/i.test(tipo) &&
            /nuevo\s*o\s*modificado/i.test(estadoRaw)
          ) {
            // Es otra cabecera apilada: rompe para dejar que otro ciclo la tome
            break;
          }
          if (isProbableGroupName(nombre) && !tipo && !estadoRaw) break;

          // Línea vacía triple ⇒ fin del bloque
          if (!nombre && !tipo && !estadoRaw) break;

          // Acepta ítems parcialmente llenos (por si el doc tiene celdas vacías)
          if (nombre || tipo || estadoRaw) {
            const estado = /nuevo/i.test(estadoRaw)
              ? "Nuevo"
              : /modificado/i.test(estadoRaw)
              ? "Modificado"
              : estadoRaw || "Nuevo"; // por defecto
            items.push({ nombre, tipo, estado });
          }

          j += 3;
        }

        if (items.length) {
          piezasDetalladas.push({ grupo, items });
        }

        // Continúa buscando más bloques verticales en la misma tabla
        i = j - 1;
      }
    }
  })();

  // 5.2) EXTRA: Tablas de implementación "Paso | Objeto a instalar | Ruta ..." => extraer archivos como piezas
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
      // Busca tokens con extensión, incluyendo rutas; luego dejaremos solo el basename
      const re = /[A-Za-z0-9._\-\\\/]+\.([A-Za-z0-9]{1,8})/g;
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) {
        const full = m[0];
        const ext = (m[1] || "").toLowerCase();
        if (!KNOWN_EXTS.includes(ext)) continue;
        // basename (split por / o \)
        const base = full.split(/[/\\]/).pop()!;
        // filtra ruidos tipo "N/A"
        if (/^N\/A$/i.test(base)) continue;
        // evita duplicados cercanos
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
      // Si la sección dice "Listado de piezas detalladas (Nuevos / Modificados)" no decide por sí sola
      return "Modificado"; // default conservador; cámbialo si quieres "Nuevo"
    };

    // Recorremos todas las tablas en busca de:
    // - una fila/encabezado que nos diga el repositorio
    // - una columna que parezca "Objeto a instalar"/"Objeto a respaldar"
    for (const table of tables) {
      if (!table?.length) continue;

      // 1) Detectar el repositorio de esta tabla (en tu dump se ve en la 3ra celda tras "Repositorio:")
      let repoName = "";
      // a) Por filas tipo ["Equipo Implementador:", "Rama de Integración:", "Repositorio:"]
      const headerRow = table.find((r) =>
        r.some((c) => /repositorio\s*:?\s*$/i.test(normalize(c)))
      );
      if (headerRow) {
        const idx = headerRow.findIndex((c) =>
          /repositorio\s*:?\s*$/i.test(normalize(c))
        );
        // intenta tomar celda debajo de "Repositorio:" (misma columna, fila siguiente)
        const headerRowIndex = table.indexOf(headerRow);
        const below = table[headerRowIndex + 1]?.[idx];
        if (below) repoName = normalize(below);
      }
      // b) Por filas de 3 celdas [ "Implementación", "feature/...", "RGCARD" ]
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

      // 2) Detectar la columna "Objeto a instalar / respaldar"
      const firstRow = table[0] || [];
      let idxObjeto = -1;
      for (let c = 0; c < firstRow.length; c++) {
        const h = normalize(firstRow[c]);
        if (looksLikeInstallHeader(h)) {
          idxObjeto = c;
          break;
        }
      }
      // Si la cabecera no está en la primera fila, intenta en cualquier fila "titulada"
      if (idxObjeto === -1) {
        for (const row of table.slice(0, 4)) {
          // primeras filas suelen ser encabezados
          for (let c = 0; c < row.length; c++) {
            if (looksLikeInstallHeader(row[c])) {
              idxObjeto = c;
              break;
            }
          }
          if (idxObjeto !== -1) break;
        }
      }
      if (idxObjeto === -1) continue; // esta tabla no es de "objetos a instalar"

      // 3) Recorre filas y extrae archivos del campo "Objeto..."
      const items: PiezasItem[] = [];
      for (let r = 1; r < table.length; r++) {
        const row = table[r];
        if (!row) continue;
        const objetoCell = row[idxObjeto] ?? "";
        const files = extractFilenames(objetoCell);

        if (files.length === 0) {
          // Otro patrón frecuente: "Descargar del repositorio X el objeto" y el archivo está en la siguiente celda/filas
          // Mira celdas vecinas por si hay un filename suelto
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
        piezasDetalladas.push({
          grupo: repoName || "Piezas Detalladas",
          items,
        });
      }
    }
  })();

  // 5.3) EXTRA: Campos "Clave: Valor" dentro de tablas (celda única y 2 columnas) + país con 'X'
  (function extractKVFromTables() {
    const seen = new Set<string>();
    const pushKV = (keyRaw: string, valRaw: string) => {
      let key = normalize(keyRaw).replace(/^\*+/, ""); // quita asteriscos tipo "*Tipo de Requerimiento"
      let value = normalize(valRaw);
      if (!key || !value) return;

      // Ignora ruidos obvios
      if (/^informaci[óo]n general$/i.test(key)) return;
      if (/^listado de piezas detalladas/i.test(key)) return;
      if (/^repositorio$/i.test(key)) return;
      if (/^paso$/i.test(key)) return;

      const sig = key.toLowerCase();
      if (seen.has(sig)) return; // dedupe por clave
      seen.add(sig);
      camposDetectados.push({ key, value });
    };

    const kvRegex = /^([^:]{2,120}):\s*(.+)$/;

    // A) Escanea todas las tablas
    for (const table of tables) {
      if (!table?.length) continue;

      for (let r = 0; r < table.length; r++) {
        const row = table[r] ?? [];

        // A.1) Si la fila tiene 1 celda con "key:value"
        if (row.length === 1) {
          const c0 = normalize(row[0]);
          const m = c0.match(kvRegex);
          if (m) {
            pushKV(m[1], m[2]);
            continue;
          }
        }

        // A.2) Si la fila tiene >= 2 celdas, intenta:
        // - celda 0 con "key:value"
        // - si no, considera col0=key y col1=value
        if (row.length >= 2) {
          const c0 = normalize(row[0]);
          const c1 = normalize(row[1]);

          const m0 = c0.match(kvRegex);
          const m1 = c1.match(kvRegex);

          if (m0) {
            pushKV(m0[1], m0[2]);
          } else if (m1 && !c0) {
            // A.2.1) A veces la clave viene vacía y la segunda celda trae "key:value"
            pushKV(m1[1], m1[2]);
          } else if (c0 && c1 && !/^respuesta/i.test(c0)) {
            // A.2.2) Fila clásica 2 columnas: "Clave" | "Valor"
            // Evita filas tipo "Respuesta: SI/NO" (ruido)
            pushKV(c0.replace(/:$/, ""), c1);
          }
        }
      }
    }

    // B) Caso especial: país marcado con 'X'
    // Busca una fila con cabeceras de países (REG, HN, GT, PA, NI) y otra fila "Seleccionar país..." con X en una columna
    for (const table of tables) {
      const headers = table[10] || table[11] || []; // heurística: en tu dump aparece alrededor de esas filas
      const headerIdx: Record<string, number> = {};
      headers.forEach((h, i) => {
        const k = normalize(h).toUpperCase();
        if (["REG", "HN", "GT", "PA", "NI"].includes(k)) headerIdx[k] = i;
      });

      // Busca fila con "Seleccionar país afectado con una X:"
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

  // === BLOQUE NUEVO (reemplazo): construir sección "Información general" ===
  const seccionesReconocidas: UISection[] = [];

  (function buildInformacionGeneral() {
    if (!tables.length) return;
    const t = tables[0]; // la tabla de Información General
    if (!t?.length) return;

    const YES_NO: FieldOption[] = [
      { label: "SI", value: "SI" },
      { label: "NO", value: "NO" },
    ];
    const PAISES: FieldOption[] = [
      { label: "Regional", value: "REG" },
      { label: "Honduras (HN)", value: "HN" },
      { label: "Guatemala (GT)", value: "GT" },
      { label: "Panamá (PA)", value: "PA" },
      { label: "Nicaragua (NI)", value: "NI" },
    ];

    const get = (r: number, c: number) => normalize(t[r]?.[c] ?? "");
    const kvRegex = /^([^:]{2,120}):\s*(.+)$/;

    const fields: UIField[] = [];

    // 1) ID de Cambio y Tipo de Requerimiento (aunque el valor esté vacío)
    const wanted: Record<
      string,
      { key: UIField["key"]; label: string; found: boolean; value: string }
    > = {
      "id de cambio": {
        key: "id-cambio",
        label: "ID de Cambio",
        found: false,
        value: "",
      },
      "tipo de requerimiento": {
        key: "tipo-requerimiento",
        label: "Tipo de Requerimiento",
        found: false,
        value: "",
      },
    };

    for (let r = 0; r < Math.min(6, t.length); r++) {
      const row = t[r] ?? [];
      // a) celdas tipo "Clave:Valor" (valor puede ser vacío)
      for (const cell of row) {
        const txt = normalize(cell);
        const m = txt.match(kvRegex);
        if (!m) continue;
        const rawKey = normalize(m[1]).replace(/^\*+/, "");
        const rawVal = normalize(m[2] ?? "");
        const k = rawKey.toLowerCase();
        const w = wanted[k];
        if (w && !w.found) {
          w.found = true;
          w.value = rawVal; // puede ser ""
        }
      }
      // b) filas de 2 columnas "Clave" | "Valor" (valor puede ser vacío)
      //    PERO si la segunda celda también parece "Clave: Valor", NO la usamos como valor.
      if (row.length >= 2) {
        const k0 = normalize(row[0]).replace(/:$/, "").toLowerCase();
        const v1 = normalize(row[1] ?? "");
        const w = wanted[k0];
        if (w && !w.found) {
          // si la celda derecha parece otro "key:value", ignórala (es otro campo)
          if (!kvRegex.test(v1)) {
            w.found = true;
            w.value = v1; // puede ser ""
          }
        }
      }
    }

    // Empuja siempre ambos campos, con lo que se haya encontrado (o vacío)
    for (const id of Object.keys(wanted)) {
      const w = wanted[id];
      fields.push({ key: w.key, label: w.label, kind: "text", value: w.value });
    }

    // 2) Bloque "Afectación a otras áreas" (SI/NO excepto "Otros:" que es texto)
    const idxAfectacion = t.findIndex((r) =>
      /^afectaci[óo]n a otras [áa]reas:?$/i.test(normalize(r[0]))
    );
    if (idxAfectacion !== -1) {
      for (let r = idxAfectacion + 1; r < t.length; r++) {
        const left = get(r, 0);
        const right = get(r, 1);

        // cortar cuando llega otro subtítulo
        if (/^afectaci[óo]n a los pa[ií]ses de la regi[óo]n$/i.test(left))
          break;
        if (/^participaci[óo]n de proveedores$/i.test(left)) break;
        if (!left && !right) continue;

        // Quita numeración "1. ", "2. ", etc.
        const mNum = left.match(/^\d+\.\s*(.+)$/);
        const label = normalize(mNum ? mNum[1] : left).replace(/:$/, "");
        if (!label) continue;

        // Saltar filas de ayuda
        if (
          /^respuesta\s*:\s*si\/no$/i.test(right) ||
          /^respuesta\s*:\s*si\/no$/i.test(label)
        )
          continue;

        // "Otros" es TEXTO, no SI/NO
        if (/^otros$/i.test(label)) {
          fields.push({
            key: "otros",
            label: "Otros",
            kind: "text",
            value: normalize(right || ""),
          });
          continue;
        }

        // Resto SI/NO
        const val = normalize(right || "");
        const yn = /^(si|sí|no)$/i.test(val)
          ? val.toUpperCase()
          : val
          ? val.toUpperCase()
          : "NO";
        fields.push({
          key: label.toLowerCase().replace(/\s+/g, "-"),
          label,
          kind: "select",
          value: yn,
          options: YES_NO,
        });
      }
    }

    // 3) País afectado (fila con "Seleccionar país afectado..." y X bajo REG/HN/GT/PA/NI)
    const selRowIndex = t.findIndex((r) =>
      /^seleccionar pa[ií]s afectado/i.test(normalize(r[0]))
    );
    if (selRowIndex !== -1) {
      // cabeceras de países arriba
      const hasCountry = (row: string[]) =>
        row.some((c) => /^(REG|HN|GT|PA|NI)$/i.test(normalize(c)));
      let headerRow = t[selRowIndex - 1] || [];
      if (!hasCountry(headerRow) && selRowIndex - 2 >= 0)
        headerRow = t[selRowIndex - 2] || [];

      const idxByCountry: Record<string, number> = {};
      headerRow.forEach((c, i) => {
        const k = normalize(c).toUpperCase();
        if (["REG", "HN", "GT", "PA", "NI"].includes(k)) idxByCountry[k] = i;
      });

      let elegido = "";
      const rowSel = t[selRowIndex] || [];
      for (const [pais, idx] of Object.entries(idxByCountry)) {
        if (normalize(rowSel[idx] || "") === "X") {
          elegido = pais;
          break;
        }
      }

      fields.push({
        key: "pais-afectado",
        label: "País afectado",
        kind: "select",
        value: elegido || "REG",
        options: PAISES,
      });
    }

    // 4) Participa Proveedor (SI/NO)
    const idxProv = t.findIndex((r) =>
      /^participaci[óo]n de proveedores$/i.test(normalize(r[0]))
    );
    if (idxProv !== -1) {
      const row = t[idxProv + 1] || [];
      const val = normalize(row[1] || row[0] || "");
      const yn = /^(si|sí|no)$/i.test(val) ? val.toUpperCase() : "NO";
      fields.push({
        key: "participa-proveedor",
        label: "Participa Proveedor",
        kind: "select",
        value: yn,
        options: YES_NO,
      });
    }

    if (fields.length) {
      const order = [
        "id-cambio",
        "tipo-requerimiento",
        "afecta-dwh",
        "afecta-cierre",
        "afecta-robot",
        "notificó-al-noc-sobre-los-servicios-a-monitorear",
        "es-regulatorio",
        "otros",
        "pais-afectado",
        "participa-proveedor",
      ];
      fields.sort((a, b) => {
        const ia = order.indexOf(a.key);
        const ib = order.indexOf(b.key);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });

      seccionesReconocidas.push({
        id: "informacion-general",
        title: "Información general",
        fields,
      });
    }
  })();

  // src/lib/docx-parser.ts (añade esto cerca del final, antes del return)
  // function nk(s: string) {
  //   return (s || "")
  //     .toLowerCase()
  //     .normalize("NFD")
  //     .replace(/[\u0300-\u036f]/g, "")
  //     .replace(/\s+/g, " ")
  //     .trim();
  // }
  // function textDeep(cell: any): string {
  //   const paras = Array.isArray(cell?.["w:p"])
  //     ? cell["w:p"]
  //     : cell?.["w:p"]
  //     ? [cell["w:p"]]
  //     : [];
  //   const pickText = (p: any) => {
  //     const runs = p?.["w:r"]
  //       ? Array.isArray(p["w:r"])
  //         ? p["w:r"]
  //         : [p["w:r"]]
  //       : [];
  //     return runs
  //       .map((r: any) => {
  //         const t = r?.["w:t"];
  //         if (typeof t === "string") return t;
  //         if (t?.["#text"]) return t["#text"];
  //         return "";
  //       })
  //       .join("");
  //   };
  //   return paras.map(pickText).join(" ").replace(/\s+/g, " ").trim();
  // }
  // function rowToTexts(tr: any): string[] {
  //   const cells = Array.isArray(tr?.["w:tc"])
  //     ? tr["w:tc"]
  //     : tr?.["w:tc"]
  //     ? [tr["w:tc"]]
  //     : [];
  //   return cells.map((tc: any) => textDeep(tc));
  // }
  function findInfoGeneralTable(tables: any[][][]): any[][] | null {
    // Heurística: tabla que contenga "INFORMACIÓN GENERAL" o filas con "ID de Cambio:" y "*Tipo de Requerimiento:"
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
        // Busca SI/NO en celdas del final
        const rev = [...row].reverse();
        for (const cell of rev) {
          const t = cell.trim().toUpperCase().replace("SÍ", "SI");
          if (t === "SI" || t === "NO") return t as "SI" | "NO";
        }
        // fallback: si la fila tiene 2 celdas y la segunda es "SI"/"NO"
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
        // Mismo cell: "Otros: valor"
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
    // Header con columnas REG HN GT PA NI y la fila siguiente con "X"
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
        // intenta fila siguiente como selección
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
    const paises = extractCountries(infoTbl); // ["REG","HN",...]

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
