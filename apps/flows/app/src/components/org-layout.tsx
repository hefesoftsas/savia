import type { OrganizationInfo } from "@savia/flows-types";
import Bot from "lucide-react/icons/bot";
import Database from "lucide-react/icons/database";
import FlaskConical from "lucide-react/icons/flask-conical";
import Folder from "lucide-react/icons/folder";
import Inbox from "lucide-react/icons/inbox";
import KeyRound from "lucide-react/icons/key-round";
import LayoutDashboard from "lucide-react/icons/layout-dashboard";
import Lock from "lucide-react/icons/lock";
import Logs from "lucide-react/icons/logs";
import Mail from "lucide-react/icons/mail";
import MessageSquareText from "lucide-react/icons/message-square-text";
import Plug from "lucide-react/icons/plug";
import SquareTerminal from "lucide-react/icons/square-terminal";
import TableProperties from "lucide-react/icons/table-properties";

import Wand from "lucide-react/icons/wand";
import React, { useEffect } from "react";
import { useParams } from "react-router";

import { useAuth } from "@/components/auth-context";
import { AppLayout } from "@/components/layouts/app-layout";
import { TourProvider } from "@/components/tour";
import { useOrganizations } from "@/services/organizations-service";

interface OrgLayoutProps {
  children: React.ReactNode;
  title: string;
  /**
   * Drop the sidebar and the tour, keeping only the org syncing.
   *
   * For screens that run before the user has any reason to care that
   * workflows, executions and datasets are separate things. The tour comes out
   * with the chrome because it is a tour *of* the chrome: five steps pointing
   * at a sidebar this layout does not render.
   */
  focused?: boolean;
}

export const getDashboardSidebarGroups = (orgId: string, canManage = true) => {
  const groups = [
    {
      items: [
        {
          title: "Dashboard",
          url: `/org/${orgId}/dashboard`,
          icon: LayoutDashboard,
        },
      ],
    },
    {
      label: "Workflows",
      items: [
        {
          title: "Workflows",
          url: `/org/${orgId}/workflows`,
          icon: SquareTerminal,
        },

        {
          title: "Executions",
          url: `/org/${orgId}/executions`,
          icon: Logs,
        },
        {
          title: "Feedback",
          url: `/org/${orgId}/feedback`,
          icon: MessageSquareText,
        },
        {
          title: "Templates",
          url: `/org/${orgId}/templates`,
          icon: Wand,
        },
        {
          title: "Playground",
          url: `/org/${orgId}/playground`,
          icon: FlaskConical,
        },
      ],
    },
    {
      label: "Resources",
      items: [
        {
          title: "Schemas",
          url: `/org/${orgId}/schemas`,
          icon: TableProperties,
        },
        {
          title: "Databases",
          url: `/org/${orgId}/databases`,
          icon: Database,
        },
        {
          title: "Datasets",
          url: `/org/${orgId}/datasets`,
          icon: Folder,
        },
        {
          title: "Integrations",
          url: `/org/${orgId}/integrations`,
          icon: Plug,
        },
        {
          title: "Secrets",
          url: `/org/${orgId}/secrets`,
          icon: Lock,
        },
        {
          title: "Emails",
          url: `/org/${orgId}/emails`,
          icon: Mail,
        },
        {
          title: "Queues",
          url: `/org/${orgId}/queues`,
          icon: Inbox,
        },
        {
          title: "Bots",
          url: `/org/${orgId}/bots`,
          icon: Bot,
        },
      ],
    },
  ];

  // Add Settings section
  if (canManage) {
    groups.push({
      label: "Settings",
      items: [
        {
          title: "API Keys",
          url: `/org/${orgId}/api-keys`,
          icon: KeyRound,
        },
      ],
    });
  }

  return canManage
    ? groups
    : groups.filter((group) => group.label !== "Resources");
};

export const OrgLayout: React.FC<OrgLayoutProps> = ({
  children,
  title,
  focused,
}) => {
  const params = useParams<{ organizationId: string }>();
  const { organization, setSelectedOrganization, user } = useAuth();
  const { organizations: orgList } = useOrganizations();

  useEffect(() => {
    if (params.organizationId && organization?.id && orgList.length > 0) {
      if (params.organizationId !== organization.id) {
        const targetOrg = orgList.find(
          (org) => org.id === params.organizationId,
        );
        if (targetOrg) {
          const newOrg: OrganizationInfo = {
            id: targetOrg.id,
            name: targetOrg.name,
            role: "owner",
          };
          setSelectedOrganization(newOrg);
        }
      }
    }
  }, [
    params.organizationId,
    organization?.id,
    orgList,
    setSelectedOrganization,
  ]);

  if (!organization?.id) {
    // Fallback to a loading state or redirect
    return <div>Loading...</div>;
  }

  if (focused) {
    return (
      <AppLayout>
        <div className="contents" data-page-title={title}>
          {children}
        </div>
      </AppLayout>
    );
  }

  const canManage = Boolean(
    user?.platformAdmin ||
    organization.role === "admin" ||
    organization.role === "owner",
  );
  if (
    !canManage &&
    [
      "Schemas",
      "Databases",
      "Datasets",
      "Integrations",
      "Secrets",
      "Emails",
      "Queues",
      "Bots",
      "Settings",
    ].includes(title)
  ) {
    return (
      <div className="p-6 text-sm" role="alert">
        These Savia Flows resources are available to tenant administrators.
      </div>
    );
  }

  const sidebarGroups = getDashboardSidebarGroups(organization.id, canManage);

  return (
    <AppLayout
      sidebar={{
        title: "Savia Flows",
        groups: sidebarGroups,
        footerItems: [],
      }}
    >
      <TourProvider>
        <div className="contents" data-page-title={title}>
          {children}
        </div>
      </TourProvider>
    </AppLayout>
  );
};
