import File from "lucide-react/icons/file";

import { isObjectReference } from "@/services/object-service";
import { cn } from "@/utils/utils";

import { ModelViewer } from "../model-viewer";
import { FieldPlaceholder } from "./field-placeholder";
import {
  FileUploadZone,
  useObjectPreviewUrl,
  useFileUpload,
} from "./file-field-primitives";
import type { FieldProps, ObjectReference } from "./types";

const UPLOAD_CONFIG = {
  errorMessage: "Failed to upload file",
} as const;

export interface BlobFieldProps extends FieldProps {
  createObjectUrl?: (objectReference: ObjectReference) => string;
}

function RepeatedBlobRow({
  reference,
  index,
  createObjectUrl,
}: {
  reference: ObjectReference;
  index: number;
  createObjectUrl?: (reference: ObjectReference) => string;
}) {
  const { url } = useObjectPreviewUrl(reference, createObjectUrl);
  const filename = reference.filename || `File ${index + 1}`;
  return (
    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border border-border">
      <File className="h-4 w-4 shrink-0 text-neutral-500" />
      <span className="text-xs truncate flex-1" title={filename}>
        {filename}
      </span>
      {url ? (
        <a
          href={url}
          download={filename}
          className="text-xs text-primary underline"
        >
          Download
        </a>
      ) : null}
    </div>
  );
}

export function BlobField({
  className,
  connected,
  createObjectUrl,
  disabled,
  onChange,
  parameter,
  value,
}: BlobFieldProps) {
  const { isUploading, uploadError, handleUpload } = useFileUpload(
    UPLOAD_CONFIG,
    onChange,
  );

  // Handle array of object references for repeated outputs
  const isRepeated = parameter.repeated === true;
  if (isRepeated && Array.isArray(value)) {
    const validRefs = value.filter(isObjectReference) as ObjectReference[];

    if (disabled && validRefs.length === 0) {
      return (
        <FieldPlaceholder
          className={className}
          connected={connected}
          label="No files"
        />
      );
    }

    if (validRefs.length > 0) {
      return (
        <div className={cn("space-y-2", className)}>
          {validRefs.map((ref, index) => (
            <RepeatedBlobRow
              key={ref.id}
              reference={ref}
              index={index}
              createObjectUrl={createObjectUrl}
            />
          ))}
        </div>
      );
    }
  }

  const hasRef = value !== undefined && isObjectReference(value);
  const { url: objectUrl } = useObjectPreviewUrl(value, createObjectUrl);
  const mimeType = hasRef ? (value as ObjectReference)?.mimeType : null;
  const isPDF = mimeType === "application/pdf";
  const isImage = mimeType?.startsWith("image/");
  const isAudio = mimeType?.startsWith("audio/");
  const isVideo = mimeType?.startsWith("video/");
  const isGltf =
    mimeType === "model/gltf+json" || mimeType === "model/gltf-binary";

  if (disabled && !hasRef) {
    return (
      <FieldPlaceholder
        className={className}
        connected={connected}
        label="No file"
      />
    );
  }

  if (hasRef) {
    if (!objectUrl) {
      return (
        <FieldPlaceholder className={className} label="No preview available" />
      );
    }

    if (isPDF) {
      return (
        <div
          className={cn(
            "relative rounded-md overflow-hidden border bg-background border-neutral-300 dark:border-neutral-700",
            className,
          )}
        >
          <iframe
            src={objectUrl}
            sandbox=""
            title="PDF preview"
            className="w-full h-64 nowheel"
          />
        </div>
      );
    }

    if (isImage) {
      return (
        <div
          className={cn(
            "relative rounded-md overflow-hidden border bg-background border-neutral-300 dark:border-neutral-700",
            className,
          )}
        >
          <img
            src={objectUrl}
            alt="Blob content"
            className="w-full object-cover"
          />
        </div>
      );
    }

    if (isAudio) {
      return (
        <div
          className={cn(
            "relative rounded-md p-2 border bg-background border-neutral-300 dark:border-neutral-700",
            className,
          )}
        >
          <audio src={objectUrl} controls className="w-full" />
        </div>
      );
    }

    if (isVideo) {
      return (
        <div
          className={cn(
            "relative rounded-md overflow-hidden border bg-background border-neutral-300 dark:border-neutral-700",
            className,
          )}
        >
          <video src={objectUrl} controls className="w-full" />
        </div>
      );
    }

    if (isGltf) {
      return (
        <div
          className={cn(
            "relative h-[200px] rounded-md overflow-hidden border bg-background border-neutral-300 dark:border-neutral-700",
            className,
          )}
        >
          <ModelViewer parameter={parameter} objectUrl={objectUrl} />
        </div>
      );
    }

    const filename =
      (value as ObjectReference)?.filename ||
      `File (${mimeType?.split("/")[1] || "unknown"})`;
    return (
      <div
        className={cn(
          "flex items-center gap-2 p-2 rounded-md border bg-background border-neutral-300 dark:border-neutral-700",
          className,
        )}
      >
        <File className="h-4 w-4 shrink-0 text-neutral-500" />
        <span className="text-xs truncate flex-1" title={filename}>
          {filename}
        </span>
        <a
          href={objectUrl}
          download={filename}
          className="text-xs text-primary underline"
        >
          Download
        </a>
      </div>
    );
  }

  return (
    <FileUploadZone
      className={className}
      accept="*/*,.gltf,.glb"
      disabled={disabled}
      isUploading={isUploading}
      uploadError={uploadError}
      onFileUpload={handleUpload}
      parameterId={parameter.id}
      fieldType="blob"
    />
  );
}
