import {
  pluginDevelopmentPathSchema,
  pluginVersionSchema,
} from "@savia/studio-shared/plugin-development";
import { pluginStoreManifestSchema } from "@savia/studio-shared/plugin-store";
/** TextDocumentContentProvider documents are read-only in VS Code. */
export class PublishedSourceProvider {
  private documents = new Map<string, string>();
  add(
    profileId: string,
    pluginId: string,
    version: string,
    files: Record<string, string>,
  ) {
    pluginStoreManifestSchema.shape.id.parse(pluginId);
    pluginVersionSchema.parse(version);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(profileId))
      throw new Error("Invalid source profile identity.");
    return Object.entries(files).map(([path, text]) => {
      pluginDevelopmentPathSchema.parse(path);
      const uri = `savia-source:/${encodeURIComponent(profileId)}/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/${path.split("/").map(encodeURIComponent).join("/")}`;
      this.documents.set(uri, text);
      return { path, uri };
    });
  }
  provideTextDocumentContent(uri: { toString(): string }) {
    const source = this.documents.get(uri.toString());
    if (source === undefined)
      throw new Error(
        "Published source is unavailable in the current connection.",
      );
    return source;
  }
  clear() {
    this.documents.clear();
  }
  dispose() {
    this.clear();
  }
}
