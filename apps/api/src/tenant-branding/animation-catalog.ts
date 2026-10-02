import { HTTPException } from "hono/http-exception";
import { isLoginAnimationBytes, MAX_ASSET_BYTES } from "./service";

const repository =
  "https://github.com/spemer/lottie-animations-json/blob/d5bc5ecf1db13f1a051224b5c76f4d07756b57d8";
const rawRepository =
  "https://raw.githubusercontent.com/spemer/lottie-animations-json/d5bc5ecf1db13f1a051224b5c76f4d07756b57d8";
const licenseUrl =
  "https://github.com/spemer/lottie-animations-json/blob/d5bc5ecf1db13f1a051224b5c76f4d07756b57d8/LICENSE";
const licenseText = `MIT License

Copyright (c) [2018] [Hyouk Seo]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export type ApprovedAnimation = {
  id: string;
  name: string;
  keywords: string[];
  author: string;
  license: "MIT";
  licenseUrl: string;
  sourceUrl: string;
  downloadUrl: string;
  sha256: string;
};

const approved: ApprovedAnimation[] = [
  {
    id: "animated-tab",
    name: "Animated tab indicator",
    keywords: [
      "animated",
      "tab",
      "indicator",
      "navigation",
      "pestaña",
      "indicador",
      "navegación",
      "animación",
    ],
    author: "Hyouk Seo",
    license: "MIT",
    licenseUrl,
    sourceUrl: `${repository}/animate_tab/animate_tab_1.json`,
    downloadUrl: `${rawRepository}/animate_tab/animate_tab_1.json`,
    sha256: "bbeeedd49aa0708113a24209a0d754718d5d1d9686466a47d711c02e9f4e16dc",
  },
  {
    id: "animated-tab-example",
    name: "Animated tab example",
    keywords: [
      "animated",
      "tab",
      "example",
      "navigation",
      "pestaña",
      "ejemplo",
      "navegación",
      "animación",
    ],
    author: "Hyouk Seo",
    license: "MIT",
    licenseUrl,
    sourceUrl: `${repository}/animate_tab/animate_tab_1_example.json`,
    downloadUrl: `${rawRepository}/animate_tab/animate_tab_1_example.json`,
    sha256: "538bef2027364d4181161aee807ed0bc24ce89e97938a4bcca005796fd6faf48",
  },
  {
    id: "favorite-star",
    name: "Favorite star",
    keywords: [
      "favorite",
      "star",
      "like",
      "save",
      "favorito",
      "estrella",
      "me gusta",
      "guardar",
    ],
    author: "Hyouk Seo",
    license: "MIT",
    licenseUrl,
    sourceUrl: `${repository}/ic_fav/ic_fav.json`,
    downloadUrl: `${rawRepository}/ic_fav/ic_fav.json`,
    sha256: "a11bf8c9cd305ddf3f1925be34d24966d8a1f68647c9f551cc3358f57ad6e82e",
  },
  {
    id: "pagination-indicator",
    name: "Pagination indicator",
    keywords: [
      "pagination",
      "indicator",
      "dots",
      "pages",
      "carousel",
      "paginación",
      "indicador",
      "puntos",
      "páginas",
      "carrusel",
    ],
    author: "Hyouk Seo",
    license: "MIT",
    licenseUrl,
    sourceUrl: `${repository}/pagination_indicator/pagination_indicator.json`,
    downloadUrl: `${rawRepository}/pagination_indicator/pagination_indicator.json`,
    sha256: "b150ea97f3a7f9fd4995624da256a5b22bf6b37559c629482d2723afdd8687f2",
  },
];

export type AnimationDescriptor = Omit<
  ApprovedAnimation,
  "sha256" | "downloadUrl"
>;

export function listApprovedAnimations(query?: string): AnimationDescriptor[] {
  const needle = normalize(query ?? "");
  return approved
    .filter(
      (item) =>
        !needle ||
        normalize([item.name, ...item.keywords].join(" ")).includes(needle),
    )
    .map(
      ({ sha256: _sha256, downloadUrl: _downloadUrl, ...descriptor }) =>
        descriptor,
    );
}

export function findApprovedAnimation(id: string): ApprovedAnimation | null {
  return approved.find((item) => item.id === id) ?? null;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ASSET_BYTES)
    throw unavailable();
  if (!response.body) throw unavailable();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ASSET_BYTES) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function unavailable() {
  return new HTTPException(502, {
    message: "Approved animation source is unavailable.",
  });
}

export async function readApprovedAnimation(item: ApprovedAnimation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    // sourceUrl is created only from the pinned repository and local allowlist.
    const response = await fetch(item.downloadUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "application/json, text/plain" },
    });
    if (response.status !== 200) throw unavailable();
    const bytes = await readBounded(response);
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    );
    const sha256 = Array.from(hash, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (sha256 !== item.sha256 || !isLoginAnimationBytes(bytes))
      throw unavailable();
    let animation: Record<string, unknown>;
    try {
      animation = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as Record<string, unknown>;
    } catch {
      throw unavailable();
    }
    return {
      ...animation,
      saviaLicense: {
        license: item.license,
        licenseUrl: item.licenseUrl,
        author: item.author,
        sourceUrl: item.sourceUrl,
        sourceCommit: "d5bc5ecf1db13f1a051224b5c76f4d07756b57d8",
        licenseText,
      },
    };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timeout);
  }
}
