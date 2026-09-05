"use client";
import { useEffect, useState } from "react";

interface ImportJob {
  id: string; filename: string; status: string; processed_rows: number;
  created_rows: number; updated_rows: number; failed_rows: number;
}
const statuses: Record<string, string> = { queued: "В очереди", processing: "Обрабатывается", completed: "Завершён", completed_with_errors: "Завершён с ошибками", failed: "Прерван" };

export function ImportJobs() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/admin/imports/jobs", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Журнал импорта недоступен.");
        setJobs(result.items); setError("");
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Журнал импорта недоступен."); }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  return <article className="admin-card"><h2>Последние импорты</h2>{error && <p role="alert">{error}</p>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Файл</th><th>Статус</th><th>Обработано</th><th>Создано / обновлено</th><th>Ошибки</th></tr></thead>
      <tbody>{jobs.map((job) => <tr key={job.id}><td>{job.filename}</td><td>{statuses[job.status] || job.status}</td><td>{job.processed_rows}</td><td>{job.created_rows} / {job.updated_rows}</td><td>{job.failed_rows > 0 ? <a href={`/api/admin/imports/jobs/${job.id}/errors`}>Скачать CSV ({job.failed_rows})</a> : "—"}</td></tr>)}</tbody></table></div>
    {!jobs.length && !error && <p>Импорты ещё не запускались.</p>}
  </article>;
}
