import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// 飞书事件加密：key = sha256(Encrypt Key)；密文 = base64( iv(16) + AES-256-CBC(明文) )
const key = (k: string) => createHash("sha256").update(k).digest();

export function decryptFeishu(encrypt: string, encryptKey: string): string {
  const buf = Buffer.from(encrypt, "base64");
  const d = createDecipheriv("aes-256-cbc", key(encryptKey), buf.subarray(0, 16));
  return Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString("utf8");
}

/** 仅测试用：生成与飞书一致的密文。 */
export function encryptFeishu(plain: string, encryptKey: string): string {
  const iv = randomBytes(16);
  const c = createCipheriv("aes-256-cbc", key(encryptKey), iv);
  return Buffer.concat([iv, c.update(plain, "utf8"), c.final()]).toString("base64");
}
