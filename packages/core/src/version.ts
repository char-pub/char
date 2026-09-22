/** core 的版本。Resolver 版本写进每一份 Context IR，并参与构建缓存的 key。 */
export const CORE_VERSION = "0.0.0";

export const RESOLVER = { name: "@char-pub/core", version: CORE_VERSION } as const;
