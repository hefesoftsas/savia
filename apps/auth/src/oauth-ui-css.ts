import {
  parseTenantBranding,
  brandingForeground,
  type TenantBranding,
} from "@savia/tenant-host/branding";
export const oauthUiCss = String.raw`:root {
  --background: #f7f9fb;
  --foreground: #102a43;
  --muted: #61758a;
  --border: #d9e2ec;
  --ring: #167d9a;
  --primary: #087f8c;
  --primary-foreground: #ffffff;
  --aside: #102a43;
  --aside-muted: #c7d9e8;
  --error: #b42318;
}

* { box-sizing: border-box; }
html { background: var(--background); color: var(--foreground); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; min-width: 320px; }
button, input { font: inherit; }
[hidden] { display: none !important; }
.oauth-screen { display: grid; min-height: 100svh; grid-template-columns: minmax(0, 1fr) minmax(390px, 44%); }
.oauth-workspace { display: flex; min-height: 100%; flex-direction: column; padding: 2rem clamp(1.5rem, 6vw, 6rem) 1.5rem; }
.savia-brand { align-items: center; color: var(--foreground); display: inline-flex; font-size: 1.05rem; font-weight: 720; gap: .7rem; letter-spacing: -.02em; text-decoration: none; width: max-content; }
.savia-brand-logo { display: block; height: 2.2rem; object-fit: contain; width: auto; }
.savia-mark { border-radius: .55rem; display: inline-block; height: 2rem; object-fit: cover; width: 2rem; }
.oauth-form-column { margin: auto; max-width: 27rem; padding: 3.5rem 0; width: 100%; }
.oauth-heading { margin-bottom: 2rem; }
.oauth-heading h1, .oauth-heading h2 { color: var(--foreground); font-size: clamp(1.8rem, 2.8vw, 2.35rem); letter-spacing: -.04em; line-height: 1.07; margin: .5rem 0 .75rem; text-wrap: balance; }
.oauth-heading h2 { font-size: 1.55rem; }
.oauth-heading p { color: var(--muted); font-size: .96rem; line-height: 1.55; margin: 0; text-wrap: pretty; }
.oauth-kicker, .oauth-aside-eyebrow { color: var(--primary) !important; font-size: .76rem !important; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
.oauth-form { display: grid; gap: 1.25rem; }
.oauth-field { display: grid; gap: .55rem; }
[data-slot="label"] { color: var(--foreground); font-size: .88rem; font-weight: 660; }
[data-slot="input"] { background: white; border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); height: 2.85rem; padding: .6rem .8rem; width: 100%; }
[data-slot="input"]:has(+ .oauth-password-toggle) { padding-inline-end: 3.25rem; }
[data-slot="input"]::placeholder { color: #829ab1; }
[data-slot="input"]:focus-visible { border-color: var(--ring); box-shadow: 0 0 0 3px rgb(22 125 154 / .18); outline: 0; }
[data-slot="input"]:focus-visible + .oauth-password-toggle { color: var(--primary); }
.oauth-password-control { position: relative; }
.oauth-password-toggle { align-items: center; background: transparent; border: 0; border-radius: .4rem; color: var(--muted); cursor: pointer; display: inline-flex; height: 2.45rem; inset-block-end: .2rem; inset-inline-end: .2rem; justify-content: center; padding: 0; position: absolute; transition: background-color 150ms ease, color 150ms ease; width: 2.45rem; }
.oauth-password-toggle:hover { background: #edf7f7; color: #175c68; }
.oauth-password-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.oauth-password-toggle-icon { height: 1.15rem; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; width: 1.15rem; }
.oauth-password-toggle-icon[data-oauth-password-toggle-icon="hide"] { display: none; }
.oauth-password-toggle[aria-pressed="true"] [data-oauth-password-toggle-icon="show"] { display: none; }
.oauth-password-toggle[aria-pressed="true"] [data-oauth-password-toggle-icon="hide"] { display: block; }
[data-slot="button"] { align-items: center; border: 1px solid transparent; border-radius: .55rem; cursor: pointer; display: inline-flex; font-weight: 700; justify-content: center; min-height: 2.85rem; padding: .7rem 1rem; transition: background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease; }
[data-slot="button"][data-variant="default"] { background: var(--primary); color: var(--primary-foreground); }
[data-slot="button"][data-variant="default"]:hover { background: #066b77; box-shadow: 0 .55rem 1.25rem rgb(8 127 140 / .22); transform: translateY(-1px); }
[data-slot="button"][data-variant="outline"] { background: white; border-color: var(--border); color: var(--foreground); }
[data-slot="button"]:focus-visible { box-shadow: 0 0 0 3px rgb(22 125 154 / .24); outline: 0; }
[data-slot="button"]:disabled { cursor: wait; opacity: .65; transform: none; }
.oauth-submit { width: 100%; }
.oauth-two-factor, .oauth-enrollment { border-top: 1px solid var(--border); margin-top: 1.75rem; padding-top: 1.75rem; }
.oauth-heading-compact { margin-bottom: 1.4rem; }
.oauth-recovery { color: var(--muted); font-size: .9rem; margin-top: 1.25rem; }
.oauth-recovery summary { cursor: pointer; font-weight: 650; }
.oauth-recovery .oauth-form { margin-top: 1.1rem; }
.oauth-totp-qr { background: white; border: 1px solid var(--border); border-radius: .75rem; display: block; height: 13rem; margin: 1rem auto 1.25rem; padding: .75rem; width: 13rem; }
.oauth-manual-setup { color: var(--muted); font-size: .9rem; margin: 0 0 1.25rem; }
.oauth-manual-setup summary { cursor: pointer; font-weight: 650; }
.oauth-manual-setup p { margin: .9rem 0 .45rem; }
.oauth-enrollment code { background: #eaf2f8; border-radius: .4rem; color: #243b53; display: block; font-size: .75rem; line-break: anywhere; margin: 0; padding: .8rem; }
.oauth-enrollment ul, .oauth-permissions ul { color: var(--foreground); display: grid; gap: .45rem; margin: .75rem 0 1.3rem; padding-left: 1.2rem; }
.oauth-permissions { background: #edf7f7; border-radius: .75rem; margin-bottom: 1.4rem; padding: 1rem 1.1rem; }
.oauth-permissions > p { color: #175c68; font-size: .78rem; font-weight: 760; letter-spacing: .06em; margin: 0; text-transform: uppercase; }
#oauth-status { color: var(--muted); font-size: .9rem; line-height: 1.45; margin: 1.25rem 0 0; min-height: 1.35rem; }
#oauth-status:not(:empty) { background: #edf7f7; border-radius: .45rem; color: #175c68; padding: .65rem .75rem; }
.oauth-footer { color: #829ab1; font-size: .76rem; margin: 0; }
.oauth-aside { background: var(--aside); color: white; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; padding: 3.5rem clamp(2.5rem, 5vw, 5rem); position: relative; }
.oauth-aside::before { border: 1px solid rgb(153 246 228 / .18); border-radius: 999px; content: ""; height: 34rem; position: absolute; right: -13rem; top: -13rem; width: 34rem; }
.oauth-aside::after { background: #0f766e; border-radius: 999px; bottom: -8rem; content: ""; height: 20rem; left: -8rem; opacity: .68; position: absolute; width: 20rem; }
.oauth-aside > * { position: relative; z-index: 1; }
.oauth-aside-mark .savia-mark { border-radius: .7rem; box-shadow: 0 4px 16px rgb(0 0 0 / .28); height: 2.5rem; width: 2.5rem; }
.oauth-aside-illustration { align-items: center; display: flex; justify-content: center; margin: 1rem 0; }
.oauth-insurance-ai { height: auto; max-width: 22rem; overflow: visible; width: min(100%, 22rem); }
.oauth-insurance-ai-connection, .oauth-insurance-ai-circuit { stroke: rgb(153 246 228 / .72); stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
.oauth-insurance-ai-orbit { stroke: rgb(199 217 232 / .24); stroke-linecap: round; stroke-width: 1.25; }
.oauth-insurance-ai-shield { fill: rgb(8 127 140 / .18); stroke: #99f6e4; stroke-linejoin: round; stroke-width: 2.5; }
.oauth-insurance-ai-core { fill: rgb(255 255 255 / .08); stroke: #ffffff; stroke-width: 1.6; }
.oauth-insurance-ai-node { fill: #99f6e4; stroke: var(--aside); stroke-width: 3; }
.oauth-aside-eyebrow { color: #99f6e4 !important; }
.oauth-aside-title { font-size: clamp(2.2rem, 4.4vw, 4.25rem); font-weight: 720; letter-spacing: -.045em; line-height: .99; margin: .75rem 0 1.25rem; max-width: 8ch; text-wrap: balance; }
.oauth-aside-copy { color: var(--aside-muted); font-size: 1rem; line-height: 1.6; margin: 0; max-width: 28ch; }
.oauth-aside.has-login-reel { align-items: center; justify-content: center; padding: clamp(1.25rem, 3vw, 3rem); }
.oauth-aside.has-login-reel::before, .oauth-aside.has-login-reel::after { display: none; }
.oauth-login-reel { aspect-ratio: 16 / 9; border-radius: 1rem; isolation: isolate; max-width: 58rem; overflow: hidden; position: relative; width: 100%; }
.oauth-login-reel-video { background: #071421; height: 100%; inset: 0; object-fit: cover; opacity: 0; position: absolute; transition: opacity 900ms cubic-bezier(.16, 1, .3, 1); width: 100%; }
.oauth-login-reel[data-active="0"] [data-oauth-login-reel-video]:nth-of-type(1), .oauth-login-reel[data-active="1"] [data-oauth-login-reel-video]:nth-of-type(2) { opacity: 1; }
.oauth-login-reel > .savia-mark { border-radius: .7rem; box-shadow: 0 5px 20px rgb(0 0 0 / .3); height: 2.5rem; left: 1rem; position: absolute; top: 1rem; width: 2.5rem; z-index: 2; }
.oauth-login-reel-toggle { align-items: center; background: rgb(7 20 33 / .72); border: 1px solid rgb(255 255 255 / .32); border-radius: 999px; bottom: 1rem; color: white; cursor: pointer; display: inline-flex; height: 2.75rem; justify-content: center; position: absolute; right: 1rem; transition: background-color 160ms ease, transform 160ms ease; width: 2.75rem; z-index: 2; }
.oauth-login-reel-toggle:hover { background: rgb(7 20 33 / .92); transform: scale(1.05); }
.oauth-login-reel-toggle:focus-visible { outline: 2px solid white; outline-offset: 3px; }
.oauth-login-reel-toggle svg { height: 1.1rem; stroke: currentColor; stroke-linecap: round; stroke-width: 2.3; width: 1.1rem; }
.oauth-login-reel-toggle [data-reel-play-icon], .oauth-login-reel-toggle[aria-pressed="true"] [data-reel-pause-icon] { display: none; }
.oauth-login-reel-toggle[aria-pressed="true"] [data-reel-play-icon] { display: block; }
.oauth-login-reel-toggle[aria-pressed="true"] [data-reel-play-icon] path { fill: currentColor; stroke: none; }
@media (max-width: 900px) { .oauth-screen { grid-template-columns: 1fr; } .oauth-aside { display: none; } .oauth-aside.has-login-reel { display: flex; min-height: clamp(11rem, 45vw, 23rem); order: -1; padding: 1rem; } .oauth-workspace { min-height: auto; padding: 1.5rem clamp(1.25rem, 8vw, 3.5rem); } .oauth-form-column { padding: 3.25rem 0; } }
@media (prefers-reduced-motion: reduce) { .oauth-login-reel-video { transition: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
`;

