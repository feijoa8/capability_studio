/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /**
   * Deployed app origin for password recovery redirects (must match Supabase redirect allow list).
   * Example: https://app.capability.studio
   * In local dev, the browser origin is used when this is unset.
   */
  readonly VITE_APP_PUBLIC_URL?: string;
  /**
   * Public marketing site origin (no path). Example: https://www.capability.studio
   * In dev, defaults to http://localhost:3001 when unset.
   */
  readonly VITE_LANDING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
