"use client";
import { useEffect, useState } from "react";

interface FitmentRequest { id: string; make: string; model: string; model_year: number | null; modification: string | null; customer_name: string; customer_phone: string; status: string; }
const statuses: Record<string,string> = { new: "Новая", in_progress: "В работе", resolved: "Подобрано", closed: "Закрыта" };
export function FitmentRequests() {
  const [items,setItems] = useState<FitmentRequest[]>([]);
  const [page,setPage] = useState(1);
  const [hasNext,setHasNext] = useState(false);
  const [message,setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/fitment-requests?page=${page}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.message || "Заявки недоступны."); setItems(result.items); setHasNext(result.hasNextPage); setMessage(""); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Заявки недоступны."); });
    return () => controller.abort();
  }, [page]);
  async function update(id: string,status: string) {
    try {
      const response = await fetch("/api/admin/fitment-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({id,status}) });
      if (!response.ok) throw new Error("Статус заявки не сохранён.");
      setItems((current) => current.map((item) => item.id === id ? {...item,status} : item)); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Статус заявки не сохранён."); }
  }
  return <article className="admin-card"><h1>Заявки на подбор автомобиля</h1>{message && <p role="alert">{message}</p>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Автомобиль</th><th>Клиент</th><th>Телефон</th><th>Статус</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td>{item.make} {item.model}<small>{item.model_year} {item.modification}</small></td><td>{item.customer_name}</td><td>{item.customer_phone}</td><td><select value={item.status} onChange={(event) => void update(item.id,event.target.value)}>{Object.entries(statuses).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr>)}
    </tbody></table></div>{!items.length && !message && <p>Заявок пока нет.</p>}
    <button disabled={page===1} onClick={() => setPage(page-1)}>Назад</button><span> Страница {page} </span><button disabled={!hasNext} onClick={() => setPage(page+1)}>Далее</button>
  </article>;
}
