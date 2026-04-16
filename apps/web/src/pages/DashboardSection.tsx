import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { WorkspaceBootstrapState, WorkspaceMembership } from "./hub/types";
import { supabase } from "../lib/supabase";
import { membershipGrantsOrgData } from "../lib/membershipEffective";

/** Workspace bootstrap; call once from the shell (MyDashboard). */
export function useWorkspaceBootstrap(
  setWorkspace: Dispatch<SetStateAction<WorkspaceBootstrapState>>,
  activeOrgId: string | null,
) {
  const activeOrgIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeOrgIdRef.current = activeOrgId;
  }, [activeOrgId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setWorkspace((w) => ({ ...w, loading: true, loadError: null }));

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) {
        if (!cancelled) {
          setWorkspace({
            memberships: [],
            allMembershipRows: [],
            loading: false,
            loadError: null,
            activeOrgId: null,
          });
        }
        return;
      }

      const [memRes, profRes] = await Promise.all([
        supabase.from("workspace_memberships").select(`
            id,
            organisation_id,
            workspace_role,
            system_role,
            access_type,
            approved_by_owner,
            is_primary,
            membership_status,
            organisations (
              id,
              name
            )
          `),
        supabase
          .from("profiles")
          .select("system_role")
          .eq("id", uid)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const loadError = memRes.error
        ? `Workspaces: ${memRes.error.message}`
        : null;

      const profileSystemRole = (profRes.data?.system_role as string | null) ?? null;

      const raw = (memRes.data as WorkspaceMembership[] | null) ?? [];
      const rows = raw.filter((m) =>
        membershipGrantsOrgData(m, profileSystemRole),
      );

      let nextOrgId: string | null = null;
      if (rows.length === 0) {
        nextOrgId = null;
      } else {
        const prev = activeOrgIdRef.current;
        if (prev !== null && rows.some((r) => r.organisation_id === prev)) {
          nextOrgId = prev;
        } else {
          const seen = new Set<string>();
          const orgIds: string[] = [];
          for (const r of rows) {
            if (!seen.has(r.organisation_id)) {
              seen.add(r.organisation_id);
              orgIds.push(r.organisation_id);
            }
          }
          orgIds.sort();
          nextOrgId = orgIds[0] ?? rows[0]!.organisation_id;
        }
      }

      setWorkspace({
        memberships: rows,
        allMembershipRows: raw,
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
