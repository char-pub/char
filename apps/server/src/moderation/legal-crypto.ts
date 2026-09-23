import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export interface EncryptedValue {
  alg: "A256GCM";
  iv: string;
  ct: string;
  tag: string;
}

export function encryptJson(key: Uint8Array, value: unknown): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    alg: "A256GCM",
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptJson(key: Uint8Array, v: EncryptedValue): unknown {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(v.iv, "base64"));
  decipher.setAuthTag(Buffer.from(v.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(v.ct, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8"));
}

/** 解析 base64 编码的 32 字节密钥。 */
export function parseLegalKey(b64: string): Uint8Array {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("LEGAL_ENCRYPTION_KEY must decode to 32 bytes");
  return new Uint8Array(key);
}
