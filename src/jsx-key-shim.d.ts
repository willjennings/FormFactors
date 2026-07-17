// Minimal shim so TypeScript accepts `key` on custom JSX components.
// React 19 ships no .d.ts; @types/react is not installed.
// Without an explicit IntrinsicAttributes declaration, tsc includes
// `key` in the component props object and rejects it if the component
// props type doesn't declare it. This declaration restores the standard
// React behaviour where `key` is a special JSX attribute on every element.
declare namespace JSX {
  interface IntrinsicAttributes {
    key?: string | number | null;
  }
}
