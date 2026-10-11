import { z } from "zod";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Staff email: trimmed and lower-cased like the customer sign-in, so the
 * same person maps to the same `users` row. No domain restriction: staff
 * codes come from an app, not from a letter.
 */
export const staffEmailSchema = z
  .string({ error: "Укажите email." })
  .trim()
  .toLowerCase()
  .min(3, "Укажите email.")
  .max(254, "Email слишком длинный.")
  .regex(EMAIL_PATTERN, "Укажите корректный email.");

/** Six digits; spaces and hyphens that apps show inside the code are ignored. */
export const staffTotpCodeSchema = z
  .string({ error: "Введите код из приложения." })
  .max(32, "Код должен состоять из 6 цифр.")
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Код должен состоять из 6 цифр."));

export const staffLoginSchema = z.object({
  email: staffEmailSchema,
  code: staffTotpCodeSchema,
});

export const staffNameSchema = z
  .string({ error: "Укажите имя." })
  .trim()
  .min(2, "Имя должно содержать от 2 до 80 символов.")
  .max(80, "Имя должно содержать от 2 до 80 символов.");

export const staffRoleSchema = z.enum(["manager", "admin"], {
  error: "Выберите роль: менеджер или администратор.",
});

export const createStaffSchema = z.object({
  email: staffEmailSchema,
  name: staffNameSchema,
  role: staffRoleSchema,
});

/** `role: "customer"` revokes staff rights (the account stays a customer). */
export const updateStaffSchema = z
  .object({
    role: z
      .enum(["customer", "manager", "admin"], { error: "Недопустимая роль." })
      .optional(),
    status: z.enum(["active", "blocked"], { error: "Недопустимый статус." }).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "Укажите новую роль или статус.",
  });

export const staffUserIdSchema = z
  .string()
  .regex(USER_ID_PATTERN, "Некорректный идентификатор сотрудника.");

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
