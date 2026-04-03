import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { WorkspaceBootstrapState, WorkspaceMembership } from "./hub/types";
import { supabase } from "../lib/supabase";

/** Workspace bootstrap; call once from the shell (MyDashboard). */
export function useWorkspaceBootstrap(
  setWorkspace: Dispatch<SetStateAction<WorkspaceBootstrapState>>,
  activeOrgId: string | null
) {
  const activeOrgIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeOrgIdRef.current = activeOrgId;
  }, [activeOrgId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setWorkspace((w) => ({ ...w, loading: true, loadError: null }));

      const memRes = await supabase.from("workspace_memberships").select(`
            id,
            organisation_id,
            workspace_role,
            membership_status,
            organisations (
              id,
              name
            )
          `);

      if (cancelled) return;

      const loadError = memRes.error
        ? `Workspaces: ${memRes.error.message}`
        : null;

      const rows = (memRes.data as WorkspaceMembership[] | null) ?? [];

      let nextOrgId: string | null = null;
      if (rows.length === 0) {
        nextOrgId = null;
      } else {
        const prev = activeOrgIdRef.current;
        const chosen =
          prev !== null && rows.some((r) => r.organisation_id === prev)
            ? rows.find((r) => r.organisation_id === prev)!
            : rows[0];
        nextOrgId = chosen.organisation_id;
      }

      setWorkspace({
        memberships: rows,
        loading: false,
        loadError,
        activeOrgId: nextOrgId,
      });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [setWorkspace]);
}
