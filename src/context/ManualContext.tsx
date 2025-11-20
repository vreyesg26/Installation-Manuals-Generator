import { createContext, useContext } from "react";
import { useManualManager } from "@/hooks/useManualManager";

const ManualContext = createContext<any>(null);

export function ManualProvider({ children }: { children: React.ReactNode }) {
  const manual = useManualManager();
  return (
    <ManualContext.Provider value={manual}>{children}</ManualContext.Provider>
  );
}

export function useManual() {
  const ctx = useContext(ManualContext);
  if (!ctx) {
    throw new Error("useManual debe usarse dentro de <ManualProvider>");
  }
  return ctx;
}
