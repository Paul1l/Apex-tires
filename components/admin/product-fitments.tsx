"use client";

import { CarFront, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi, errorMessage } from "@/lib/admin/product-api";
import { parseDecimalInput } from "@/lib/admin/product-form";
import type {
  AdminProductFitment,
  AdminProductFitmentList,
  AdminProductKind,
  AdminVehicleReference,
} from "@/lib/admin/product-types";
import styles from "./product-editor.module.css";

const axleLabels: Record<AdminProductFitment["axle"], string> = { all: "Обе оси", front: "Передняя", rear: "Задняя" };
const typeLabels: Record<AdminProductFitment["fitmentType"], string> = {
  factory: "Заводская",
  alternative: "Допустимая замена",
  tuning: "Тюнинг",
};
const sourceLabels: Record<string, string> = { manual: "Вручную", import: "Импорт", external_api: "Внешний сервис" };

function years(item: { yearFrom?: number | null; yearTo?: number | null }): string {
  if (!item.yearFrom && !item.yearTo) return "";
  return ` (${item.yearFrom ?? "…"}–${item.yearTo ?? "н. в."})`;
}

type Level = "makes" | "models" | "generations" | "modifications";

function useReferenceList(level: Level, parentId: string | null, enabled: boolean) {
  const [items, setItems] = useState<AdminVehicleReference[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setItems([]);
    setError("");
    if (!enabled || (level !== "makes" && !parentId)) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ level });
    if (parentId) query.set("parentId", parentId);
    adminApi<{ items: AdminVehicleReference[] }>(`/api/admin/products/vehicle-references?${query}`, { signal: controller.signal })
      .then((result) => setItems(result.items))
      .catch((loadError: unknown) => {
        if ((loadError as { name?: string }).name !== "AbortError") setError(errorMessage(loadError, "Справочник недоступен."));
      });
    return () => controller.abort();
  }, [level, parentId, enabled]);
  return { items, error };
}

/**
 * Vehicle fitment of a product. The storefront matches cars to products by
 * size (table fitments), so a change here applies to every product of the
 * same size; the list shows exactly what buyers' vehicle filter uses.
 */
