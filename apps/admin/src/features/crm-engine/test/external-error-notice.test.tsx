import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StoreContextProvider, memoryStore } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { ExternalErrorNotice } from "../external-error-notice";
afterEach(cleanup);
it("updates structured service guidance while preserving and escaping provider details", () => {
 const store=memoryStore({locale:"en"});
 const failure={code:"rate_limited", message:"Provider <script>alert(1)</script>"};
 render(<StoreContextProvider value={store}><AppLocaleProvider><ExternalErrorNotice error={failure}/></AppLocaleProvider></StoreContextProvider>);
 expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
 expect(screen.getByText(failure.message)).toBeInTheDocument();
 expect(document.querySelector("script")).toBeNull();
 act(()=>store.setItem("locale","pt"));
 expect(screen.getByRole("alert")).toHaveTextContent("solicitações");
 expect(screen.getByText("Detalhes originais do serviço")).toBeVisible();
 expect(screen.getByText(failure.message)).toBeInTheDocument();
});
