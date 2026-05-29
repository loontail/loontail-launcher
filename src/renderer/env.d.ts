/// <reference types="vite/client" />

declare module '@renderer/assets/*.png' {
  const src: string;
  export default src;
}
