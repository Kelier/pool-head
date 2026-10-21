import { db } from "./db";

export type AlertType = "task_done" | "new_repeat" | "task_failed" | "budget" | "schedule";

export function addAlert(type: AlertType, title: string, body?: string, href?: string) {
  db().prepare("INSERT INTO alerts(ts, type, title, body, href) VALUES (?,?,?,?,?)").run(Date.now(), type, title, body ?? null, href ?? null);
}

export function listAlerts(limit = 50) {
  const d = db();
  return {
    unread: (d.prepare("SELECT COUNT(*) c FROM alerts WHERE read = 0").get() as { c: number }).c,
    items: d.prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT ?").all(limit),
  };
}

export function markAlertsRead(ids?: number[]) {
  if (ids?.length) db().prepare(`UPDATE alerts SET read = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  else db().exec("UPDATE alerts SET read = 1");
}
