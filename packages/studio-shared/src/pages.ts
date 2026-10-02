export type PageRole = "owner" | "editor" | "reader";
export type PageShareRole = "reader" | "editor";
export type PageKind = "page" | "folder";

export type PageBinding = {
  domain: string;
  collection: string;
  recordId: string;
};

export type PageSummary = {
  /** Omitted only by older persisted client fixtures. API responses always include it. */
  kind?: PageKind;
  id: string;
  parentId: string | null;
  rootId: string;
  title: string;
  version: number;
  updatedAt: string;
  ownerId: string;
  role: PageRole;
  isShared: boolean;
  binding?: PageBinding | null;
};

export type PlateNode = {
  type?: string;
  text?: string;
  children?: PlateNode[];
  [key: string]: unknown;
};

export type PageDocument = PageSummary & { content: PlateNode[] };

export type PagesArchive = {
  format: "savia-pages";
  version: 1;
  exportedAt: string;
  pages: Array<{
    id: string;
    parentId: string | null;
    title: string;
    kind: PageKind;
    content: PlateNode[];
  }>;
  files: Array<{
    id: string;
    pageId: string;
    name: string;
    mimeType: string;
    size: number;
    data: string;
  }>;
};

export type PagesImportResult = {
  pages: number;
  folders: number;
  files: number;
};

export type PageMember = {
  principalId: string;
  displayName: string;
  email: string;
};

export type PageShare = {
  principalId: string;
  role: PageShareRole;
};

export type PageShares = {
  rootId: string;
  version: number;
  shares: PageShare[];
};

export type PageRevision = {
  id: string;
  version: number;
  title: string;
  createdAt: string;
};

export type PageFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};
