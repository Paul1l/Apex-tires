"use client";

import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw, UserPlus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useStore } from "@/components/store-provider";
import {
  StaffEnrollmentDialog,
  type StaffEnrollmentData,
} from "@/components/admin/staff-enrollment-dialog";
import styles from "./staff-section.module.css";

type StaffRole = "manager" | "admin";
type StaffStatus = "active" | "blocked";

interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  status: StaffStatus;
  enrolled: boolean;
  confirmed: boolean;
  confirmedAt: string | null;
  locked: boolean;
  lockedUntil: string | null;
  createdAt: string;
}

interface ApiBody {
  ok?: boolean;
  code?: string;
  message?: string;
  details?: Array<{ field?: string; message?: string }>;
  items?: StaffMember[];
  member?: StaffMember | null;
  enrollment?: StaffEnrollmentData;
  promoted?: boolean;
}

type LoadState = "loading" | "ready" | "forbidden" | "signed_out" | "error";

const ROLE_LABELS: Record<StaffRole, string> = {
  manager: "Менеджер",
  admin: "Администратор",
};

const FORBIDDEN_MESSAGE =
  "Раздел «Сотрудники» доступен только администратору. Чтобы изменить права, обратитесь к администратору магазина.";
const SIGNED_OUT_MESSAGE = "Сессия завершилась. Обновите страницу и войдите снова.";

class StaffApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function callStaffApi(url: string, init?: RequestInit): Promise<ApiBody> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new StaffApiError("Нет соединения с сервером. Попробуйте ещё раз.", 0);
  }
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  if (response.status === 403 && body.code === "ACCESS_DENIED") {
    throw new StaffApiError(FORBIDDEN_MESSAGE, 403);
  }
  if (response.status === 401) throw new StaffApiError(SIGNED_OUT_MESSAGE, 401);
  if (!response.ok || body.ok === false) {
    throw new StaffApiError(
      body.details?.find((detail) => detail.message)?.message ??
        body.message ??
        "Действие не выполнено. Попробуйте ещё раз.",
      response.status,
    );
  }
  return body;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KeyState({ member }: { member: StaffMember }) {
  return (
    <div className={styles.badges}>
      {member.status === "blocked" ? (
        <span className={`${styles.badge} ${styles.badgeBad}`}>Заблокирован</span>
      ) : (
        <span className={`${styles.badge} ${styles.badgeOk}`}>Активен</span>
      )}
      {!member.enrolled ? (
        <span className={`${styles.badge} ${styles.badgeBad}`}>Ключ не выдан</span>
      ) : member.confirmed ? (
        <span className={`${styles.badge} ${styles.badgeMuted}`}>Приложение подключено</span>
      ) : (
        <span className={`${styles.badge} ${styles.badgeWait}`}>Ждёт первого входа</span>
      )}
      {member.locked && member.lockedUntil && (
        <span className={`${styles.badge} ${styles.badgeBad}`}>
          Вход закрыт до {formatDateTime(member.lockedUntil)}
        </span>
      )}
    </div>
  );
}

