import { createContext, useContext, useEffect, useId, type ReactNode } from "react";

/**
 * 저장하지 않은 입력 추적.
 * 입력 컴포넌트가 useReportUnsaved(dirty) 로 알리면, App 은 페이지 전환·목록 이동 전에
 * hasUnsaved() 로 확인해 사용자에게 물어본다. 화면에는 아무것도 그리지 않는다.
 */
export type UnsavedRegistry = Set<string>;

const UnsavedContext = createContext<UnsavedRegistry | null>(null);

export function UnsavedChangesProvider({ registry, children }: { registry: UnsavedRegistry; children: ReactNode }) {
  return <UnsavedContext.Provider value={registry}>{children}</UnsavedContext.Provider>;
}

/** dirty 가 true 인 동안 '저장하지 않은 입력이 있음'으로 등록한다. 언마운트되면 해제된다. */
export function useReportUnsaved(dirty: boolean) {
  const registry = useContext(UnsavedContext);
  const id = useId();
  useEffect(() => {
    if (!registry) return;
    if (dirty) registry.add(id);
    else registry.delete(id);
    return () => {
      registry.delete(id);
    };
  }, [registry, id, dirty]);
}
