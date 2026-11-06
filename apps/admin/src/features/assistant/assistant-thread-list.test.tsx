import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantThreadList } from "./assistant-thread-list";
import type { AssistantThreadSummary } from "./assistant-threads-client";

const sampleThreads: AssistantThreadSummary[] = [
  {
    id: "thread-1",
    userId: "owner",
    title: "¿Cuántos clientes por ciudad?",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 2,
    messageCount: 2,
    preview: "¿Cuántos clientes por ciudad? Medellín",
  },
  {
    id: "thread-2",
    userId: "owner",
    title: "Cotizaciones de seguros",
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    revision: 1,
    messageCount: 1,
    preview: "Muestra las cotizaciones aprobadas",
  },
];

describe("AssistantThreadList", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders empty state when there are no threads", () => {
    const onNew = vi.fn();
    render(
      <AssistantThreadList
        threads={[]}
        activeThreadId={null}
        onSelectThread={vi.fn()}
        onNewThread={onNew}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(screen.getByText("Sin conversaciones previas")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Comenzar conversación" }),
    ).toBeVisible();
  });

  it("renders list of threads with titles and message counts", () => {
    render(
      <AssistantThreadList
        threads={sampleThreads}
        activeThreadId="thread-1"
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(screen.getByText("¿Cuántos clientes por ciudad?")).toBeVisible();
    expect(screen.getByText("Cotizaciones de seguros")).toBeVisible();
    expect(screen.getByText("2 mensajes")).toBeVisible();
    expect(screen.getByText("1 mensaje")).toBeVisible();
    expect(screen.getByText("Activo")).toBeVisible();
  });

  it("selects a thread when clicking on it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <AssistantThreadList
        threads={sampleThreads}
        activeThreadId="thread-1"
        onSelectThread={onSelect}
        onNewThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Cotizaciones de seguros"));
    expect(onSelect).toHaveBeenCalledWith("thread-2");
  });

  it("filters threads based on search input", async () => {
    const user = userEvent.setup();

    render(
      <AssistantThreadList
        threads={sampleThreads}
        activeThreadId="thread-1"
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    const searchInput = screen.getByRole("textbox", {
      name: "Buscar conversaciones",
    });
    await user.type(searchInput, "Cotizaciones");

    expect(screen.getByText("Cotizaciones de seguros")).toBeVisible();
    expect(
      screen.queryByText("¿Cuántos clientes por ciudad?"),
    ).not.toBeInTheDocument();
  });

  it("calls onDeleteThread when clicking delete button", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <AssistantThreadList
        threads={sampleThreads}
        activeThreadId="thread-1"
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onDeleteThread={onDelete}
      />,
    );

    const deleteBtn = screen.getByRole("button", {
      name: "Eliminar conversación: ¿Cuántos clientes por ciudad?",
    });
    await user.click(deleteBtn);

    expect(onDelete).toHaveBeenCalledWith("thread-1");
  });
});
