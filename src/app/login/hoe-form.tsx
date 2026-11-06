"use client";

import { useRef, useState, type FormEvent } from "react";
import styles from "./login.module.css";

const SDK_URL = "https://turing.captcha.qcloud.com/TJCaptcha.js";
type CaptchaResult = { ret: number; appid?: string; CaptchaAppId?: string; ticket?: string; randstr?: string };
type CaptchaConstructor = new (id: string, callback: (result: CaptchaResult) => void, options: object) => { show: () => void };
type CaptchaConfig = { code: string; captchaAppId?: string; aidEncrypted?: string; aidEncryptedType?: "cbc" | "gcm" };
let loadingSdk: Promise<void> | undefined;

/** 按 Hogi 登录页使用的地址加载腾讯人机验证 SDK。 */
async function loadCaptchaSdk(): Promise<CaptchaConstructor> {
  const sdk = window as Window & { TencentCaptcha?: CaptchaConstructor };
  if (!sdk.TencentCaptcha) {
    loadingSdk ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); loadingSdk = undefined; reject(new Error("SDK_LOAD_FAILED")); };
      document.head.appendChild(script);
    });
    await loadingSdk;
  }
  if (!sdk.TencentCaptcha) throw new Error("SDK_NOT_READY");
  return sdk.TencentCaptcha;
}

/** 向 HOE 获取当前登录所需的验证配置，并等待用户完成挑战。 */
async function getProof(email: string) {
  const response = await fetch("/api/auth/hoe/captcha", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error("CONFIG_FAILED");
  const { code, captchaAppId, aidEncrypted, aidEncryptedType } = await response.json() as CaptchaConfig;
  if (code === "DISABLED" || code === "SKIPPED") return null;
  if (code !== "SUCCESS" || !captchaAppId || !aidEncrypted || !aidEncryptedType) throw new Error("CONFIG_FAILED");

  const TencentCaptcha = await loadCaptchaSdk();
  return new Promise<{ appid: string; ticket: string; randstr: string }>((resolve, reject) => {
    const captcha = new TencentCaptcha(captchaAppId, (result) => {
      if (result.ret === 0 && result.ticket && result.randstr) {
        resolve({ appid: result.CaptchaAppId ?? result.appid ?? captchaAppId, ticket: result.ticket, randstr: result.randstr });
      } else {
        reject(new Error(result.ret === 2 ? "CANCELLED" : "CAPTCHA_FAILED"));
      }
    }, { aidEncrypted, aidEncryptedType, bizState: "email_login", needFeedBack: false, userLanguage: "zh-cn" });
    captcha.show();
  });
}

/** 完成 HOE 原生的人机验证后提交账号和一次性票据。 */
export function HoeForm({ next }: { next: string }) {
  const proofInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  /** 先完成验证，再用浏览器的表单跳转保留服务端设置的会话。 */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    const form = event.currentTarget;
    try {
      const email = String(new FormData(form).get("email") ?? "");
      const proof = await getProof(email);
      if (!proofInput.current) throw new Error("FORM_GONE");
      proofInput.current.value = proof ? JSON.stringify(proof) : "";
      form.submit();
    } catch (error) {
      const cancelled = error instanceof Error && error.message === "CANCELLED";
      setMessage(cancelled ? "已取消人机验证，可以重新登录。" : "无法完成人机验证，请检查网络后重试。");
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form action="/api/auth/hoe" method="post" className={styles.form} onSubmit={submit}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="tencentCaptcha" ref={proofInput} />
      <label className={styles.field}>邮箱
        <input name="email" type="email" placeholder="请输入 HOE 账号邮箱" autoComplete="username" required readOnly={pending} />
      </label>
      <label className={styles.field}>密码
        <input name="password" type="password" placeholder="请输入密码" autoComplete="current-password" required readOnly={pending} />
      </label>
      {message && <p className={styles.notice} role="alert">{message}</p>}
      <button type="submit" className={`btn primary ${styles.submit}`} disabled={pending}>
        {pending ? "正在验证…" : "登录控制台"}
      </button>
    </form>
  );
}
