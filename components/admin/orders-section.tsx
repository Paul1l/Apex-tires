"use client";

import { ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/catalog-data";

export function OrdersSection() {
  const [orders, setOrders] = useState<Array<{
    id: string;
    number: string;
    status: string;
    paymentStatus: string;
    total: number;
    createdAt: string;
    items: Array<{ name: string; quantity: number }>;
  }>>([]);
  const [message, setMessage] = useState("Загружаем заказы…");
  const [actionMessage, setActionMessage] = useState("");

  async function updateStatus(orderId: string, status: string) {
    setActionMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Статус не обновлён.");
      setOrders((current) =>
        current.map((order) => (order.id === orderId ? { ...order, status } : order)),
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Статус не обновлён.");
    }
  }

  useEffect(() => {
    const abortController = new AbortController();
    void fetch("/api/admin/orders", {
      credentials: "same-origin",
      cache: "no-store",
      signal: abortController.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          items?: typeof orders;
          message?: string;
        };
        if (!response.ok) throw new Error(result.message || "Заказы недоступны.");
        setOrders(result.items ?? []);
        setMessage("");
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setMessage(error instanceof Error ? error.message : "Заказы недоступны.");
        }
      });
    return () => abortController.abort();
  }, []);

  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Продажи</p><h1>Заказы</h1><span>Данные загружаются из PostgreSQL через защищённый API.</span>{actionMessage && <small className="admin-login-message">{actionMessage}</small>}</div></div>
      {message ? (
        <article className="admin-card admin-empty"><ShoppingCart /><strong>{message}</strong></article>
      ) : orders.length === 0 ? (
        <article className="admin-card admin-empty"><ShoppingCart /><strong>Заказов пока нет</strong></article>
      ) : (
        <article className="admin-card products-card">
          <div className="admin-table-wrap">
            <table className="admin-table"><thead><tr><th>Номер</th><th>Дата</th><th>Состав</th><th>Статус</th><th>Сумма</th></tr></thead>
              <tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.number}</strong></td><td>{new Date(order.createdAt).toLocaleString("ru-RU")}</td><td>{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</td><td><select value={order.status} onChange={(event) => void updateStatus(order.id, event.target.value)}><option value="new">Новый</option><option value="confirmed">Подтверждён</option><option value="processing">В работе</option><option value="ready_for_pickup">Готов к выдаче</option><option value="shipped">Отправлен</option><option value="completed">Завершён</option><option value="cancelled">Отменён</option></select><small>Оплата: {order.paymentStatus}</small></td><td><strong>{formatPrice(order.total)}</strong></td></tr>)}</tbody>
            </table>
          </div>
        </article>
      )}
    </>
  );
}
