import { useState } from "react";
import type { PiezasGrupo, PiezasItem } from "@/types/manual";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

function Row({
  item,
  onChange,
}: {
  item: PiezasItem;
  onChange: (v: PiezasItem) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Input
        value={item.nombre}
        onChange={(e) => onChange({ ...item, nombre: e.target.value })}
        placeholder="nombre.ext"
      />
      <Input
        value={item.tipo}
        onChange={(e) => onChange({ ...item, tipo: e.target.value })}
        placeholder="Tipo"
      />
      <Input
        value={item.estado}
        onChange={(e) => onChange({ ...item, estado: e.target.value })}
        placeholder="Nuevo/Modificado"
      />
    </div>
  );
}

export function PiezasTable({
  grupo,
  onUpdate,
}: {
  grupo: PiezasGrupo;
  onUpdate: (g: PiezasGrupo) => void;
}) {
  const [state, setState] = useState<PiezasGrupo>(grupo);
  return (
    <Card className="p-4 space-y-3">
      <div className="text-lg font-semibold">{state.grupo}</div>
      <div className="grid grid-cols-3 gap-2 text-sm text-muted-foreground">
        <Label>Nombre</Label>
        <Label>Tipo</Label>
        <Label>Estado</Label>
      </div>
      <div className="space-y-2">
        {state.items.map((it, idx) => (
          <Row
            key={idx}
            item={it}
            onChange={(v) => {
              const next = { ...state, items: [...state.items] };
              next.items[idx] = v;
              setState(next);
              onUpdate(next);
            }}
          />
        ))}
      </div>
    </Card>
  );
}