/** Tenant colors are validated before entering the stylesheet; no inline styles are needed. */
export function oauthUiCssForBranding(value?: TenantBranding): string {
  const branding = parseTenantBranding(value);
  if (!branding) return oauthUiCss;
  const foreground = brandingForeground(branding.accentColor);
  return `${oauthUiCss}
.oauth-screen[data-tenant-branding] {
  --primary: ${branding.primaryColor};
  --primary-foreground: ${brandingForeground(branding.primaryColor)};
  --ring: ${branding.primaryColor};
  --aside: ${branding.accentColor};
  --aside-muted: ${foreground};
}
.oauth-screen[data-tenant-branding] .savia-brand-logo { max-width: min(100%, 18rem); height: 3rem; }
.oauth-screen[data-tenant-branding] .oauth-kicker { color: var(--foreground) !important; }
.oauth-screen[data-tenant-branding] .oauth-submit:hover { background: color-mix(in srgb, var(--primary) 90%, var(--primary-foreground)); }
.oauth-screen[data-tenant-branding] .oauth-aside { color: ${foreground}; }
.oauth-screen[data-tenant-branding] .oauth-aside-eyebrow { color: inherit !important; }
.oauth-screen[data-tenant-branding] .oauth-aside-title { max-width: 16ch; overflow-wrap: anywhere; }
.oauth-screen[data-tenant-branding] .oauth-aside.has-cover { color: #ffffff; --aside-muted: #ffffff; }
.oauth-screen[data-tenant-branding] .oauth-aside.has-cover::before { inset: 0; width: auto; height: auto; border: 0; border-radius: 0; background: #00000099; z-index: 1; }
.oauth-screen[data-tenant-branding] .oauth-aside.has-cover::after,
.oauth-screen[data-tenant-branding] .oauth-aside.has-cover .oauth-aside-illustration { display: none; }
.oauth-screen[data-tenant-branding] .oauth-aside > .oauth-aside-cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
`;
}
