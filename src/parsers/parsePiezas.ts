import type { PiezasGrupo, PiezasItem } from "@/types/manual";

const normalize = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();

const SECTION_START = "Listado de piezas detalladas (Nuevos / Modificados)";
const SECTION_END =
  "Listado de piezas detalladas para Bugfix / Hotfix / Incidencia (Nuevos / Modificados)";

type HeaderMap = { nombre: number; tipo: number; estado: number };

function mapHorizontalHeaders(headers: string[]): HeaderMap | null {
  const map: HeaderMap = { nombre: -1, tipo: -1, estado: -1 };

  headers.forEach((raw, i) => {
    const h = normalize(raw).toLowerCase();
    if (h === "nombre") map.nombre = i;
    else if (h === "tipo") map.tipo = i;
    else if (h.includes("nuevo") || h.includes("modificado")) map.estado = i;
  });

  return map.nombre >= 0 && map.tipo >= 0 && map.estado >= 0 ? map : null;
}

function extractHorizontalTable(table: string[][]): PiezasItem[] {
  if (!table.length) return [];

  const headers = table[0];
  const headerMap = mapHorizontalHeaders(headers);
  if (!headerMap) return [];

  const items: PiezasItem[] = [];

  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    if (!row) continue;

    const nombre = normalize(row[headerMap.nombre] ?? "");
    const tipo = normalize(row[headerMap.tipo] ?? "");
    const estadoRaw = normalize(row[headerMap.estado] ?? "");

    if (!nombre && !tipo && !estadoRaw) continue;

    const estado = /nuevo/i.test(estadoRaw)
      ? "Nuevo"
      : /modificado/i.test(estadoRaw)
      ? "Modificado"
      : estadoRaw || "Modificado";

    items.push({ nombre, tipo, estado });
  }

  return items;
}

export function parsePiezas(tables: string[][][]): PiezasGrupo[] {
  const grupos: PiezasGrupo[] = [];

  let inside = false;
  let repoNames: string[] = [];

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    if (!table?.length) continue;

    const firstRow = table[0].map(normalize).join(" ");

    console.log("ROW TEXT:", firstRow);

    if (firstRow.includes(SECTION_START)) {
      inside = true;
      continue;
    }

    if (firstRow.includes(SECTION_END)) {
      inside = false;
      break;
    }

    if (!inside) continue;

    if (repoNames.length === 0) {
      repoNames = table[0].map(normalize).filter(Boolean);
      console.log("Repos detectados:", repoNames);
      continue;
    }

    const repoIndex = grupos.length;

    if (repoIndex >= repoNames.length) {
      console.warn("Más tablas que repos detectados");
      break;
    }

    const grupo = repoNames[repoIndex];
    const items = extractHorizontalTable(table);

    grupos.push({
      grupo,
      items,
    });
  }

  console.log("Piezas detectadas:", grupos);
  return grupos;
}
