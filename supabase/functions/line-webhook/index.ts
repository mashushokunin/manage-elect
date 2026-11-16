import "@supabase/functions-js/edge-runtime.d.ts";

type LineWebhook = {
  destination?: string;
  events?: unknown[];
};

type AppsScriptMessage = {
  type: "text";
  text: string;
};

type AppsScriptReply = {
  reply_token: string;
  messages: AppsScriptMessage[];
};

type AppsScriptResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  replies?: AppsScriptReply[];
};

const encoder = new TextEncoder();

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function readEnvironment() {
  return {
    channelSecret: Deno.env.get("LINE_CHANNEL_SECRET") ?? "",
    channelAccessToken: Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "",
    appsScriptUrl: Deno.env.get("APPS_SCRIPT_WEB_APP_URL") ?? "",
    gatewaySecret: Deno.env.get("LINE_GATEWAY_SECRET") ?? "",
  };
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (_error) {
    return null;
  }
}

async function verifyLineSignature(
  rawBody: string,
  signature: string,
  channelSecret: string,
): Promise<boolean> {
  const receivedSignature = decodeBase64(signature);
  if (!receivedSignature) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    receivedSignature,
    encoder.encode(rawBody),
  );
}

function parseWebhook(rawBody: string): LineWebhook | null {
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return null;
    }
    return parsed as LineWebhook;
  } catch (_error) {
    return null;
  }
}

function normalizeReplies(value: unknown): AppsScriptReply[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }

    const reply = candidate as Partial<AppsScriptReply>;
    if (
      typeof reply.reply_token !== "string" ||
      reply.reply_token.length === 0 ||
      !Array.isArray(reply.messages)
    ) {
      return [];
    }

    const messages = reply.messages.flatMap((message) => {
      if (
        !message ||
        typeof message !== "object" ||
        (message as AppsScriptMessage).type !== "text" ||
        typeof (message as AppsScriptMessage).text !== "string"
      ) {
        return [];
      }
      const text = (message as AppsScriptMessage).text.slice(0, 5000);
      return text ? [{ type: "text" as const, text }] : [];
    });

    return messages.length > 0
      ? [{ reply_token: reply.reply_token, messages: messages.slice(0, 5) }]
      : [];
  });
}

async function forwardToAppsScript(
  webhook: LineWebhook,
  appsScriptUrl: string,
  gatewaySecret: string,
): Promise<AppsScriptResponse> {
  const response = await fetch(appsScriptUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "line_webhook",
      gateway_secret: gatewaySecret,
      destination: webhook.destination ?? "",
      events: webhook.events ?? [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Apps Script returned HTTP ${response.status}`);
  }

  const result = (await response.json()) as AppsScriptResponse;
  if (!result.ok) {
    throw new Error(
      `Apps Script rejected the webhook: ${result.code ?? "UNKNOWN_ERROR"}`,
    );
  }
  return result;
}

async function sendLineReply(
  reply: AppsScriptReply,
  channelAccessToken: string,
): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      authorization: `Bearer ${channelAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      replyToken: reply.reply_token,
      messages: reply.messages,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`LINE reply failed: HTTP ${response.status} ${body}`);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const environment = readEnvironment();

    if (request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "manage-elect-line-webhook",
        request_id: requestId,
        configured: {
          line_channel_secret: Boolean(environment.channelSecret),
          line_channel_access_token: Boolean(environment.channelAccessToken),
          apps_script_web_app_url: Boolean(environment.appsScriptUrl),
          line_gateway_secret: Boolean(environment.gatewaySecret),
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { ok: false, request_id: requestId, code: "METHOD_NOT_ALLOWED" },
        405,
      );
    }

    if (!environment.channelSecret) {
      return jsonResponse(
        { ok: false, request_id: requestId, code: "SECRET_NOT_CONFIGURED" },
        500,
      );
    }

    const signature = request.headers.get("x-line-signature");
    if (!signature) {
      return jsonResponse(
        { ok: false, request_id: requestId, code: "MISSING_SIGNATURE" },
        401,
      );
    }

    const rawBody = await request.text();
    if (!(await verifyLineSignature(rawBody, signature, environment.channelSecret))) {
      return jsonResponse(
        { ok: false, request_id: requestId, code: "INVALID_SIGNATURE" },
        401,
      );
    }

    const webhook = parseWebhook(rawBody);
    if (!webhook || !Array.isArray(webhook.events)) {
      return jsonResponse(
        { ok: false, request_id: requestId, code: "INVALID_WEBHOOK" },
        400,
      );
    }

    // LINE's Verify action sends an authenticated webhook with no events.
    if (webhook.events.length === 0) {
      return jsonResponse({ ok: true, request_id: requestId, events: 0 });
    }

    if (!environment.appsScriptUrl || !environment.gatewaySecret) {
      return jsonResponse(
        { ok: false, request_id: requestId, code: "GATEWAY_NOT_CONFIGURED" },
        500,
      );
    }

    try {
      const appsScriptResult = await forwardToAppsScript(
        webhook,
        environment.appsScriptUrl,
        environment.gatewaySecret,
      );
      const replies = normalizeReplies(appsScriptResult.replies);

      if (replies.length > 0 && !environment.channelAccessToken) {
        return jsonResponse(
          { ok: false, request_id: requestId, code: "REPLY_TOKEN_NOT_CONFIGURED" },
          500,
        );
      }

      await Promise.all(
        replies.map((reply) =>
          sendLineReply(reply, environment.channelAccessToken)
        ),
      );

      return jsonResponse({
        ok: true,
        request_id: requestId,
        events: webhook.events.length,
        replies: replies.length,
      });
    } catch (error) {
      console.error(JSON.stringify({
        request_id: requestId,
        code: "UPSTREAM_ERROR",
        message: error instanceof Error ? error.message : String(error),
      }));
      return jsonResponse(
        { ok: false, request_id: requestId, code: "UPSTREAM_ERROR" },
        502,
      );
    }
  },
};
