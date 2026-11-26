import type { FastifyReply } from "fastify";

export const SUBSONIC_API_VERSION = "1.16.1";
export const SUBSONIC_XMLNS = "http://subsonic.org/restapi";

export type SubsonicFormat = "xml" | "json" | "jsonp";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Serializes a Subsonic response object into standard Subsonic XML.
 * - Primitive properties become XML attributes (except `value`, which becomes inner text
 *   for elements like `<genre>`, `<lyrics>`, and `<line>`).
 * - Objects and arrays become child XML elements.
 */
function serializeXmlNode(tagName: string, data: unknown): string {
  if (data === null || data === undefined) {
    return "";
  }
  if (isPrimitive(data)) {
    return `<${tagName}>${escapeXml(String(data))}</${tagName}>`;
  }
  if (Array.isArray(data)) {
    return data.map((item) => serializeXmlNode(tagName, item)).join("");
  }

  const obj = data as Record<string, unknown>;
  const attrs: string[] = [];
  const children: string[] = [];
  let textContent: string | null = null;

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (key === "value" && isPrimitive(val)) {
      textContent = escapeXml(String(val));
    } else if (isPrimitive(val)) {
      attrs.push(`${key}="${escapeXml(String(val))}"`);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        children.push(serializeXmlNode(key, item));
      }
    } else if (typeof val === "object") {
      children.push(serializeXmlNode(key, val));
    }
  }

  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  if (children.length === 0 && textContent === null) {
    return `<${tagName}${attrStr}/>`;
  }
  return `<${tagName}${attrStr}>${textContent ?? ""}${children.join("")}</${tagName}>`;
}

export function resolveSubsonicFormat(raw: string | undefined): SubsonicFormat {
  const f = (raw ?? "xml").trim().toLowerCase();
  if (f === "json") return "json";
  if (f === "jsonp") return "jsonp";
  return "xml";
}

export function sendSubsonicOk(
  reply: FastifyReply,
  format: SubsonicFormat,
  serverVersion: string,
  payload: Record<string, unknown> = {},
  callback?: string,
) {
  const envelope: Record<string, unknown> = {
    status: "ok",
    version: SUBSONIC_API_VERSION,
    type: "MusicOrbit",
    serverVersion,
    openSubsonic: true,
    ...payload,
  };

  if (format === "json") {
    return reply
      .code(200)
      .header("Content-Type", "application/json; charset=utf-8")
      .send({ "subsonic-response": envelope });
  }

  if (format === "jsonp") {
    const safeCb = callback && /^[a-zA-Z0-9_.$]+$/.test(callback) ? callback : "callback";
    return reply
      .code(200)
      .header("Content-Type", "application/javascript; charset=utf-8")
      .send(`${safeCb}(${JSON.stringify({ "subsonic-response": envelope })});`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${serializeXmlNode("subsonic-response", {
    xmlns: SUBSONIC_XMLNS,
    ...envelope,
  })}`;
  return reply.code(200).header("Content-Type", "application/xml; charset=utf-8").send(xml);
}

export function sendSubsonicError(
  reply: FastifyReply,
  format: SubsonicFormat,
  serverVersion: string,
  code: number,
  message: string,
  callback?: string,
) {
  const envelope: Record<string, unknown> = {
    status: "failed",
    version: SUBSONIC_API_VERSION,
    type: "MusicOrbit",
    serverVersion,
    openSubsonic: true,
    error: { code, message },
  };

  if (format === "json") {
    return reply
      .code(200)
      .header("Content-Type", "application/json; charset=utf-8")
      .send({ "subsonic-response": envelope });
  }

  if (format === "jsonp") {
    const safeCb = callback && /^[a-zA-Z0-9_.$]+$/.test(callback) ? callback : "callback";
    return reply
      .code(200)
      .header("Content-Type", "application/javascript; charset=utf-8")
      .send(`${safeCb}(${JSON.stringify({ "subsonic-response": envelope })});`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${serializeXmlNode("subsonic-response", {
    xmlns: SUBSONIC_XMLNS,
    ...envelope,
  })}`;
  return reply.code(200).header("Content-Type", "application/xml; charset=utf-8").send(xml);
}
