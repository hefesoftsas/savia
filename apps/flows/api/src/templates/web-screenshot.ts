import { CloudflareBrowserScreenshotNode } from "@savia/flows-runtime/nodes/browser/cloudflare-browser-screenshot-node";
import { TextInputNode } from "@savia/flows-runtime/nodes/input/text-input-node";
import { ImageOutputNode } from "@savia/flows-runtime/nodes/output/image-output-node";
import type { WorkflowTemplate } from "@savia/flows-types";

export const webScreenshotTemplate: WorkflowTemplate = {
  id: "web-screenshot",
  name: "Web Screenshot",
  description: "Capture a screenshot of any webpage",
  icon: "camera",
  trigger: "manual",
  tags: ["browser"],
  nodes: [
    TextInputNode.create({
      id: "url-input",
      name: "URL",
      position: { x: 100, y: 100 },
      inputs: {
        value: "https://news.ycombinator.com",
        placeholder: "Enter URL to capture...",
        rows: 1,
      },
    }),
    CloudflareBrowserScreenshotNode.create({
      id: "screenshot-capture",
      name: "Screenshot",
      position: { x: 500, y: 100 },
    }),
    ImageOutputNode.create({
      id: "screenshot-preview",
      name: "Screenshot",
      position: { x: 900, y: 100 },
    }),
  ],
  edges: [
    {
      source: "url-input",
      target: "screenshot-capture",
      sourceOutput: "value",
      targetInput: "url",
    },
    {
      source: "screenshot-capture",
      target: "screenshot-preview",
      sourceOutput: "image",
      targetInput: "value",
    },
  ],
};
