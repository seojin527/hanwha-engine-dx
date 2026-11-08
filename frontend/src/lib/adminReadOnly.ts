import { createContext, useContext } from "react";

/** Shared administrator views default to read-only; only the administrator role enables changes. */
export const AdminReadOnlyContext = createContext(true);
export function useAdminReadOnly() { return useContext(AdminReadOnlyContext); }
