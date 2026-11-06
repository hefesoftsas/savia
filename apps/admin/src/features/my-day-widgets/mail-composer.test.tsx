import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import { afterEach, expect, it, vi } from "vitest";
import { MailComposer } from "./mail-composer";
import type { PersonalMailLike } from "./use-my-day-mail";
afterEach(cleanup);
const connections = [
  {
    provider: "gmail" as const,
    status: "connected",
    externalAccountLabel: "me@gmail.com",
  },
  {
    provider: "outlook" as const,
    status: "connected",
    externalAccountLabel: "me@outlook.com",
  },
];
function props() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    onSent: vi.fn(),
    sessionRevision: 0,
    connections,
    personalIntegrations: {
      sendMail: vi.fn(async () => ({
        provider: "gmail",
        action: "send-email",
      })),
    } as unknown as PersonalMailLike,
  };
}
function fill() {
  fireEvent.change(screen.getByLabelText("Para"), {
    target: { value: "ana@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Asunto"), {
    target: { value: "Review" },
  });
  fireEvent.change(screen.getByLabelText("Mensaje"), {
    target: { value: "My introduction" },
  });
}
it("retains prose while switching accounts and sends only after explicit click", async () => {
  const input = props();
  render(<MailComposer {...input} />);
  fill();
  fireEvent.change(screen.getByLabelText("Enviar desde"), {
    target: { value: "outlook" },
  });
  expect(screen.getByLabelText("Mensaje")).toHaveValue("My introduction");
  expect(input.personalIntegrations.sendMail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enviar correo" }));
  await waitFor(() => expect(input.onOpenChange).toHaveBeenCalledWith(false));
  expect(input.onSent).toHaveBeenCalledOnce();
  expect(input.personalIntegrations.sendMail).toHaveBeenCalledWith({
    provider: "outlook",
    to: ["ana@example.com"],
    subject: "Review",
    body: "My introduction",
  });
});
it("retains draft on unknown outcome and does not retry or double send", async () => {
  const input = props();
  let reject!: (error: Error) => void;
  vi.mocked(input.personalIntegrations.sendMail).mockReturnValue(
    new Promise((_done, fail) => {
      reject = fail;
    }),
  );
  render(<MailComposer {...input} />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Enviar correo" }));
  expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
  await act(async () => reject(new Error("network timeout")));
  expect(screen.getByRole("alert")).toHaveTextContent("Enviados");
  expect(screen.getByLabelText("Mensaje")).toHaveValue("My introduction");
  expect(input.personalIntegrations.sendMail).toHaveBeenCalledTimes(1);
});
it("inserts only selected readable fields and sends their context reference", async () => {
  const input = props();
  const api = {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/tenant-workspaces")
        return {
          data: [
            {
              id: "1",
              tenantId: 1,
              kind: "tenant",
              label: "Workspace",
              apiBasePath: "/v1/studio/1",
            },
          ],
        };
      if (path.endsWith("/objects"))
        return {
          data: [
            {
              name: "contacts",
              label: "Contacts",
              config: {
                fields: {
                  name: { type: "Text", label: "Name" },
                  hidden: { type: "Text", label: "Hidden" },
                },
              },
            },
          ],
        };
      if (path.includes("?"))
        return { data: [{ id: "1", name: "Ana" }], total: 26 };
      return { data: { id: "1", name: "Ana" } };
    }),
  };
  render(<MailComposer {...input} apiClient={api as never} />);
  fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Agregar contexto de un registro" }),
  );
  await screen.findByRole("option", { name: "Workspace" });
  fireEvent.change(screen.getByLabelText("Espacio de datos"), {
    target: { value: "/v1/studio/1" },
  });
  await screen.findByRole("option", { name: "Contacts" });
  fireEvent.change(screen.getByLabelText("Colección de contexto"), {
    target: { value: "contacts" },
  });
  await screen.findByRole("option", { name: "Ana" });
  expect(
    screen.getByRole("button", { name: "Página siguiente" }),
  ).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Registro de contexto"), {
    target: { value: "1" },
  });
  const field = await screen.findByLabelText("Name");
  expect(screen.queryByLabelText("Hidden")).not.toBeInTheDocument();
  fireEvent.click(field);
  fireEvent.click(screen.getByRole("button", { name: "Insertar contexto" }));
  expect(screen.getByLabelText("Mensaje")).toHaveValue(
    "My introduction\n\nContacts\nName: Ana",
  );
  expect(screen.getByLabelText("Para")).toHaveValue("ana@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Enviar correo" }));
  await waitFor(() =>
    expect(input.personalIntegrations.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        context: [
          {
            apiBasePath: "/v1/studio/1",
            collection: "contacts",
            recordId: "1",
            fields: ["name"],
          },
        ],
      }),
    ),
  );
});
it("clears draft when session changes", () => {
  const input = props();
  const view = render(<MailComposer {...input} />);
  fill();
  view.rerender(<MailComposer {...input} sessionRevision={1} />);
  expect(screen.getByLabelText("Mensaje")).toHaveValue("");
});
