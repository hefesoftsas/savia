import { createContext, useContext, type ReactNode } from "react";

type AttachmentQueue = {
  files: Record<string, File[]>;
  setFiles(field: string, files: File[]): void;
  uploading: Record<string, File | undefined>;
  uploaded: Record<string, File[]>;
  version: number;
};

const AttachmentQueueContext = createContext<AttachmentQueue | null>(null);

export function AttachmentQueueProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AttachmentQueue;
}) {
  return (
    <AttachmentQueueContext.Provider value={value}>
      {children}
    </AttachmentQueueContext.Provider>
  );
}

export function useAttachmentQueue(field: string, fallback: File[]) {
  const queue = useContext(AttachmentQueueContext);
  return {
    files: queue?.files[field] ?? fallback,
    setFiles: (files: File[]) => queue?.setFiles(field, files),
    uploadingFile: queue?.uploading[field],
    uploadedFiles: queue?.uploaded?.[field] ?? [],
    version: queue?.version ?? 0,
  };
}
