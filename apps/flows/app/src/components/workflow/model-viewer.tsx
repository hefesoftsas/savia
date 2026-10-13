import React, { useEffect, useState } from "react";

import type { WorkflowParameter } from "./workflow-types";

// Model viewer component wrapper
const ModelViewerElement = React.forwardRef<HTMLElement, any>((props, ref) => {
  return React.createElement("model-viewer", { ...props, ref });
});

export interface ModelViewerProps {
  parameter: WorkflowParameter;
  objectUrl: string;
}

// Custom hook to handle model-viewer loading
function useModelViewer() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Only load model-viewer on the client side
    if (typeof window !== "undefined") {
      import("@google/model-viewer")
        .then(() => setIsLoaded(true))
        .catch(() => setLoadError("Failed to load 3D viewer"));
    }
  }, []);

  return { isLoaded, loadError };
}

export const ModelViewer = React.memo(
  ({ parameter, objectUrl }: ModelViewerProps) => {
    const { isLoaded: isModelViewerLoaded, loadError } = useModelViewer();

    if (loadError) {
      return (
        <div className="space-y-2">
          <div className="p-3 bg-red-50 dark:bg-red-900/20">
            <div className="text-sm text-red-800 dark:text-red-200">
              3D Model Error
            </div>
            <div className="text-xs text-red-700 dark:text-red-300">
              {loadError}
            </div>
          </div>
          <div className="text-xs text-neutral-500">
            glTF Model (
            {parameter.type === "gltf"
              ? (parameter.value?.mimeType ?? "model/gltf-binary")
              : "model/gltf-binary"}
            )
          </div>
        </div>
      );
    }

    if (!isModelViewerLoaded) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-neutral-100/50 dark:bg-neutral-900">
          <span className="text-xs text-neutral-500">Loading 3D Viewer...</span>
        </div>
      );
    }

    return (
      <div
        className="w-full h-full bg-neutral-100/50 dark:bg-neutral-900 overflow-hidden nodrag nopan nowheel"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ModelViewerElement
          src={objectUrl}
          camera-controls
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: "transparent",
          }}
        />
      </div>
    );
  },
);

ModelViewer.displayName = "ModelViewer";