export function ProductFitments({ productId, kind }: { productId: string; kind: AdminProductKind }) {
  const [list, setList] = useState<AdminProductFitmentList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [modificationId, setModificationId] = useState("");
  const [axle, setAxle] = useState<AdminProductFitment["axle"]>("all");
  const [fitmentType, setFitmentType] = useState<AdminProductFitment["fitmentType"]>("factory");
  const [etMin, setEtMin] = useState("");
  const [etMax, setEtMax] = useState("");
  const [dia, setDia] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const sizeKnown = Boolean(list?.size);
  const makes = useReferenceList("makes", null, sizeKnown);
  const models = useReferenceList("models", makeId || null, sizeKnown);
  const generations = useReferenceList("generations", modelId || null, sizeKnown);
  const modifications = useReferenceList("modifications", generationId || null, sizeKnown);

  const load = useCallback((signal?: AbortSignal) => {
    setLoadError("");
    return adminApi<AdminProductFitmentList>(`/api/admin/products/${productId}/fitments`, { signal })
      .then(setList)
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") setLoadError(errorMessage(error, "Применимость недоступна."));
      });
  }, [productId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  async function add() {
    if (!generationId) {
      setMessage({ tone: "error", text: "Выберите марку, модель и поколение." });
      return;
    }
    const range = { etMin: parseDecimalInput(etMin), etMax: parseDecimalInput(etMax), dia: parseDecimalInput(dia) };
    if (Object.values(range).some((value) => value !== null && Number.isNaN(value))) {
      setMessage({ tone: "error", text: "ET и DIA: укажите числа или оставьте поля пустыми." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await adminApi<{ created: boolean }>(`/api/admin/products/${productId}/fitments`, {
        json: {
          generationId,
          modificationId: modificationId || null,
          axle,
          fitmentType,
          ...(kind === "wheel" ? range : {}),
        },
      });
      setMessage({ tone: "success", text: result.created ? "Применимость добавлена." : "Такая применимость уже была — она снова подтверждена." });
      setModificationId("");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, "Применимость не добавлена.") });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(fitment: AdminProductFitment) {
    const others = list?.sameSizeProducts ?? 0;
    const scope = others > 0 ? ` Она перестанет действовать и для других товаров этого размера (${others}).` : "";
    if (!window.confirm(`Отозвать применимость «${fitment.make} ${fitment.model} ${fitment.generation}»?${scope}`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await adminApi(`/api/admin/products/${productId}/fitments/${fitment.id}`, { method: "DELETE" });
      setMessage({ tone: "success", text: "Применимость отозвана." });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, "Применимость не отозвана.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="admin-card">
      <div className="admin-card-head">
        <div>
          <p className="eyebrow">Подбор по автомобилю</p>
          <h2>Применимость {list?.size && <small>по размеру {list.size}</small>}</h2>
        </div>
        <CarFront />
      </div>
      <div className={styles.sectionBody}>
        {loadError && <p className={`${styles.hint} ${styles.error}`} role="alert">{loadError}</p>}
        {list && !list.size && (
          <p className={styles.hint}>Заполните и сохраните размер товара — применимость задаётся по размеру.</p>
        )}
        {list?.size && (
          <>
            <p className={styles.hint}>
              Подбор на сайте связывает поколение автомобиля с размером, а не с конкретным товаром.
              Изменения здесь действуют на все товары размера {list.size}
              {list.sameSizeProducts > 0 ? ` (ещё ${list.sameSizeProducts} шт.)` : ""}.
            </p>
            {list.items.length === 0 ? (
              <p className={styles.hint}>Подтверждённой применимости пока нет: товар не показывается при подборе по автомобилю.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Автомобиль</th><th>Модификация</th><th>Ось / тип</th><th>Источник</th><th>Действие</th></tr></thead>
                  <tbody>
                    {list.items.map((fitment) => (
                      <tr key={fitment.id}>
                        <td><strong>{fitment.make} {fitment.model}</strong><small>{fitment.generation}{years(fitment)}</small></td>
                        <td>{fitment.modification ?? "Все"}{kind === "wheel" && (fitment.etMin !== null || fitment.etMax !== null || fitment.dia !== null) && (
                          <small>ET {fitment.etMin ?? "…"}–{fitment.etMax ?? "…"}{fitment.dia !== null ? `, DIA от ${fitment.dia}` : ""}</small>
                        )}</td>
                        <td>{axleLabels[fitment.axle]}<small>{typeLabels[fitment.fitmentType]}</small></td>
                        <td>{sourceLabels[fitment.source] ?? fitment.source}</td>
                        <td><button type="button" className={styles.linkButton} disabled={busy} onClick={() => void revoke(fitment)}><Trash2 size={12} /> Отозвать</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {makes.error && <p className={`${styles.hint} ${styles.error}`} role="alert">{makes.error}</p>}
            {!makes.error && makes.items.length === 0 ? (
              <p className={styles.hint}>
                Справочник автомобилей пуст. Загрузите fitments.csv в разделе «Товары» — после этого здесь можно выбирать автомобили.
              </p>
            ) : (
              <div className={styles.fitmentForm}>
                <label><span>Марка</span>
                  <select value={makeId} onChange={(event) => { setMakeId(event.target.value); setModelId(""); setGenerationId(""); setModificationId(""); }}>
                    <option value="">Выберите марку</option>
                    {makes.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label><span>Модель</span>
                  <select value={modelId} disabled={!makeId} onChange={(event) => { setModelId(event.target.value); setGenerationId(""); setModificationId(""); }}>
                    <option value="">Выберите модель</option>
                    {models.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label><span>Поколение</span>
                  <select value={generationId} disabled={!modelId} onChange={(event) => { setGenerationId(event.target.value); setModificationId(""); }}>
                    <option value="">Выберите поколение</option>
                    {generations.items.map((item) => <option key={item.id} value={item.id}>{item.name}{years(item)}</option>)}
                  </select>
                </label>
                <label><span>Модификация</span>
                  <select value={modificationId} disabled={!generationId} onChange={(event) => setModificationId(event.target.value)}>
                    <option value="">Все модификации</option>
                    {modifications.items.map((item) => <option key={item.id} value={item.id}>{item.name}{years(item)}</option>)}
                  </select>
                </label>
                <label><span>Ось</span>
                  <select value={axle} onChange={(event) => setAxle(event.target.value as AdminProductFitment["axle"])}>
                    {Object.entries(axleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label><span>Тип</span>
                  <select value={fitmentType} onChange={(event) => setFitmentType(event.target.value as AdminProductFitment["fitmentType"])}>
                    {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {kind === "wheel" && (
                  <>
                    <label><span>ET от</span><input inputMode="decimal" value={etMin} onChange={(event) => setEtMin(event.target.value)} placeholder="любой" /></label>
                    <label><span>ET до</span><input inputMode="decimal" value={etMax} onChange={(event) => setEtMax(event.target.value)} placeholder="любой" /></label>
                    <label><span>DIA ступицы</span><input inputMode="decimal" value={dia} onChange={(event) => setDia(event.target.value)} placeholder="не проверять" /></label>
                  </>
                )}
                <div className={styles.fitmentFormActions}>
                  <button type="button" className="admin-secondary-button" disabled={busy || !generationId} onClick={() => void add()}>
                    {busy ? "Сохраняем…" : "Добавить применимость"}
                  </button>
                  {(models.error || generations.error || modifications.error) && (
                    <span className={`${styles.hint} ${styles.error}`}>{models.error || generations.error || modifications.error}</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {message && <p className={`${styles.hint} ${message.tone === "error" ? styles.error : styles.success}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
      </div>
    </article>
  );
}
