"use client";

import { ArrowDown, ArrowUp, ImagePlus, Link2, Trash2 } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { adminApi, errorMessage } from "@/lib/admin/product-api";
import { productSourceLabels } from "@/lib/admin/product-form";
import type { AdminProductImage, AdminUploadSettings } from "@/lib/admin/product-types";
import styles from "./product-editor.module.css";

const megabytes = (bytes: number) =>
  `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} МБ`;

interface Draft {
  id: string;
  alt: string;
}

function draftsOf(images: readonly AdminProductImage[]): Draft[] {
  return images.filter((image) => !image.locked).map((image) => ({ id: image.id, alt: image.alt }));
}

/**
 * Photos of one product: upload (JPEG/PNG/WebP, checked by the server), a
 * link https://…, order (the first photo is shown in the catalog), alt texts
 * and deletion. Photos delivered by 1C are shown read-only.
 */
export function ProductImages({
  productId,
  initialImages,
  uploads,
}: {
  productId: string;
  initialImages: AdminProductImage[];
  uploads: AdminUploadSettings;
}) {
  const [images, setImages] = useState(initialImages);
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsOf(initialImages));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [uploadAlt, setUploadAlt] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkAlt, setLinkAlt] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const locked = images.filter((image) => image.locked);
  const byId = new Map(images.map((image) => [image.id, image]));
  const original = draftsOf(images);
  const dirty = JSON.stringify(original) !== JSON.stringify(drafts);
  const limitReached = images.length >= uploads.maxImages;

  function apply(next: AdminProductImage[], text: string) {
    setImages(next);
    setDrafts(draftsOf(next));
    setMessage({ tone: "success", text });
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm("Несохранённые подписи и порядок фото будут сброшены. Продолжить?");
  }

  async function run(action: () => Promise<{ images: AdminProductImage[] }>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      apply((await action()).images, success);
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, "Действие не выполнено.") });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setMessage({ tone: "error", text: "Выберите файл фото." });
      return;
    }
    if (file.size > uploads.maxBytes) {
      setMessage({ tone: "error", text: `Файл больше ${megabytes(uploads.maxBytes)}. Уменьшите фото.` });
      return;
    }
    if (!confirmDiscard()) return;
    const form = new FormData();
    form.set("file", file);
    form.set("alt", uploadAlt);
    const done = await run(
      () => adminApi(`/api/admin/products/${productId}/images`, { form }),
      "Фото загружено.",
    );
    if (done) {
      setUploadAlt("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmDiscard()) return;
    const done = await run(
      () => adminApi(`/api/admin/products/${productId}/images`, { json: { url: linkUrl.trim(), alt: linkAlt } }),
      "Фото по ссылке добавлено.",
    );
    if (done) {
      setLinkUrl("");
      setLinkAlt("");
    }
  }

  async function remove(image: AdminProductImage) {
    const note = image.stored ? " Файл будет удалён с сервера." : "";
    if (!window.confirm(`Удалить это фото?${note}`)) return;
    if (!confirmDiscard()) return;
    await run(
      () => adminApi(`/api/admin/products/${productId}/images/${image.id}`, { method: "DELETE" }),
      "Фото удалено.",
    );
  }

  function move(index: number, offset: -1 | 1) {
    setDrafts((current) => {
      const next = [...current];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveOrder() {
    await run(
      () => adminApi(`/api/admin/products/${productId}/images`, { method: "PATCH", json: { images: drafts } }),
      "Порядок и подписи сохранены.",
    );
  }

  const ordered = [...locked.map((image) => ({ image, draft: null as Draft | null })),
    ...drafts.flatMap((draft) => {
      const image = byId.get(draft.id);
      return image ? [{ image, draft }] : [];
    })];

  return (
    <article className="admin-card">
      <div className="admin-card-head">
        <div>
          <p className="eyebrow">Фото</p>
          <h2>Фотографии <small>{images.length} из {uploads.maxImages}</small></h2>
        </div>
        <ImagePlus />
      </div>
      <div className={styles.sectionBody}>
        <p className={styles.hint}>
          Первое фото показывается в каталоге и на странице товара. Форматы JPEG, PNG и WebP до {megabytes(uploads.maxBytes)};
          тип файла проверяется по содержимому. Подпись описывает фото для незрячих покупателей и поисковиков.
        </p>
        {locked.length > 0 && (
          <p className={styles.hint}>Фото из 1С заменяются при обмене и здесь не меняются; добавленные здесь фото идут после них.</p>
        )}
        {ordered.length === 0 && <p className={styles.hint}>Фото нет: на сайте показывается иллюстрация.</p>}
        {ordered.length > 0 && (
          <div className={styles.images}>
            {ordered.map(({ image, draft }, index) => {
              const draftIndex = draft ? drafts.indexOf(draft) : -1;
              return (
                <div key={image.id} className={`${styles.imageCard} ${index === 0 ? styles.main : ""}`}>
                  <div className={styles.imagePreview}>
                    {image.url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={image.url} alt={draft?.alt ?? image.alt} loading="lazy" />
                      : <span>Ссылка скрыта: небезопасный адрес. Удалите это фото.</span>}
                  </div>
                  <div className={styles.imageMeta}>
                    {index === 0 && <span className={`${styles.badge} ${styles.sand}`}>Главное</span>}
                    <span className={`${styles.badge} ${styles.muted}`}>{image.stored ? "Загружено" : productSourceLabels[image.source] ?? image.source}</span>
                  </div>
                  {draft ? (
                    <input
                      aria-label="Подпись к фото"
                      value={draft.alt}
                      maxLength={300}
                      placeholder="Подпись (alt)"
                      onChange={(event) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, alt: event.target.value } : item))}
                    />
                  ) : (
                    <small className={styles.hint}>{image.alt || "Без подписи"}</small>
                  )}
                  <div className={styles.imageActions}>
                    <button type="button" aria-label="Переместить выше" disabled={!draft || draftIndex <= 0 || busy} onClick={() => move(draftIndex, -1)}><ArrowUp size={13} /></button>
                    <button type="button" aria-label="Переместить ниже" disabled={!draft || draftIndex >= drafts.length - 1 || busy} onClick={() => move(draftIndex, 1)}><ArrowDown size={13} /></button>
                    <button type="button" className="danger" aria-label="Удалить фото" disabled={image.locked || busy} onClick={() => void remove(image)}><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {drafts.length > 0 && (
          <div className={`${styles.searchTools} ${styles.afterSave}`}>
            <button type="button" className="admin-primary-button" disabled={!dirty || busy} onClick={() => void saveOrder()}>
              Сохранить порядок и подписи
            </button>
            {dirty && <span className={styles.hint}>Есть несохранённые изменения фото.</span>}
          </div>
        )}
        <div className={styles.addPanels}>
          <form className={styles.addPanel} onSubmit={upload}>
            <strong>Загрузить файл</strong>
            {uploads.enabled ? (
              <>
                <input ref={fileInput} type="file" name="file" accept="image/jpeg,image/png,image/webp" aria-label="Файл фото" disabled={busy || limitReached} />
                <input value={uploadAlt} maxLength={300} onChange={(event) => setUploadAlt(event.target.value)} placeholder="Подпись (alt), необязательно" aria-label="Подпись к загружаемому фото" disabled={busy || limitReached} />
                <button className="admin-secondary-button" disabled={busy || limitReached}><ImagePlus size={15} /> {busy ? "Загружаем…" : "Загрузить"}</button>
              </>
            ) : (
              <p className={styles.hint} role="status">{uploads.reason}</p>
            )}
          </form>
          <form className={styles.addPanel} onSubmit={addLink}>
            <strong>Добавить по ссылке</strong>
            <input type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" aria-label="Адрес фото" required disabled={busy || limitReached} />
            <input value={linkAlt} maxLength={300} onChange={(event) => setLinkAlt(event.target.value)} placeholder="Подпись (alt), необязательно" aria-label="Подпись к фото по ссылке" disabled={busy || limitReached} />
            <button className="admin-secondary-button" disabled={busy || limitReached}><Link2 size={15} /> Добавить</button>
          </form>
        </div>
        {limitReached && <p className={styles.hint}>Достигнут максимум фото у товара ({uploads.maxImages}). Удалите лишние, чтобы добавить новые.</p>}
        {message && <p className={`${styles.hint} ${message.tone === "error" ? styles.error : styles.success}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
      </div>
    </article>
  );
}
