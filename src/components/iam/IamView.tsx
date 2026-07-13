import * as React from "react";
import {
  KeyRound,
  ShieldCheck,
  RefreshCw,
  Users,
  ScrollText,
  Link2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CenteredSpinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { namespaceScope } from "@/lib/scope";
import { formatAge } from "@/lib/utils";
import { type ClusterTab, useAppStore } from "@/store/useAppStore";
import { api } from "@/lib/api";
import type { GvkSpec, KubeObject } from "@/lib/types";

// --- Section definitions ---------------------------------------------------

type SectionId =
  | "ServiceAccounts"
  | "Roles"
  | "RoleBindings"
  | "ClusterRoles"
  | "ClusterRoleBindings";

const SECTIONS: { id: SectionId; label: string; gvk: GvkSpec }[] = [
  {
    id: "ServiceAccounts",
    label: "ServiceAccounts",
    gvk: {
      group: "",
      version: "v1",
      kind: "ServiceAccount",
      plural: "serviceaccounts",
      namespaced: true,
    },
  },
  {
    id: "Roles",
    label: "Roles",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "Role",
      plural: "roles",
      namespaced: true,
    },
  },
  {
    id: "RoleBindings",
    label: "RoleBindings",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "RoleBinding",
      plural: "rolebindings",
      namespaced: true,
    },
  },
  {
    id: "ClusterRoles",
    label: "ClusterRoles",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "ClusterRole",
      plural: "clusterroles",
      namespaced: false,
    },
  },
  {
    id: "ClusterRoleBindings",
    label: "ClusterRoleBindings",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "ClusterRoleBinding",
      plural: "clusterrolebindings",
      namespaced: false,
    },
  },
];

const WI_ANNOTATION = "iam.gke.io/gcp-service-account";

// --- Narrowing helpers -----------------------------------------------------

function name(o: KubeObject): string {
  return o.metadata?.name ?? "—";
}

function ns(o: KubeObject): string {
  return o.metadata?.namespace ?? "—";
}

function age(o: KubeObject): string {
  return formatAge(o.metadata?.creationTimestamp);
}

