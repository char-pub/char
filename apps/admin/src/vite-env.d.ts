/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 设为 "1" 时使用内置的 mock admin API。 */
  readonly VITE_ADMIN_MOCK?: string;
  /** 覆盖 admin-api 的基础地址。 */
  readonly VITE_ADMIN_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
