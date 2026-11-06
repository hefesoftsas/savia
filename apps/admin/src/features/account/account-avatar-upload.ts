type AvatarUploadOptions = {
  onProgress(percent: number): void;
};

function requestUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function errorMessage(responseText: string): string {
  try {
    const payload = JSON.parse(responseText) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof payload.error?.message === "string") {
      return payload.error.message;
    }
    if (typeof payload.message === "string") return payload.message;
  } catch {
    // The API may omit a JSON response for failed uploads.
  }
  return "No fue posible subir tu avatar. Inténtalo de nuevo.";
}

export function uploadAccountAvatar(
  apiUrl: string,
  file: File,
  options: AvatarUploadOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", requestUrl(apiUrl, "/v1/account/avatar"), true);
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total < 1) return;
      options.onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () =>
      reject(new Error("No fue posible subir tu avatar. Inténtalo de nuevo."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(new Error(errorMessage(request.responseText)));
    };
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}
