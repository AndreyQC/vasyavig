import {CSP_POLICY} from "../../htmlCsp";

/**
 * Email-шаблон письма (Phase 8.4, §6.2 п. 2): 600px, табличная вёрстка,
 * inline CSS. Тело приходит из renderEmailBody (детерминированное, уже
 * санитизированное); тема и preheader — от модели или fallback.
 *
 * Preheader — скрытый текст сразу после body: почтовые клиенты показывают
 * его в списке писем рядом с темой.
 */

export interface EmailTemplateInput {
  subject: string;
  preheader: string;
  /** Тело из renderEmailBody (innerHTML 600px-ячейки). */
  bodyHtml: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BODY_CELL_STYLE =
  "background:#ffffff;padding:24px 32px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222222;";

/** Собрать полный HTML письма. */
export function buildEmailHtml(input: EmailTemplateInput): string {
  const subject = escapeHtml(input.subject);
  const preheader = escapeHtml(input.preheader);
  return [
    "<!DOCTYPE html>",
    '<html>',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">`,
    `<title>${subject}</title>`,
    "</head>",
    `<body style="margin:0;padding:0;background:#f4f4f5;-webkit-text-size-adjust:100%;">`,
    input.preheader !== ""
      ? `<div style="display:none;max-height:0;overflow:hidden;visibility:hidden;">${preheader}</div>`
      : "",
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;background:#f4f4f5;">',
    "<tr>",
    '<td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:600px;max-width:100%;background:#ffffff;">',
    "<tr>",
    `<td style="${BODY_CELL_STYLE}">`,
    input.bodyHtml,
    "</td>",
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}
