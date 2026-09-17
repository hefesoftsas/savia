import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: false });
const sensitiveField = /^(?:@_)?(?:[\w.-]+:)?(?:nomUsu|passwd|password|sbs_username|sbs_password|No_Sesion|idSesion|sessionId|access_token|refresh_token|authorization)$/i;

// Preserve the upstream structure and text values; hide credentials and transient sessions.
export function responsePreview(raw: string, secrets: string[]): unknown {
 let parsed: unknown;
 try { parsed = JSON.parse(raw); }
 catch { parsed = XMLValidator.validate(raw) === true ? parser.parse(raw) : { body: raw }; }
 const knownSecrets = secrets.filter(Boolean).sort((a,b)=>b.length-a.length);
 function redact(value: unknown): unknown {
  if (typeof value === 'string') {
   let safe = value;
   for (const secret of knownSecrets) safe = safe.split(secret).join('[oculto]');
   return safe;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child])=>[key,sensitiveField.test(key)?'[oculto]':redact(child)]));
  return value;
 }
 return redact(parsed);
}
