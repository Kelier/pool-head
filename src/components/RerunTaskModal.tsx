"use client";

import { useState } from "react";
import { api } from "@/lib/useApi";
import { Modal } from "./ui";

/** 用原任务配置发起一次新搜索，可修改本次浏览条数。 */
export function RerunTaskModal({ taskId, maxPosts, onClose, onCreated }: {
  taskId: number;
  maxPosts?: number;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [limit, setLimit] = useState(maxPosts?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const count = limit === "" ? null : Number(limit);
  const invalid = count !== null && (!Number.isSafeInteger(count) || count < 1);

  /** 保持历史任务不变，跳到本次新建的任务。 */
  async function rerun() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: number }>(`/api/tasks/${taskId}/action`, "POST", { action: "rerun", maxPosts: count });
      onCreated(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`重跑任务 #${taskId}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>取消</button>
      <button className="btn" disabled={busy || invalid} onClick={rerun}>{busy ? "创建中…" : "创建新任务"}</button>
    </>}>
      <p>使用原任务的平台、关键词和时间设置重新搜索，结果写入新任务。</p>
      <div className="field">
        <label htmlFor="rerun-posts">每个平台最多浏览（条）</label>
        <input id="rerun-posts" type="number" min={1} step={1} placeholder="留空自动停止" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <span className="hint">每个平台独立计数，平台内关键词合计，包含过期及未命中的内容。</span>
      </div>
      {error && <div className="alert">{error}</div>}
    </Modal>
  );
}
