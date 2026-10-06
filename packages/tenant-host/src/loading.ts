/** Shared boot and authentication loading presentation. */
export const SAVIA_LOADING_MESSAGE = "Cargando Savia…";
export const SAVIA_LOADING_LOGO = "/savia-icon-192-v3.png";

export const saviaLoadingCss = String.raw`
.savia-loading {
  box-sizing: border-box;
  min-height: 100svh;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: 1.5rem;
  background: #fff;
  color: #737373;
  font: 400 .875rem/1.5 "Avenir Next", "Helvetica Neue", system-ui, sans-serif;
}
.savia-loading[hidden] { display: none; }
html.dark .savia-loading { background: #171717; color: #a3a3a3; }
.savia-loading-mark { position: relative; display: flex; align-items: center; justify-content: center; width: 6rem; height: 6rem; }
.savia-loading-mark img { width: 4rem; height: 4rem; border-radius: 1rem; }
html.dark .savia-loading-mark img { background: #fff; }
.savia-loading p { margin: 0; }
.savia-loading .savia-ring { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 9999px; }
.savia-loading .savia-ring::before,
.savia-loading .savia-ring::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4.5px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4.5px), #000 calc(100% - 4px));
}
.savia-loading .savia-ring::before { background: rgb(13 148 136 / .16); }
.savia-loading .savia-ring::after { background: conic-gradient(from 0deg, #0d9488 0 26%, transparent 26% 100%); animation: savia-loading-spin .9s linear infinite; }
@keyframes savia-loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .savia-loading .savia-ring::after { animation: none; } }
`;

/** Constant markup also works before React or authentication scripts are ready. */
export const saviaLoadingHtml = `<main class="savia-loading" role="status" aria-label="${SAVIA_LOADING_MESSAGE}" data-oauth-loading hidden>
  <span class="savia-loading-mark"><span class="savia-ring savia-ring-cover" aria-hidden="true"></span><img src="${SAVIA_LOADING_LOGO}" alt="" width="64" height="64"></span>
  <p>${SAVIA_LOADING_MESSAGE}</p>
</main>`;