/** Staff accounts and authenticator keys; administrators only (API returns 403 otherwise). */
export function StaffSection() {
  const router = useRouter();
  const { user } = useStore();
  const [items, setItems] = useState<StaffMember[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<{ email: string; name: string; role: StaffRole }>({
    email: "",
    name: "",
    role: "manager",
  });
  const [creating, setCreating] = useState(false);
  const [shownKey, setShownKey] = useState<{
    member: StaffMember;
    enrollment: StaffEnrollmentData;
    signedOut: boolean;
  } | null>(null);
  const formHintId = useId();
  const addButtonReference = useRef<HTMLButtonElement>(null);
  const rowReferences = useRef(new Map<string, HTMLTableRowElement>());
  // Where focus goes when the key dialog closes: the control that opened it,
  // or the member's row when that control is gone (QA-29b).
  const returnFocusReference = useRef<{ opener: HTMLElement | null; memberId: string } | null>(
    null,
  );

  useEffect(() => {
    if (shownKey) return;
    const target = returnFocusReference.current;
    if (!target) return;
    returnFocusReference.current = null;
    const { opener } = target;
    // Runs after the dialog's own focus restore, which may have picked <body>
    // (the opener was disabled while the request was running).
    if (
      opener?.isConnected &&
      !opener.closest("[inert]") &&
      !(opener instanceof HTMLButtonElement && opener.disabled)
    ) {
      opener.focus();
      return;
    }
    rowReferences.current.get(target.memberId)?.focus();
  }, [shownKey]);

  const handleFailure = useCallback((error: unknown) => {
    if (error instanceof StaffApiError && error.status === 403) setLoadState("forbidden");
    else if (error instanceof StaffApiError && error.status === 401) setLoadState("signed_out");
    else {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Действие не выполнено.",
      });
    }
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const body = await callStaffApi("/api/admin/staff", { signal });
        setItems(body.items ?? []);
        setLoadState("ready");
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof StaffApiError && (error.status === 403 || error.status === 401)) {
          handleFailure(error);
        } else {
          setLoadState("error");
          setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : "Список сотрудников недоступен.",
          });
        }
      }
    },
    [handleFailure],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function replaceMember(member: StaffMember) {
    setItems((current) => {
      const exists = current.some((item) => item.id === member.id);
      return exists
        ? current.map((item) => (item.id === member.id ? member : item))
        : [...current, member];
    });
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const body = await callStaffApi("/api/admin/staff", {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (body.member && body.enrollment) {
        replaceMember(body.member);
        returnFocusReference.current = {
          opener: addButtonReference.current,
          memberId: body.member.id,
        };
        setShownKey({ member: body.member, enrollment: body.enrollment, signedOut: false });
        setNotice({
          kind: "success",
          text: body.promoted
            ? `${body.member.email}: существующей учётной записи выдана роль «${ROLE_LABELS[body.member.role]}».`
            : `Сотрудник ${body.member.email} добавлен.`,
        });
        setForm({ email: "", name: "", role: "manager" });
      }
    } catch (error) {
      handleFailure(error);
    } finally {
      setCreating(false);
    }
  }

  async function updateMember(
    member: StaffMember,
    changes: { role?: StaffRole | "customer"; status?: StaffStatus },
    confirmation: string,
  ) {
    if (!window.confirm(confirmation)) return;
    setBusyId(member.id);
    setNotice(null);
    try {
      const body = await callStaffApi(`/api/admin/staff/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      if (body.member) {
        replaceMember(body.member);
        setNotice({ kind: "success", text: `Изменения для ${member.email} сохранены.` });
      } else {
        setItems((current) => current.filter((item) => item.id !== member.id));
        setNotice({
          kind: "success",
          text: `${member.email} больше не сотрудник: права и ключ отозваны.`,
        });
      }
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusyId(null);
    }
  }

  async function reissueKey(member: StaffMember, isSelf: boolean, opener: HTMLElement) {
    const confirmation = isSelf
      ? "Выдать вам новый ключ? Старый ключ перестанет работать, текущая сессия завершится — после этого войдите с кодом из нового ключа."
      : `Выдать новый ключ для ${member.email}? Старый ключ перестанет работать, все сессии сотрудника завершатся.`;
    if (!window.confirm(confirmation)) return;
    setBusyId(member.id);
    setNotice(null);
    try {
      const body = await callStaffApi(`/api/admin/staff/${member.id}/totp`, { method: "POST" });
      if (body.member && body.enrollment) {
        replaceMember(body.member);
        returnFocusReference.current = { opener, memberId: body.member.id };
        setShownKey({ member: body.member, enrollment: body.enrollment, signedOut: isSelf });
      }
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusyId(null);
    }
  }

  function closeKeyDialog() {
    const signedOut = shownKey?.signedOut ?? false;
    setShownKey(null);
    // Own key re-issued: the session has ended, show the sign-in form.
    if (signedOut) router.refresh();
  }

  const intro = (
    <div className="admin-page-intro">
      <div>
        <p className="eyebrow">Доступ</p>
        <h1>Сотрудники</h1>
        <span>Вход в админку — по email и коду из приложения-аутентификатора.</span>
      </div>
      {loadState === "ready" && (
        <button
          className="admin-secondary-button"
          type="button"
          onClick={() => {
            setNotice(null);
            void load();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" /> Обновить
        </button>
      )}
    </div>
  );

  if (loadState === "forbidden" || loadState === "signed_out") {
    return (
      <>
        {intro}
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {loadState === "forbidden" ? FORBIDDEN_MESSAGE : SIGNED_OUT_MESSAGE}
        </p>
      </>
    );
  }

  return (
    <>
      {intro}
      <div className={styles.layout}>
        {notice && (
          <p
            className={`${styles.notice} ${notice.kind === "error" ? styles.error : styles.success}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}

        <article className="admin-card">
          <div className="admin-card-head">
            <div>
              <p className="eyebrow">Новый сотрудник</p>
              <h2>Добавить и выдать ключ</h2>
            </div>
            <UserPlus aria-hidden="true" />
          </div>
          <form
            className={styles.addForm}
            onSubmit={(event) => void createStaff(event)}
            aria-describedby={formHintId}
          >
            <label>
              <span>Email</span>
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="off"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                disabled={creating || loadState !== "ready"}
              />
            </label>
            <label>
              <span>Имя</span>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                autoComplete="off"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                disabled={creating || loadState !== "ready"}
              />
            </label>
            <label>
              <span>Роль</span>
              <select
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as StaffRole })}
                disabled={creating || loadState !== "ready"}
              >
                <option value="manager">{ROLE_LABELS.manager}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </label>
            <button
              ref={addButtonReference}
              className="admin-primary-button"
              type="submit"
              disabled={creating || loadState !== "ready"}
            >
              <KeyRound size={16} aria-hidden="true" /> {creating ? "Добавляем…" : "Добавить"}
            </button>
            <p className={styles.formHint} id={formHintId}>
              Если покупатель с таким email уже зарегистрирован, его учётная запись получит роль.
              Менеджер работает с каталогом и заказами, администратор ещё и управляет сотрудниками.
            </p>
          </form>
        </article>

        <article className="admin-card">
          <div className="admin-card-head">
            <div>
              <p className="eyebrow">Список</p>
              <h2>
                Сотрудники <small>{loadState === "ready" ? items.length : ""}</small>
              </h2>
            </div>
          </div>
          {loadState === "loading" && <p className={styles.empty}>Загружаем список…</p>}
          {loadState === "ready" && items.length === 0 && (
            <p className={styles.empty}>Сотрудников пока нет.</p>
          )}
          {items.length > 0 && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Сотрудники магазина</caption>
                <thead>
                  <tr>
                    <th scope="col">Сотрудник</th>
                    <th scope="col">Роль</th>
                    <th scope="col">Состояние</th>
                    <th scope="col">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((member) => {
                    const isSelf = member.id === user?.id;
                    const busy = busyId === member.id;
                    return (
                      <tr
                        key={member.id}
                        tabIndex={-1}
                        ref={(row) => {
                          if (row) rowReferences.current.set(member.id, row);
                          else rowReferences.current.delete(member.id);
                        }}
                      >
                        <td className={styles.person}>
                          <strong>
                            {member.name || "Без имени"}
                            {isSelf && <span className={styles.you}>Это вы</span>}
                          </strong>
                          <small>{member.email}</small>
                        </td>
                        <td>
                          <div className={styles.rowControls}>
                            <select
                              aria-label={`Роль: ${member.email}`}
                              value={member.role}
                              disabled={isSelf || busy}
                              onChange={(event) => {
                                const role = event.target.value as StaffRole;
                                void updateMember(
                                  member,
                                  { role },
                                  `Назначить ${member.email} роль «${ROLE_LABELS[role]}»? Все сессии сотрудника завершатся.`,
                                );
                              }}
                            >
                              <option value="manager">{ROLE_LABELS.manager}</option>
                              <option value="admin">{ROLE_LABELS.admin}</option>
                            </select>
                          </div>
                        </td>
                        <td>
                          <KeyState member={member} />
                        </td>
                        <td>
                          <div className={styles.rowControls}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={(event) => void reissueKey(member, isSelf, event.currentTarget)}
                              aria-label={`Новый ключ: ${member.email}`}
                            >
                              {member.enrolled ? "Новый ключ" : "Выдать ключ"}
                            </button>
                            {member.status === "active" ? (
                              <button
                                type="button"
                                className={styles.danger}
                                disabled={isSelf || busy}
                                aria-label={`Заблокировать: ${member.email}`}
                                onClick={() =>
                                  void updateMember(
                                    member,
                                    { status: "blocked" },
                                    `Заблокировать ${member.email}? Все сессии сотрудника завершатся, вход будет закрыт.`,
                                  )
                                }
                              >
                                Заблокировать
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isSelf || busy}
                                aria-label={`Разблокировать: ${member.email}`}
                                onClick={() =>
                                  void updateMember(
                                    member,
                                    { status: "active" },
                                    `Разблокировать ${member.email}?`,
                                  )
                                }
                              >
                                Разблокировать
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.danger}
                              disabled={isSelf || busy}
                              aria-label={`Снять права: ${member.email}`}
                              onClick={() =>
                                void updateMember(
                                  member,
                                  { role: "customer" },
                                  `Снять с ${member.email} права сотрудника? Ключ будет удалён, все сессии завершатся; учётная запись останется покупательской.`,
                                )
                              }
                            >
                              Снять права
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>

      {shownKey && (
        <StaffEnrollmentDialog
          name={shownKey.member.name}
          email={shownKey.member.email}
          enrollment={shownKey.enrollment}
          note={
            shownKey.signedOut
              ? "Ваша сессия завершена. Добавьте ключ в приложение, затем закройте окно и войдите с новым кодом."
              : undefined
          }
          onClose={closeKeyDialog}
        />
      )}
    </>
  );
}
