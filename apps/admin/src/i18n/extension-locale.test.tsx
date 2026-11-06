import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { memoryStore, StoreContextProvider } from "ra-core";
import { useState } from "react";
import { AppLocaleProvider } from "./app-locale-provider";
import { usePluginMessages } from "@savia/studio-shared/plugin-locale-react";
afterEach(cleanup);
it("bridges the host locale to extensions while retaining drafts", () => {
 const store=memoryStore({locale:"es"});
 function Extension(){const t=usePluginMessages({save:["Guardar","Save","Salvar"]} as const); const [draft,setDraft]=useState(""); return <><input aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/><button>{t("save")}</button></>;}
 render(<StoreContextProvider value={store}><AppLocaleProvider><Extension/></AppLocaleProvider></StoreContextProvider>);
 fireEvent.change(screen.getByLabelText("Draft"),{target:{value:"Custom text"}});
 act(()=>store.setItem("locale","en"));
 expect(screen.getByRole("button",{name:"Save"})).toBeVisible();
 act(()=>store.setItem("locale","pt"));
 expect(screen.getByRole("button",{name:"Salvar"})).toBeVisible();
 expect(screen.getByLabelText("Draft")).toHaveValue("Custom text");
});
