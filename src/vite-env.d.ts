/// <reference types="vite/client" />

declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*?inline" {
  const content: string;
  export default content;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
