import { parseArgs } from "node:util";
import { businessConfig } from "../../config/business";
import { readEnvironment } from "../config/environment";
import { createPostgresPool } from "../database/postgres-client";
import { StaffRepository } from "../repositories/staff-repository";
import {
  formatSecretForDisplay,
  renderEnrollmentQrAscii,
} from "../security/staff-enrollment";
import { deriveStaffSecretKey } from "../security/staff-secret-box";
import { StaffManagementService } from "../services/staff-management-service";
import { sanitizeError } from "../types/common";
import { ApplicationError } from "../utils/errors";
import {
  staffEmailSchema,
  staffNameSchema,
  staffRoleSchema,
} from "../validators/staff-schemas";

/**
 * Creates the first administrator (or any staff member) and prints a new
 * authenticator key. Also the way back in when the last administrator lost
 * the phone: the account is made active and gets a new key, all of its
 * sessions end.
 *
 *   pnpm admin:create -- --email admin@example.ru --name "Имя Фамилия" [--role admin|manager]
 *
 * Needs DATABASE_URL and OTP_CODE_PEPPER (the same pepper as the running site,
 * otherwise the key cannot be decrypted at sign-in).
 */
const USAGE =
  'Использование: pnpm admin:create -- --email admin@example.ru --name "Имя Фамилия" [--role admin|manager]';

class UsageError extends Error {}

function readArguments() {
  // pnpm may pass the "--" separator through to the script.
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  let values: { email?: string; name?: string; role?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        email: { type: "string" },
        name: { type: "string" },
        role: { type: "string", default: "admin" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError(USAGE);
  }
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return null;
  }
  const email = staffEmailSchema.safeParse(values.email ?? "");
  if (!email.success) throw new UsageError(`${email.error.issues[0]?.message ?? "Укажите email."}\n${USAGE}`);
  const role = staffRoleSchema.safeParse(values.role);
  if (!role.success) throw new UsageError(`--role: admin или manager.\n${USAGE}`);
  let name: string | undefined;
  if (values.name !== undefined) {
    const parsedName = staffNameSchema.safeParse(values.name);
    if (!parsedName.success) throw new UsageError(parsedName.error.issues[0]?.message ?? USAGE);
    name = parsedName.data;
  }
  return { email: email.data, name, role: role.data };
}

async function main(): Promise<void> {
  const input = readArguments();
  if (!input) return;
  if (!process.env.DATABASE_URL) throw new UsageError("Не задан DATABASE_URL.");
  const environment = readEnvironment();
  if (!environment.OTP_CODE_PEPPER) {
    throw new UsageError(
      "Не задан OTP_CODE_PEPPER: нужен тот же секрет, что у работающего сайта.",
    );
  }
  const pool = createPostgresPool(environment);
  try {
    const service = new StaffManagementService({
      pool,
      repository: new StaffRepository(),
      encryptionKey: deriveStaffSecretKey(environment.OTP_CODE_PEPPER),
      issuer: businessConfig.brandName,
    });
    const { member, enrollment, created } = await service.provisionFromCommandLine(input);
    const roleLabel = member.role === "admin" ? "администратор" : "менеджер";
    process.stdout.write(
      [
        "",
        created
          ? `Создан сотрудник (${roleLabel}).`
          : `Учётная запись получила роль «${roleLabel}» и активна. Прежний ключ и все сессии отменены.`,
        "",
        "ВНИМАНИЕ: ниже секретный ключ входа в админку. Не сохраняйте этот вывод",
        "в файлы, журналы и чаты; очистите экран после подключения приложения.",
        "",
        "Отсканируйте QR-код в Google Authenticator, Яндекс Ключе или другом",
        "приложении-аутентификаторе (ключ показывается один раз):",
        "",
        renderEnrollmentQrAscii(enrollment.otpauthUri),
        "",
        `Ключ для ручного ввода: ${formatSecretForDisplay(enrollment.secret)}`,
        `Ссылка otpauth: ${enrollment.otpauthUri}`,
        "",
        "Вход: /admin — email и 6-значный код из приложения.",
        "",
      ].join("\n"),
    );
  } finally {
    await pool.end();
  }
}

// Errors without stack or row data: no email or key reaches the console here.
main().catch((error: unknown) => {
  if (error instanceof UsageError || error instanceof ApplicationError) {
    console.error(error.message);
  } else {
    const summary = sanitizeError(error);
    const code = typeof summary.code === "string" ? ` [${summary.code}]` : "";
    console.error(
      `Команда не выполнена: ${typeof summary.message === "string" ? summary.message : "неизвестная ошибка"}${code}`,
    );
  }
  process.exitCode = 1;
});
