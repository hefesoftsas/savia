import Globe from "lucide-react/icons/globe";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useAuth } from "@/components/auth-context";
import { makeOrgRequest } from "@/services/utils";

import { CodeBlock } from "@/components/docs/code-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/utils/utils";

import { EXECUTE_ENDPOINT_SNIPPETS } from "../../api-snippets";
import { createWidget } from "../widget";

type HttpTriggerMode = "request" | "webhook";
interface SaviaHttpAuthority {
  configured: boolean;
  active: boolean;
  configuredBy?: "you";
}

interface HttpTriggerInputProps {
  mode: HttpTriggerMode;
  className?: string;
  disabled?: boolean;
}

/**
 * Widget for the HTTP trigger nodes. The execution URL is derived from the
 * workflow id (`/http/:workflowId`) — there is no endpoint to select — so the
 * widget is just an "Integrate" button that reveals the HTTP Trigger dialog
 * with copy-paste snippets for calling it with an API key.
 */
function HttpTriggerInputWidget({
  mode,
  className,
  disabled = false,
}: HttpTriggerInputProps) {
  const { id: workflowId } = useParams<{ id: string }>();
  const { organization } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [authority, setAuthority] = useState<SaviaHttpAuthority | null>(null);
  const [authorityError, setAuthorityError] = useState("");

  useEffect(() => {
    if (!isDialogOpen || !organization?.id || !workflowId) return;
    let current = true;
    setAuthority(null);
    setAuthorityError("");
    makeOrgRequest<SaviaHttpAuthority>(
      organization.id,
      "/workflows",
      `/${workflowId}/savia-http-authority`,
    )
      .then((result) => {
        if (current) setAuthority(result);
      })
      .catch(() => {
        if (current)
          setAuthorityError(
            "Could not check Savia access. Reopen this dialog after reconnecting.",
          );
      });
    return () => {
      current = false;
    };
  }, [isDialogOpen, organization?.id, workflowId]);

  const executeUrl = workflowId
    ? `${window.location.origin}/api/public/savia-flows/http/${workflowId}`
    : "";

  return (
    <div className={cn("p-2", className)}>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={disabled || !workflowId}
        onClick={() => setIsDialogOpen(true)}
      >
        <Globe className="h-3 w-3" />
        Integrate
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>HTTP Trigger</DialogTitle>
            <DialogDescription>
              {mode === "webhook"
                ? "Executes asynchronously and returns an execution ID. Poll the status endpoint for results."
                : "Executes synchronously and returns the execution result, including each node's output."}{" "}
              Authenticate with an API key from your account settings. Enable
              the workflow before calling it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Savia collection access</p>
            {authorityError ? (
              <p role="alert" className="text-destructive">
                {authorityError}
              </p>
            ) : !authority ? (
              <p className="text-muted-foreground">
                Checking execution access…
              </p>
            ) : authority.active ? (
              <p className="text-muted-foreground">
                Native Savia nodes run with{" "}
                {authority.configuredBy === "you"
                  ? "your"
                  : "the enabling user’s"}{" "}
                current permissions. Access is checked on every call.
              </p>
            ) : (
              <p className="text-muted-foreground">
                To use native Savia nodes, disable and enable this workflow from
                Savia. It will use the current access of the user who enables
                it.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Requests require a Flows API key. Incoming data cannot choose the
              execution user.
            </p>
          </div>
          <Tabs defaultValue="curl" className="w-full min-w-0">
            <TabsList>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="javascript">JavaScript</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="curl" className="mt-4 min-w-0">
              <CodeBlock language="bash">
                {EXECUTE_ENDPOINT_SNIPPETS.curl(executeUrl)}
              </CodeBlock>
            </TabsContent>
            <TabsContent value="javascript" className="mt-4 min-w-0">
              <CodeBlock language="javascript">
                {EXECUTE_ENDPOINT_SNIPPETS.javascript(executeUrl)}
              </CodeBlock>
            </TabsContent>
            <TabsContent value="python" className="mt-4 min-w-0">
              <CodeBlock language="python">
                {EXECUTE_ENDPOINT_SNIPPETS.python(executeUrl)}
              </CodeBlock>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const httpRequestTriggerWidget = createWidget({
  component: HttpTriggerInputWidget,
  nodeTypes: ["http-request"],
  extractConfig: () => ({ mode: "request" as HttpTriggerMode }),
});

export const httpWebhookTriggerWidget = createWidget({
  component: HttpTriggerInputWidget,
  nodeTypes: ["http-webhook"],
  extractConfig: () => ({ mode: "webhook" as HttpTriggerMode }),
});