function gcpServiceAccount(o: KubeObject): string | null {
  const v = o.metadata?.annotations?.[WI_ANNOTATION];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function secretsCount(o: KubeObject): number {
  const s = o.secrets;
  return Array.isArray(s) ? s.length : 0;
}

function rulesCount(o: KubeObject): number {
  const r = o.rules;
  return Array.isArray(r) ? r.length : 0;
}

interface RoleRef {
  name: string;
  kind: string;
}

function roleRef(o: KubeObject): RoleRef {
  const rr = o.roleRef;
  if (rr && typeof rr === "object") {
    const rec = rr as Record<string, unknown>;
    return {
      name: typeof rec.name === "string" ? rec.name : "—",
      kind: typeof rec.kind === "string" ? rec.kind : "—",
    };
  }
  return { name: "—", kind: "—" };
}

function subjectNames(o: KubeObject): string {
  const subs = o.subjects;
  if (!Array.isArray(subs)) return "—";
  const names = subs
    .map((s) => {
      if (s && typeof s === "object") {
        const n = (s as Record<string, unknown>).name;
        if (typeof n === "string") return n;
      }
      return null;
    })
    .filter((n): n is string => !!n);
  return names.length > 0 ? names.join(", ") : "—";
}

// --- Component -------------------------------------------------------------

export function IamView({ tab }: { tab: ClusterTab }) {
  const reportError = useAppStore((s) => s.reportError);
  const [section, setSection] = React.useState<SectionId>("ServiceAccounts");
  const [items, setItems] = React.useState<KubeObject[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [firstLoad, setFirstLoad] = React.useState(true);
  const [query, setQuery] = React.useState("");

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  const load = React.useCallback(async () => {
    setLoading(true);
    const scope = namespaceScope(tab);
    const gvk = active.gvk;
    try {
      const result = await api.listResources(
        tab.context,
        gvk,
        gvk.namespaced ? scope.queryNamespace : null,
      );
      const filtered = gvk.namespaced
        ? result.filter((o) => scope.matches(o.metadata?.namespace))
        : result;
      setItems(filtered);
    } catch (e) {
      reportError(e, tab.context);
      setItems([]);
    } finally {
      setLoading(false);
      setFirstLoad(false);
    }
  }, [tab, active, reportError]);

  React.useEffect(() => {
    setFirstLoad(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.context, tab.namespaceMode, tab.namespaces.join(","), section]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter(
        (o) =>
          name(o).toLowerCase().includes(q) ||
          ns(o).toLowerCase().includes(q),
      )
    : items;

  // Workload Identity summary (ServiceAccounts only).
  const wiBound = React.useMemo(
    () =>
      section === "ServiceAccounts"
        ? items.filter((o) => gcpServiceAccount(o) !== null).length
        : 0,
    [items, section],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header row: pill sub-tabs + refresh + search */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/40 px-4 py-2">
        <div className="flex items-center gap-1">
          {SECTIONS.map((s) => {
            const isActive = s.id === section;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setSection(s.id);
                  setQuery("");
                }}
                className={
                  "rounded-full px-3 py-1 text-[12px] font-medium transition-colors " +
                  (isActive
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground")
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Filter by name or namespace…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-56"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {firstLoad && loading ? (
          <CenteredSpinner label={`Loading ${active.label}…`} />
        ) : (
          <div className="rounded-lg border border-border bg-card">
            {section === "ServiceAccounts" && (
              <ServiceAccountsSection
                items={visible}
                total={items.length}
                wiBound={wiBound}
              />
            )}
            {section === "Roles" && <RolesSection items={visible} />}
            {section === "RoleBindings" && <RoleBindingsSection items={visible} />}
            {section === "ClusterRoles" && <ClusterRolesSection items={visible} />}
            {section === "ClusterRoleBindings" && (
              <ClusterRoleBindingsSection items={visible} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Table primitives ------------------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-border px-3 py-2 text-left font-semibold text-muted-foreground">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-1.5 align-middle">{children}</td>;
}

function TableShell({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0 z-10 bg-card">
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-3 py-8 text-center text-muted-foreground"
      >
        No items.
      </td>
    </tr>
  );
}

const rowClass = "border-b border-border/60 hover:bg-accent/50";

// --- Sections --------------------------------------------------------------

function ServiceAccountsSection({
  items,
  total,
  wiBound,
}: {
  items: KubeObject[];
  total: number;
  wiBound: number;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
        <ShieldCheck className="size-4 text-[hsl(var(--info))]" />
        <span>
          <strong>{wiBound}</strong> of <strong>{total}</strong> ServiceAccounts
          bound to a GCP IAM account via Workload Identity
        </span>
      </div>
      <TableShell
        head={
          <>
            <Th>Name</Th>
            <Th>Namespace</Th>
            <Th>GCP Service Account</Th>
            <Th>Secrets</Th>
            <Th>Age</Th>
          </>
        }
      >
        {items.length === 0 ? (
          <EmptyRow colSpan={5} />
        ) : (
          items.map((o) => {
            const gsa = gcpServiceAccount(o);
            return (
              <tr key={`${ns(o)}/${name(o)}`} className={rowClass}>
                <Td>
                  <span className="font-medium">{name(o)}</span>
                </Td>
                <Td>{ns(o)}</Td>
                <Td>
                  {gsa ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">
                        <KeyRound className="mr-1 inline size-3" />
                        {gsa}
                      </Badge>
                      <Badge tone="ok">WI</Badge>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      no Workload Identity
                    </span>
                  )}
                </Td>
                <Td>{secretsCount(o)}</Td>
                <Td>{age(o)}</Td>
              </tr>
            );
          })
        )}
      </TableShell>
    </>
  );
}

function RolesSection({ items }: { items: KubeObject[] }) {
  return (
    <TableShell
      head={
        <>
          <Th>Name</Th>
          <Th>Namespace</Th>
          <Th>Rules</Th>
          <Th>Age</Th>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyRow colSpan={4} />
      ) : (
        items.map((o) => (
          <tr key={`${ns(o)}/${name(o)}`} className={rowClass}>
            <Td>
              <span className="flex items-center gap-1.5 font-medium">
                <ScrollText className="size-3 text-muted-foreground" />
                {name(o)}
              </span>
            </Td>
            <Td>{ns(o)}</Td>
            <Td>{rulesCount(o)}</Td>
            <Td>{age(o)}</Td>
          </tr>
        ))
      )}
    </TableShell>
  );
}

function RoleBindingsSection({ items }: { items: KubeObject[] }) {
  return (
    <TableShell
      head={
        <>
          <Th>Name</Th>
          <Th>Namespace</Th>
          <Th>Role</Th>
          <Th>Kind</Th>
          <Th>Subjects</Th>
          <Th>Age</Th>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyRow colSpan={6} />
      ) : (
        items.map((o) => {
          const rr = roleRef(o);
          return (
            <tr key={`${ns(o)}/${name(o)}`} className={rowClass}>
              <Td>
                <span className="flex items-center gap-1.5 font-medium">
                  <Link2 className="size-3 text-muted-foreground" />
                  {name(o)}
                </span>
              </Td>
              <Td>{ns(o)}</Td>
              <Td>{rr.name}</Td>
              <Td>
                <Badge tone="muted">{rr.kind}</Badge>
              </Td>
              <Td>
                <span className="text-muted-foreground">{subjectNames(o)}</span>
              </Td>
              <Td>{age(o)}</Td>
            </tr>
          );
        })
      )}
    </TableShell>
  );
}

function ClusterRolesSection({ items }: { items: KubeObject[] }) {
  return (
    <TableShell
      head={
        <>
          <Th>Name</Th>
          <Th>Rules</Th>
          <Th>Age</Th>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyRow colSpan={3} />
      ) : (
        items.map((o) => (
          <tr key={name(o)} className={rowClass}>
            <Td>
              <span className="flex items-center gap-1.5 font-medium">
                <Users className="size-3 text-muted-foreground" />
                {name(o)}
              </span>
            </Td>
            <Td>{rulesCount(o)}</Td>
            <Td>{age(o)}</Td>
          </tr>
        ))
      )}
    </TableShell>
  );
}

function ClusterRoleBindingsSection({ items }: { items: KubeObject[] }) {
  return (
    <TableShell
      head={
        <>
          <Th>Name</Th>
          <Th>Role</Th>
          <Th>Subjects</Th>
          <Th>Age</Th>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyRow colSpan={4} />
      ) : (
        items.map((o) => {
          const rr = roleRef(o);
          return (
            <tr key={name(o)} className={rowClass}>
              <Td>
                <span className="flex items-center gap-1.5 font-medium">
                  <Link2 className="size-3 text-muted-foreground" />
                  {name(o)}
                </span>
              </Td>
              <Td>{rr.name}</Td>
              <Td>
                <span className="text-muted-foreground">{subjectNames(o)}</span>
              </Td>
              <Td>{age(o)}</Td>
            </tr>
          );
        })
      )}
    </TableShell>
  );
}
