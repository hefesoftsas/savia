import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";

export async function dynamicScalar(
  c: Context,
  document: { servers: { url: string }[] },
  agencyId: number | string,
) {
  // Scalar serializes its configuration into an inline script. Supply JSON text
  // with escaped angle brackets so administrator-defined labels cannot end it.
  const content = JSON.stringify({
    ...document,
    servers: document.servers.map((server) => ({
      ...server,
      url: new URL(server.url, c.req.url).href,
    })),
  }).replace(/</g, "\\u003c");
  const rendered = await Scalar({
    content,
    persistAuth: false,
    pageTitle: "API de Studio · Savia",
  })(c, async () => {});
  if (!rendered) throw new Error("No se pudo generar la documentación.");
  const html = (await rendered.text()).replace(
    "<head>",
    "<head>" + scalarTransportScript(agencyId),
  );
  return c.html(html);
}

// The embedded reference never receives a bearer token. Its host validates and
// forwards only requests under the selected agency through the existing transport.
export function scalarTransportScript(agencyId: number | string) {
  const prefix =
    typeof agencyId === "number"
      ? `/v1/studio/${agencyId}/api/`
      : `${agencyId}/api/`;
  return `<script>
(() => {
  // Scalar initializes preference storage before reading persistAuth. The
  // sandbox has no Web Storage access, so supply page-lifetime memory only.
  const volatileStorage = () => {
    const values = new Map();
    return {get length(){return values.size;}, key(index){return [...values.keys()][index] ?? null;},
      getItem(key){return values.get(String(key)) ?? null;}, setItem(key,value){values.set(String(key),String(value));},
      removeItem(key){values.delete(String(key));}, clear(){values.clear();}};
  };
  for (const name of ['localStorage','sessionStorage']) Object.defineProperty(window,name,{value:volatileStorage(),configurable:true});
  if (window.parent === window) return;
  const originalFetch = window.fetch.bind(window), pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'savia-studio-response') return;
    const task = pending.get(event.data.id);
    if (!task) return;
    pending.delete(event.data.id); clearTimeout(task.timer);
    if (event.data.error) task.reject(new Error(event.data.error));
    else {
      const response = new Response([204,205,304].includes(event.data.status) ? null : event.data.body, {status:event.data.status, headers:event.data.headers});
      Object.defineProperty(response,'url',{value:task.url});
      task.resolve(response);
    }
  });
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'https://crm.internal');
    if (!url.pathname.startsWith(${JSON.stringify(prefix)})) return originalFetch(input, init);
    const request = new Request(input instanceof Request ? input : url.href, init);
    const method = request.method.toUpperCase();
    const body = ['GET','HEAD'].includes(method) ? undefined : await request.text();
    const id = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => {pending.delete(id);reject(new Error('La operación tardó demasiado. Revisa su estado antes de repetir.'));}, 45000);
      pending.set(id,{resolve,reject,timer,url:url.href});
      window.parent.postMessage({type:'savia-studio-fetch',id,url:url.pathname+url.search,method,headers:Object.fromEntries(request.headers),body}, '*');
    });
  };
})();
</script>`;
}
