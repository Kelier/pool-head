"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** 轻量数据获取：url 为 null 时不请求；poll 返回毫秒数则轮询（返回 false 停止）。 */
export function useApi<T>(url: string | null, poll?: (d: T | null) => number | false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return null;
    const my = ++seq.current;
    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (my !== seq.current) return null;
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j as T);
      setError(null);
      return j as T;
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
      return null;
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) { setData(null); setLoading(false); return; }
    setLoading(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dead = false;
    const tick = async () => {
      const d = await load();
      const next = pollRef.current?.(d);
      if (!dead && next) timer = setTimeout(tick, next);
    };
    tick();
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [url, load]);

  return { data, error, loading, reload: load };
}

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

export function toast(text: string, kind: "ok" | "err" = "ok") {
  window.dispatchEvent(new CustomEvent("app-toast", { detail: { text, kind } }));
}
