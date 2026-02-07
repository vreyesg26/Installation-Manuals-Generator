// src/lib/docx-pieces-parser.ts
import type { PiezasGrupo, PiezasItem } from "@/types/manual";

const normalize = (s: string | undefined | null): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

type HeaderMap = {
  nombre: number;
  tipo: number;
  estado: number;
};

/** Detecta si una celda parece ser un título de grupo (RGCARD, NICARD, etc.) */
function isGroupTitleCell(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;

  // Muy corto y sin dos puntos => casi seguro es el nombre del grupo
  if (t.length <= 40 && !t.includes(":")) return true;

  return false;
}

/** Mapea una fila a columnas Nombre / Tipo / Estado (horizontal) */
function mapHorizontalHeaders(headers: string[]): HeaderMap | null {
  const map: HeaderMap = { nombre: -1, tipo: -1, estado: -1 };

  headers.forEach((raw, i) => {
    const h = normalize(raw).toLowerCase();

    if (h === "nombre") {
      map.nombre = i;
    } else if (h === "tipo") {
      map.tipo = i;
    } else if (
      h === "nuevo o modificado" ||
      h === "nuevo/modificado" ||
      h === "nuevo o\nmodificado" ||
      /nuevo\s*o\s*modificado/i.test(h) ||
      h === "nuevo" ||
      h === "modificado"
    ) {
      map.estado = i;
    }
  });

  const valid = map.nombre >= 0 && map.tipo >= 0 && map.estado >= 0;
  return valid ? map : null;
}

/**
 * Busca la fila de headers en TODA la tabla (no solo en las primeras filas).
 * Devuelve:
 *  - headerIndex: índice de la fila de header
 *  - map: mapeo nombre/tipo/estado -> índice de columna
 */
function findHorizontalHeaderRow(
  table: string[][]
): { headerIndex: number; map: HeaderMap } | null {
  for (let i = 0; i < table.length; i++) {
    const row = table[i];
    if (!row?.length) continue;

    const map = mapHorizontalHeaders(row);
    if (map) {
      return { headerIndex: i, map };
    }
  }

  return null;
}

/** Dado el índice de header, trata de encontrar el título del grupo en filas anteriores */
function inferGroupTitleFromContext(
  table: string[][],
  headerIndex: number
): string {
  const LOOKBACK = 3;

  for (let i = headerIndex - 1; i >= 0 && i >= headerIndex - LOOKBACK; i--) {
    const row = table[i];
    if (!row?.length) continue;

    // Tomamos solo las celdas no vacías
    const nonEmpty = row.map(normalize).filter(Boolean);

    // Caso típico: una sola celda con el nombre del grupo (RGCARD, NICARD, etc.)
    if (nonEmpty.length === 1 && isGroupTitleCell(nonEmpty[0])) {
      return nonEmpty[0];
    }
  }

  // Fallback
  return "Sin nombre";
}

/** Extrae items desde una tabla horizontal */
function extractHorizontalTable(table: string[][]): PiezasGrupo | null {
  if (!table.length) return null;

  const headerInfo = findHorizontalHeaderRow(table);
  if (!headerInfo) return null;

  const { headerIndex, map: headerMap } = headerInfo;

  const grupo = inferGroupTitleFromContext(table, headerIndex);
  const items: PiezasItem[] = [];

  for (let i = headerIndex + 1; i < table.length; i++) {
    const row = table[i];
    if (!row) continue;

    const nombre = normalize(row[headerMap.nombre]);
    const tipo = normalize(row[headerMap.tipo]);
    const estadoRaw = normalize(row[headerMap.estado]);

    if (!nombre && !tipo && !estadoRaw) continue;

    const estado = /nuevo/i.test(estadoRaw)
      ? "Nuevo"
      : /modificado/i.test(estadoRaw)
      ? "Modificado"
      : estadoRaw || "Modificado";

    items.push({ nombre, tipo, estado });
  }

  if (!items.length) return null;

  return {
    grupo,
    items,
  };
}

/** Extrae items desde una tabla vertical (Nombre / Tipo / Estado en una columna) */
function extractVerticalTable(table: string[][]): PiezasGrupo | null {
  if (!table.length) return null;

  const col0 = table.map((row) =>
    normalize(row.find((c) => normalize(c)) ?? "")
  );

  const items: PiezasItem[] = [];
  let headerIndex = -1;

  for (let i = 0; i < col0.length - 3; i++) {
    const h1 = col0[i];
    const h2 = col0[i + 1];
    const h3 = col0[i + 2];

    if (
      /^nombre$/i.test(h1) &&
      /^tipo$/i.test(h2) &&
      /nuevo\s*o\s*modificado/i.test(h3)
    ) {
      headerIndex = i;
      let j = i + 3;

      while (j + 2 < col0.length) {
        const nombre = col0[j];
        const tipo = col0[j + 1];
        const estadoRaw = col0[j + 2];

        if (!nombre && !tipo && !estadoRaw) break;

        const estado = /nuevo/i.test(estadoRaw)
          ? "Nuevo"
          : /modificado/i.test(estadoRaw)
          ? "Modificado"
          : estadoRaw || "Modificado";

        items.push({ nombre, tipo, estado });
        j += 3;
      }

      break;
    }
  }

  if (headerIndex === -1 || !items.length) return null;

  // Buscamos un posible título por encima
  const grupo = inferGroupTitleFromContext(
    table,
    headerIndex /* se reutiliza la misma lógica */
  );

  return {
    grupo,
    items,
  };
}

/**
 * Parser híbrido principal:
 * - Recorre TODAS las tablas del documento
 * - Intenta interpretarlas como tablas de piezas (horizontal o vertical)
 * - Si no calzan con el patrón (Nombre/Tipo/Nuevo o Modificado), se ignoran
 */
export function parsePiezas(tables: string[][][]): PiezasGrupo[] {
  const out: PiezasGrupo[] = [];

  console.log("Cantidad de tablas encontradas:", tables.length);

  tables.forEach((table, index) => {
    if (!table?.length) return;

    console.log(`\n======= TABLA #${index} RAW =======`);
    console.log(JSON.stringify(table, null, 2));

    const flatPreview = table
      .slice(0, 4)
      .flat()
      .map((c) => normalize(c))
      .join(" | ");
    console.log(`\n[Tabla #${index}] Preview:`, flatPreview);

    const horizontal = extractHorizontalTable(table);
    if (horizontal) {
      console.log(
        `➡ Tabla #${index} detectada como HORIZONTAL, grupo: ${horizontal.grupo}, filas: ${horizontal.items.length}`
      );
      out.push(horizontal);
      return;
    }

    const vertical = extractVerticalTable(table);
    if (vertical) {
      console.log(
        `➡ Tabla #${index} detectada como VERTICAL, grupo: ${vertical.grupo}, filas: ${vertical.items.length}`
      );
      out.push(vertical);
      return;
    }

    console.log(`Tabla #${index} NO coincide con el patrón de piezas.`);
  });

  console.log("TOTAL GRUPOS PIEZAS:", out.length);

  return out;
}
