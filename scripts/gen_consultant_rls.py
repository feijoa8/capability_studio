#!/usr/bin/env python3
"""Emit SQL DROP/CREATE POLICY statements with workspace_membership_row_effective(wm)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

POLICY_BLOCK = re.compile(
    r'(CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?("?[\w]+"?)\s+FOR[\s\S]+?;)',
    re.MULTILINE | re.IGNORECASE,
)


def inject_alias(body: str, alias: str) -> str:
    """After alias.user_id = auth.uid() (optional membership_status), add row_effective."""
    flag = f"workspace_membership_row_effective({alias})"
    pat = re.compile(
        rf"(AND\s+{alias}\.user_id\s*=\s*auth\.uid\(\)"
        rf"(?:\s*\n\s*AND\s+{alias}\.membership_status\s*=\s*'active')?)",
        re.IGNORECASE | re.MULTILINE,
    )

    def repl(m: re.Match) -> str:
        start = m.start()
        window = body[start : start + 400]
        if flag in window:
            return m.group(1)
        return m.group(1) + f"\n        AND public.workspace_membership_row_effective({alias})"

    return pat.sub(repl, body)


def patch_policy_body(body: str) -> str:
    if "workspace_memberships" not in body:
        return body
    body = inject_alias(body, "wm")
    body = inject_alias(body, "wm2")
    return body


def extract_policies(sql: str) -> list[tuple[str, str, str]]:
    out = []
    for m in POLICY_BLOCK.finditer(sql):
        body, name, table = m.group(1), m.group(2), m.group(3).strip('"')
        if "workspace_memberships" not in body:
            continue
        out.append((name, table, patch_policy_body(body)))
    return out


def main() -> None:
    mig_dir = ROOT / "supabase" / "migrations"
    files = sorted(
        [
            f
            for f in mig_dir.glob("*.sql")
            if f.name != "20260622140100_learning_consultant_rls_policies.sql"
        ],
        reverse=True,
    )
    seen: set[tuple[str, str]] = set()
    policies: list[tuple[str, str, str]] = []
    for f in files:
        text = f.read_text()
        for name, table, body in extract_policies(text):
            key = (table, name)
            if key in seen:
                continue
            seen.add(key)
            policies.append((table, name, body))

    out = [
        "-- Generated: consultant RLS — policies recreated with workspace_membership_row_effective.",
        "-- Drops prior policies by name and recreates patched bodies.",
        "",
    ]
    for table, name, body in policies:
        out.append(f'DROP POLICY IF EXISTS "{name}" ON public.{table};')
        out.append(body)
        out.append("")
    Path(sys.argv[1]).write_text("\n".join(out))


if __name__ == "__main__":
    main()
