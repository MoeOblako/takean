import { Context } from "@netlify/edge-functions";

const FIREBASE_PROJECT_ID = "takean";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const BOT_AGENTS = [
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "vkshare",
  "yandexbot",
  "googlebot",
  "bingbot",
  "applebot",
  "slackbot",
  "skypeuripreview"
];

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();

  // Извлекаем shortId из URL (поддерживает варианты /abc123xyz, /post/abc123xyz, /t/abc123xyz)
  const pathParts = url.pathname.split("/").filter(Boolean);
  let shortId = url.searchParams.get("id");

  if (!shortId && pathParts.length > 0) {
    shortId = pathParts[pathParts.length - 1];
  }

  const isBot = BOT_AGENTS.some((bot) => userAgent.includes(bot));
  if (!shortId || !isBot) {
    return context.next();
  }

  try {
    const queryUrl = `${FIRESTORE_URL}:runQuery`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: "posts" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "shortId" },
            op: "EQUAL",
            value: { stringValue: shortId }
          }
        },
        limit: 1
      }
    };

    const fsResponse = await fetch(queryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(queryBody)
    });

    if (!fsResponse.ok) {
      return context.next();
    }

    const fsData = await fsResponse.json();

    if (!fsData || !fsData[0] || !fsData[0].document) {
      return context.next();
    }

    const fields = fsData[0].document.fields || {};

    const title = fields.title?.stringValue || "Takean - Тейк";
    const rawContent = fields.content?.stringValue || "Читайте тейк на платформе Takean";
    
    const cleanDescription = rawContent
      .replace(/\[.*?\]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200);

    let imageUrl = "https://takean.cl.is/og-image.png";
    if (fields.images && fields.images.arrayValue && fields.images.arrayValue.values) {
      const firstImg = fields.images.arrayValue.values[0]?.stringValue;
      if (firstImg) imageUrl = firstImg;
    }

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>${escapeXml(title)} | Takean</title>
    <meta property="og:site_name" content="Takean">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeXml(title)}">
    <meta property="og:description" content="${escapeXml(cleanDescription)}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:url" content="${url.href}">
    
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeXml(title)}">
    <meta name="twitter:description" content="${escapeXml(cleanDescription)}">
    <meta name="twitter:image" content="${imageUrl}">
</head>
<body>
    <h1>${escapeXml(title)}</h1>
    <p>${escapeXml(cleanDescription)}</p>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=600"
      }
    });

  } catch (error) {
    console.error("Edge function error:", error);
    return context.next();
  }
};

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const config = {
  path: ["/*", "/post/*", "/t/*"],
};
