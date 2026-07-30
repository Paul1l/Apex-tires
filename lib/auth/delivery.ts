import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export class DeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryConfigurationError";
  }
}

/**
 * Sends a six-digit authentication code through Yandex Cloud Postbox.
 * Provider credentials remain only in the server environment.
 */
export async function deliverAuthenticationCode(
  environment: CloudflareEnv,
  email: string,
  code: string,
): Promise<void> {
  const accessKeyId = environment.YANDEX_POSTBOX_ACCESS_KEY_ID;
  const secretAccessKey = environment.YANDEX_POSTBOX_SECRET_ACCESS_KEY;
  const fromEmail = environment.YANDEX_POSTBOX_FROM_EMAIL;
  const fromName = environment.YANDEX_POSTBOX_FROM_NAME?.trim() || "APEX WHEELS";

  if (!accessKeyId || !secretAccessKey || !fromEmail) {
    throw new DeliveryConfigurationError(
      "Отправка на почту пока не подключена.",
    );
  }

  const postboxClient = new SESv2Client({
    region: "ru-central1",
    endpoint: "https://postbox.cloud.yandex.net",
    credentials: { accessKeyId, secretAccessKey },
  });

  await postboxClient.send(
    new SendEmailCommand({
      FromEmailAddress: `${fromName} <${fromEmail}>`,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: {
            Data: "Код входа в APEX WHEELS",
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: `Ваш код подтверждения: ${code}\n\nКод действует 10 минут. Никому его не сообщайте.`,
              Charset: "UTF-8",
            },
            Html: {
              Data: `<div style="font-family:Arial,sans-serif;color:#131722"><p>Ваш код подтверждения:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>Код действует 10 минут. Никому его не сообщайте.</p></div>`,
              Charset: "UTF-8",
            },
          },
        },
      },
    }),
  );
}
