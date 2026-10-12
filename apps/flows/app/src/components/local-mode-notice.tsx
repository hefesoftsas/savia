import { Link } from "react-router";
import { useAuth } from "@/components/auth-context";
import { useOrgUrl } from "@/hooks/use-org-url";

export function LocalModeNotice({ feature }: { feature: string }) {
  const { organization } = useAuth();
  const { getOrgUrl } = useOrgUrl();
  return (
    <main className="mx-auto flex min-h-[55vh] max-w-2xl flex-col justify-center px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-wide text-primary">
        Savia Flows · local mode
      </p>
      <h1 className="mt-3 text-2xl font-semibold">
        {feature} is unavailable in local mode
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        The editor and workflow catalog are available locally. This feature
        needs an external AI or provider service, so it is disabled here and no
        simulated result will be shown.
      </p>
      {organization?.id ? (
        <Link
          className="mt-6 w-fit text-sm font-medium text-primary underline underline-offset-4"
          to={getOrgUrl("workflows")}
        >
          Return to workflows
        </Link>
      ) : null}
    </main>
  );
}
