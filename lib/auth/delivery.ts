const POSTBOX_ENDPOINT = "https://postbox.cloud.yandex.net";
const POSTBOX_HOST = "postbox.cloud.yandex.net";
const POSTBOX_SEND_PATH = "/v2/email/outbound-emails";
const POSTBOX_REGION = "ru-central1";
const POSTBOX_SIGNING_SERVICE = "ses";
const SIGNING_ALGORITHM = "AWS4-HMAC-SHA256";
const textEncoder = new TextEncoder();

export class DeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryConfigurationError";
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256(
  key: Uint8Array,
  value: string,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    textEncoder.encode(value),
  );
  return new Uint8Array(signature);
}

/**
 * Creates the AWS Signature Version 4 headers required by the SES-compatible
 * Yandex Cloud Postbox endpoint without pulling a server SDK into the worker.
 */
async function createPostboxAuthorizationHeaders(
  accessKeyId: string,
  secretAccessKey: string,
  requestBody: string,
  requestDate: Date,
): Promise<Record<string, string>> {
  const isoDate = requestDate
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = isoDate.slice(0, 8);
  const payloadHash = await sha256Hex(requestBody);
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${POSTBOX_HOST}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${isoDate}\n`;
  const signedHeaders =
    "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "POST",
    POSTBOX_SEND_PATH,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope =
    `${dateStamp}/${POSTBOX_REGION}/${POSTBOX_SIGNING_SERVICE}/aws4_request`;
  const stringToSign = [
    SIGNING_ALGORITHM,
    isoDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const dateKey = await hmacSha256(
    textEncoder.encode(`AWS4${secretAccessKey}`),
    dateStamp,
  );
  const regionKey = await hmacSha256(dateKey, POSTBOX_REGION);
  const serviceKey = await hmacSha256(regionKey, POSTBOX_SIGNING_SERVICE);
  const signingKey = await hmacSha256(serviceKey, "aws4_request");
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

  return {
    "Content-Type": "application/json",
    "X-Amz-Content-Sha256": payloadHash,
    "X-Amz-Date": isoDate,
    Authorization:
      `${SIGNING_ALGORITHM} Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
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

  const requestBody = JSON.stringify({
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
  });
  const authorizationHeaders = await createPostboxAuthorizationHeaders(
    accessKeyId,
    secretAccessKey,
    requestBody,
    new Date(),
  );
  const response = await fetch(`${POSTBOX_ENDPOINT}${POSTBOX_SEND_PATH}`, {
    method: "POST",
    headers: authorizationHeaders,
    body: requestBody,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Yandex Postbox вернул HTTP ${response.status}: ${errorBody.slice(0, 500)}`,
    );
  }
}
