// src/components/FieldsForm.tsx
import { useEffect, useState } from "react";
import type { UISection } from "@/types/manual";
import {
  Card,
  Title,
  Grid,
  Stack,
  Text,
  Select,
  MultiSelect,
  TextInput,
} from "@mantine/core";

type FieldValue = string | string[];

interface Props {
  sections?: UISection[];
  onChange?: (sections: UISection[]) => void;
}

export function FieldsForm({ sections, onChange }: Props) {
  const [state, setState] = useState<UISection[]>(sections ?? []);
  const NON_REG = ["HN", "NI", "PA", "GT"] as const;

  useEffect(() => {
    if (sections) setState(sections);
  }, [sections]);

  function updateField(
    secIndex: number,
    fieldIndex: number,
    value: FieldValue
  ) {
    const next = structuredClone(state);
    (next[secIndex].fields[fieldIndex] as any).value = value;
    setState(next);
    onChange?.(next);
  }

  if (!state?.length) return null;

  return (
    <Stack gap="xl" w="100%">
      {state.map((sec, si) => (
        <Card key={sec.id} shadow="sm" padding="lg" radius="md" withBorder>
          <Title order={4} mb="md">
            {sec.title}
          </Title>

          <Grid gutter="md">
            {sec.fields.map((f, fi) => {
              const kind = (f as any).kind as "text" | "select" | "multiselect";
              const value = (f as any).value as FieldValue;
              const options =
                f.options?.map((op: any) => ({
                  value: String(op.value),
                  label: String(op.label ?? op.value),
                })) ?? [];

              return (
                <Grid.Col key={f.key} span={{ base: 12, md: 6 }}>
                  <Stack gap={6}>
                    <Text size="sm" fw={600}>
                      {f.label}
                    </Text>

                    {kind === "multiselect" ? (
                      <MultiSelect
                        data={options}
                        value={Array.isArray(value) ? value : []}
                        onChange={(vals) => {
                          const prev = Array.isArray(value) ? value : [];
                          let next = [...vals];

                          const hasREG = vals.includes("REG");
                          const prevHadREG = prev.includes("REG");

                          // Normaliza: nunca mezclar REG con otros
                          if (hasREG) {
                            if (!prevHadREG) {
                              // Acaban de seleccionar REG -> dejar solo REG
                              next = ["REG"];
                            } else if (vals.length > 1) {
                              // Tenían REG y seleccionaron otro -> quitar REG
                              next = vals.filter((v) => v !== "REG");
                            } else {
                              next = ["REG"];
                            }
                          } else {
                            // Asegura que REG no esté si no lo eligieron
                            next = vals.filter((v) => v !== "REG");
                          }

                          // Regla de "colapsar" a REG si están los 4 países
                          const nonRegSelected = new Set(
                            next.filter((v) => v !== "REG")
                          );
                          const allFourSelected =
                            NON_REG.every((c) => nonRegSelected.has(c)) &&
                            nonRegSelected.size === NON_REG.length;

                          if (allFourSelected) {
                            next = ["REG"];
                          }

                          updateField(si, fi, next);
                        }}
                        searchable
                        clearable
                        radius="md"
                        comboboxProps={{
                          transitionProps: { transition: "pop" },
                        }}
                      />
                    ) : kind === "select" ? (
                      <Select
                        data={options}
                        value={typeof value === "string" ? value : ""}
                        onChange={(val) => updateField(si, fi, val ?? "")}
                        searchable
                        radius="md"
                        allowDeselect={false}
                        comboboxProps={{
                          transitionProps: { transition: "pop" },
                        }}
                      />
                    ) : (
                      <TextInput
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) =>
                          updateField(si, fi, e.currentTarget.value)
                        }
                        radius="md"
                      />
                    )}
                  </Stack>
                </Grid.Col>
              );
            })}
          </Grid>
        </Card>
      ))}
    </Stack>
  );
}
