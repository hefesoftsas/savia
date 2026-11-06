/// <reference types="vite/client" />

declare module "virtual:savia-react-runtime" {
  const runtime: string;
  export default runtime;
}
declare module "virtual:savia-plugin-ide-runtime" {
  const runtime: string;
  export default runtime;
}

declare module "virtual:savia-plugin-ide-vendors" {
  const vendors: Record<string, string>;
  export default vendors;
}
