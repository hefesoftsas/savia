// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CollectionRelations from "../collection-relations";
import { api } from "../api";
import { makeConfig } from "@savia/crm-shared/metadata";
vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: ({ onConnect, nodes, edges, nodeTypes, onEdgeClick, onNodeClick }: any) => <div>{nodes.map((node: any) => { const Node = nodeTypes[node.type]; return <div key={node.id}><button onClick={() => onNodeClick(null, node)}>Seleccionar {node.data.label}</button><Node id={node.id} data={node.data} /></div>; })}{edges.map((edge: any) => <button key={edge.id} data-source-handle={edge.sourceHandle} data-target-handle={edge.targetHandle} onClick={() => onEdgeClick(null, edge)}>Editar arista</button>)}<button onClick={() => onConnect({ source: "agencies", target: "clients", sourceHandle: "out:id", targetHandle: "in:agency_id" })}>Conectar mapa</button><button onClick={() => onConnect({ source: "agencies", target: "clients", sourceHandle: "out:id", targetHandle: "in:input_agency_id" })}>Conectar relación nativa</button></div>, useUpdateNodeInternals: () => () => {}, Handle: ({ id }: any) => <span data-testid={`handle-${id}`} />, Background: () => null, Controls: () => null, MarkerType: { ArrowClosed: "arrow" }, Position: { Right: "right", Left: "left" } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const objects = [{ name: "agencies", label: "Agencias" }, { name: "clients", label: "Clientes" }].map(o => ({ ...o, description: "", config: makeConfig(o.name === "clients" ? { agency_id: { type: "Textbox", label: "Agencia" } } : { name: { type: "Textbox", label: "Nombre" } }) }));
const nativeObjects = [{ name: "agencies", label: "Agencias" }, { name: "clients", label: "Clientes" }].map(o => ({ ...o, description: "", config: makeConfig(o.name === "clients" ? { input_agency_id: { type: "Textbox", label: "ID de agencia" } } : { name: { type: "Textbox", label: "Nombre" } }) }));
it("prepares connection without saving until explicit form submission", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollectionRelations objects={objects} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Nueva relación", exact: true })).toBeEnabled());
  expect(screen.queryByLabelText("Campo de origen")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Conectar mapa" }));
  expect(screen.getByLabelText("Colección de origen")).toHaveValue("agencies");
  expect(screen.getByLabelText("Nombre visto desde el origen")).toHaveValue("Clientes");
  expect(vi.mocked(api).mock.calls.some(c => c[1] === "POST")).toBe(false);
  fireEvent.change(screen.getByLabelText("Nombre visto desde el destino"), { target: { value: "Agencia" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear relación", exact: true }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/collection-relations", "POST", { sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "fields", sourceField: "id", targetField: "agency_id", sourceDisplayField: null, targetDisplayField: null }));
});

it("renders field handles and edits an existing relation with its version", async () => {
  const relation = { id: "r1", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "fields", sourceField: "id", targetField: "agency_id", sourceDisplayField: "name", targetDisplayField: "id", version: 4 };
  vi.mocked(api).mockResolvedValue({ data: [relation] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollectionRelations objects={objects} /></QueryClientProvider>);
  const edge = await screen.findByRole("button", { name: "Editar arista" });
  expect(edge).toHaveAttribute("data-source-handle", "out:id");
  expect(edge).toHaveAttribute("data-target-handle", "in:agency_id");
  expect(screen.getByTestId("handle-in:agency_id")).toBeInTheDocument();
  fireEvent.click(edge);
  expect(screen.getByLabelText("Campo de destino")).toHaveValue("agency_id");
  expect(screen.getByLabelText("Colección de origen")).toBeDisabled();
  expect(screen.getByLabelText("Colección de destino")).toBeDisabled();
  expect(screen.getByLabelText("Campo para mostrar el origen")).toHaveValue("name");
  fireEvent.change(screen.getByLabelText("Nombre visto desde el origen"), { target: { value: "Cartera" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  const { id, ...payload } = relation;
  await waitFor(() => expect(api).toHaveBeenCalledWith("/collection-relations/r1", "PUT", { ...payload, sourceLabel: "Cartera" }));
});
it("keeps native physical fields immutable and allows cancelling edits", async () => {
  vi.mocked(api).mockResolvedValue({ data: [{ id: "native", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "native", sourceField: "id", targetField: "agency_id", version: 0 }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollectionRelations objects={objects} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arista" }));
  expect(screen.getByLabelText("Campo de destino")).toBeDisabled();
  expect(screen.getByLabelText("Colección de origen")).toBeDisabled();
  expect(screen.getByLabelText("Campo para mostrar el origen")).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar edición" }));
  expect(screen.queryByLabelText("Colección de origen")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Nueva relación" }));
  expect(screen.getByLabelText("Colección de origen")).toHaveValue("");
});

it("opens the native relation when the map uses an exposed field alias", async () => {
  vi.mocked(api).mockResolvedValue({ data: [{ id: "native:agencies:clients", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "native", sourceField: "id", targetField: "agency_id", version: 1 }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollectionRelations objects={nativeObjects} /></QueryClientProvider>);

  await screen.findByRole("button", { name: "Editar arista" });
  fireEvent.click(await screen.findByRole("button", { name: "Conectar relación nativa" }));

  expect(screen.getByRole("dialog")).toHaveTextContent("Configuración guardada");
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeVisible();
  expect(screen.getByLabelText("Colección de origen")).toBeDisabled();
});

it("preserves automatic display names when editing only a native label", async () => {
  const relation = { id: "native", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "native", sourceField: "id", targetField: "agency_id", sourceDisplayField: null, targetDisplayField: null, version: 1 };
  vi.mocked(api).mockResolvedValue({ data: [relation] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollectionRelations objects={objects} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arista" }));
  expect(screen.getByLabelText("Campo para mostrar el origen")).toHaveValue("");
  expect(screen.getByLabelText("Campo para mostrar el destino")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Nombre visto desde el origen"), { target: { value: "Cartera" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  const { id, ...payload } = relation;
  await waitFor(() => expect(api).toHaveBeenCalledWith("/collection-relations/native", "PUT", { ...payload, sourceLabel: "Cartera" }));
});

it("loads the existing relation when selecting a collection", async () => {
  vi.mocked(api).mockResolvedValue({data:[{id:"r1",sourceObject:"agencies",targetObject:"clients",sourceLabel:"Cartera",targetLabel:"Agencia",sourceField:"id",targetField:"agency_id",storage:"fields",cardinality:"one-to-many",version:3}]});
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects}/></QueryClientProvider>);
  await screen.findByRole("button",{name:"Editar arista"});
  fireEvent.click(screen.getByRole("button",{name:"Seleccionar Clientes"}));
  expect(screen.getByRole("dialog")).toHaveTextContent("Configuración guardada");
  expect(screen.getByLabelText("Campo de destino")).toHaveValue("agency_id");
  expect(screen.getByLabelText("Nombre visto desde el origen")).toHaveValue("Cartera");
});

it("adds an unrelated entity to a focused map without creating a saved relation", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} focusObject="clients" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Nueva relación", exact: true })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Seleccionar Agencias" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Entidad para agregar al mapa"), { target: { value: "agencies" } });
  fireEvent.click(screen.getByRole("button", { name: "Agregar entidad", exact: true }));
  expect(screen.getByRole("button", { name: "Seleccionar Agencias" })).toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.some(call => call[1] === "POST")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Conectar mapa" }));
  expect(screen.getByLabelText("Campo de destino")).toHaveValue("agency_id");
});

it("prepares a supported manual relationship for connected entities", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  const connected = objects.map(o => ({ ...o, config: { ...o.config, studio: { ...o.config.studio, business: "managed-customer" as const } } }));
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={connected} focusObject="clients" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Nueva relación", exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Nueva relación", exact: true }));
  fireEvent.change(screen.getByLabelText("Colección de destino"), { target: { value: "agencies" } });
  expect(screen.getByLabelText("Cómo se relacionan los registros")).toHaveValue("local");
  expect(screen.getByLabelText("Nombre visto desde el origen")).toHaveValue("Agencias");
  expect(screen.getByLabelText("Nombre visto desde el destino")).toHaveValue("Clientes");
  expect(screen.getByRole("button", { name: "Crear relación", exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Crear relación", exact: true }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/collection-relations", "POST", expect.objectContaining({ sourceObject: "clients", targetObject: "agencies", storage: "local", sourceField: "id", targetField: "id" })));
});

it("renders native endpoints even when physical fields are absent from editable metadata", async () => {
  vi.mocked(api).mockResolvedValue({ data: [{ id: "native", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "native", sourceField: "id", targetField: "agency_id", version: 1 }] });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={nativeObjects} /></QueryClientProvider>);
  await screen.findByRole("button", { name: "Editar arista" });
  expect(screen.getByTestId("handle-in:agency_id")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Editar arista" }));
  expect(screen.getByLabelText("Campo de destino")).toHaveValue("agency_id");
});

it("keeps entered values and the map when saving a relation fails", async () => {
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === "POST") throw new Error("Conflicto de cardinalidad");
    return { data: [] };
  });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} focusObject="clients" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Nueva relación", exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Conectar mapa" }));
  fireEvent.click(screen.getByRole("button", { name: "Crear relación", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Conflicto de cardinalidad");
  expect(screen.getByLabelText("Colección de origen")).toHaveValue("agencies");
  expect(screen.getByLabelText("Campo de destino")).toHaveValue("agency_id");
  expect(screen.getByRole("button", { name: "Crear relación", exact: true })).toBeEnabled();
});

it("shows a new relation created between entities outside the original focus", async () => {
  const extra = { ...objects[0], name: "other", label: "Otra entidad" };
  let saved: any[] = [];
  vi.mocked(api).mockImplementation(async (_path, method, body) => {
    if (method === "POST") saved = [{ ...(body as object), id: "new", version: 1 }];
    return { data: saved };
  });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={[...objects, extra]} focusObject="clients" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Nueva relación", exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Nueva relación", exact: true }));
  fireEvent.change(screen.getByLabelText("Colección de origen"), { target: { value: "agencies" } });
  fireEvent.change(screen.getByLabelText("Colección de destino"), { target: { value: "other" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear relación", exact: true }));
  await screen.findByRole("button", { name: "Editar arista" });
  expect(screen.getByRole("button", { name: "Seleccionar Agencias" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Seleccionar Otra entidad" })).toBeInTheDocument();
});

it("reopens an existing manual relation when connected fields normalize to IDs", async () => {
  vi.mocked(api).mockResolvedValue({ data: [{ id: "manual", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "local", sourceField: "id", targetField: "id", version: 1 }] });
  const connected = objects.map(o => ({ ...o, config: { ...o.config, studio: { ...o.config.studio, business: "managed-customer" as const } } }));
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={connected} /></QueryClientProvider>);
  await screen.findByRole("button", { name: "Editar arista" });
  fireEvent.click(screen.getByRole("button", { name: "Conectar mapa" }));
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  expect(screen.getByLabelText("Campo de destino")).toHaveValue("id");
});

it("removes a related entity only from the map and allows adding it back", async () => {
  vi.mocked(api).mockResolvedValue({ data: [{ id: "r1", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "one-to-many", storage: "fields", sourceField: "id", targetField: "agency_id", version: 1 }] });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} focusObject="clients" /></QueryClientProvider>);
  await screen.findByRole("button", { name: "Editar arista" });
  fireEvent.click(screen.getByRole("button", { name: "Quitar Agencias del mapa" }));
  expect(screen.queryByRole("button", { name: "Seleccionar Agencias" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar arista" })).not.toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.some(call => call[1] === "DELETE")).toBe(false);
  expect(screen.getByRole("button", { name: "Editar relación", exact: true })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Entidad para agregar al mapa"), { target: { value: "agencies" } });
  fireEvent.click(screen.getByRole("button", { name: "Agregar entidad", exact: true }));
  expect(screen.getByRole("button", { name: "Editar arista" })).toBeInTheDocument();
});

it("publishes a field from the map and exposes it as a connection endpoint", async () => {
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path === "/objects/clients" && method === "PUT") return { data: { ...(body as object), name: "clients", version: 2 } };
    return { data: [] };
  });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Crear campo en Clientes" }));
  fireEvent.change(screen.getByLabelText("Nombre del campo"), { target: { value: "Código de agencia" } });
  fireEvent.change(screen.getByLabelText("Identificador del campo"), { target: { value: "agency_code" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar campo" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByTestId("handle-in:agency_code")).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/objects/clients", "PUT", expect.objectContaining({ version: 1, config: expect.objectContaining({ fields: expect.objectContaining({ agency_id: expect.any(Object), agency_code: { type: "Textbox", label: "Código de agencia" } }), fieldOrder: ["agency_id", "agency_code"] }) }));
  fireEvent.click(screen.getByRole("button", { name: "Nueva relación", exact: true }));
  fireEvent.change(screen.getByLabelText("Colección de origen"), { target: { value: "agencies" } });
  fireEvent.change(screen.getByLabelText("Colección de destino"), { target: { value: "clients" } });
  fireEvent.change(screen.getByLabelText("Campo de destino"), { target: { value: "agency_code" } });
  expect(screen.getByLabelText("Campo de destino")).toHaveValue("agency_code");
  fireEvent.click(screen.getByRole("button", { name: "Crear relación", exact: true }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/collection-relations", "POST", expect.objectContaining({targetField: "agency_code", storage: "fields"})));
});

it("keeps a failed field draft and does not display a field that was not saved", async () => {
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === "PUT") throw new Error("Otra persona cambió la estructura. Recarga el diseñador.");
    return { data: [] };
  });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Crear campo en Clientes" }));
  fireEvent.change(screen.getByLabelText("Nombre del campo"), { target: { value: "Código" } });
  fireEvent.change(screen.getByLabelText("Identificador del campo"), { target: { value: "code" } });
  fireEvent.click(screen.getByLabelText("Valores únicos"));
  fireEvent.click(screen.getByRole("button", { name: "Guardar campo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Otra persona cambió");
  expect(screen.getByLabelText("Identificador del campo")).toHaveValue("code");
  expect(screen.queryByTestId("handle-in:code")).not.toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/objects/clients", "PUT", expect.objectContaining({config: expect.objectContaining({fields: expect.objectContaining({code: { type: "Textbox", label: "Código", config: {unique: true} }})})}));
});

it("does not offer schema writes for connected entities", () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  const connected = objects.map(o => ({ ...o, config: { ...o.config, studio: { ...o.config.studio, business: "managed-customer" as const } } }));
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={connected} /></QueryClientProvider>);
  expect(screen.getByRole("button", { name: "Crear campo en Clientes" })).toBeDisabled();
});

it("rejects an existing field identifier without overwriting its definition", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Crear campo en Clientes" }));
  fireEvent.change(screen.getByLabelText("Nombre del campo"), { target: { value: "Otro" } });
  fireEvent.change(screen.getByLabelText("Identificador del campo"), { target: { value: "agency_id" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar campo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe un campo");
  expect(vi.mocked(api).mock.calls.some(call => call[1] === "PUT")).toBe(false);
});

it("binds an existing manual relation to its form field and connects that handle", async () => {
  let relation = { id: "manual", sourceObject: "agencies", targetObject: "clients", sourceLabel: "Clientes", targetLabel: "Agencia", cardinality: "many-to-many", storage: "local", sourceField: "id", targetField: "id", version: 1 };
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path === "/objects/clients" && method === "PUT") return {data:{...(body as object),version:2}};
    if (method === "PUT") {relation={...relation,...(body as object),version:2};return {data:relation};}
    return {data:[relation]};
  });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", {name:"Editar arista"}));
  fireEvent.change(screen.getByLabelText("Campo del formulario de destino"), {target:{value:"agency_id"}});
  fireEvent.click(screen.getByRole("button", {name:"Guardar cambios"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api).toHaveBeenCalledWith("/objects/clients", "PUT", expect.objectContaining({version:1,config:expect.objectContaining({fields:expect.objectContaining({agency_id:expect.objectContaining({config:expect.objectContaining({collectionRelation:"manual",multiple:true})})})})}));
  expect(screen.getByRole("button", {name:"Editar arista"})).toHaveAttribute("data-target-handle","in:agency_id");
});

it("allows rebinding a field whose former relation no longer exists", async () => {
  vi.mocked(api).mockResolvedValue({data:[]});
  const stale = objects.map(o=>o.name==="clients" ? {...o,config:{...o.config,fields:{agency_id:{type:"Textbox",label:"Agencia",config:{collectionRelation:"deleted"}}}}} : o);
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={stale} /></QueryClientProvider>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Nueva relación",exact:true})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"Nueva relación",exact:true}));
  fireEvent.change(screen.getByLabelText("Colección de origen"),{target:{value:"agencies"}});
  fireEvent.change(screen.getByLabelText("Colección de destino"),{target:{value:"clients"}});
  fireEvent.change(screen.getByLabelText("Cómo se relacionan los registros"),{target:{value:"local"}});
  fireEvent.change(screen.getByLabelText("Campo del formulario de destino"),{target:{value:"agency_id"}});
  expect(screen.getByLabelText("Campo del formulario de destino")).toHaveValue("agency_id");
});

it("renders create field and remove node actions as icon buttons with tooltips", async () => {
  vi.mocked(api).mockResolvedValue({ data: [] });
  render(<QueryClientProvider client={new QueryClient()}><CollectionRelations objects={objects} /></QueryClientProvider>);
  const createButton = screen.getByRole("button", { name: "Crear campo en Clientes" });
  const removeButton = screen.getByRole("button", { name: "Quitar Clientes del mapa" });

  expect(createButton).toHaveAttribute("title", "Crear campo");
  expect(createButton.querySelector("svg")).toBeInTheDocument();

  expect(removeButton).toHaveAttribute("title", "Quitar del mapa");
  expect(removeButton.querySelector("svg")).toBeInTheDocument();
});

