interface ImportMetaEnv {
  readonly PUBLIC_GTM_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  dataLayer: Array<Record<string, unknown>>;
  gtag: (...args: unknown[]) => void;
}
