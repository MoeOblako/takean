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

  // 1. Извлекаем ID (сначала проверяем ?id=, затем конец пути /post/ID)
  let postId = url.searchParams.get("id");
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (!postId && pathParts.length > 0) {
    postId = pathParts[pathParts.length - 1];
  }

  const isBot = BOT_AGENTS.some((bot) => userAgent.includes(bot));
  if (!postId || !isBot) {
    return context.next();
  }

  try {
    let fields: Record<string, any> | null = null;

    // 2. Если ID длинный (например, UquVT7t5t0ieUxgoIQol) — делаем прямой запрос по Document ID
    if (postId.length > 15) {
      const docUrl = `${FIRESTORE_URL}/posts/${postId}`;
      const fsResponse = await fetch(docUrl);
      if (fsResponse.ok) {
        const docData = await fsResponse.json();
        fields = docData.fields || {};
      }
    }

    // 3. Если по Direct ID не нашлось или это короткий shortId — ищем через runQuery
    if (!fields) {
      const queryUrl = `${FIRESTORE_URL}:runQuery`;
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: "posts" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "shortId" },
              op: "EQUAL",
              value: { stringValue: postId }
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

      if (fsResponse.ok) {
        const fsData = await fsResponse.json();
        if (fsData && fsData[0] && fsData[0].document) {
          fields = fsData[0].document.fields || {};
        }
      }
    }

    // Если пост не найден в базе, отдаём стандартную страницу
    if (!fields) {
      return context.next();
    }

    // 4. Формируем данные
    const title = fields.title?.stringValue || "Takean - Тейк";
    const rawContent = fields.content?.stringValue || fields.text?.stringValue || "Читайте тейк на платформе Takean";
    
    // Очищаем BB-коды [b], [img] и т.д.
    const cleanDescription = rawContent
      .replace(/\[.*?\]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200);

    // Достаём обложку/первую картинку
    let imageUrl = "https://takean.cl.is/og-image.png";
    if (fields.images && fields.images.arrayValue && fields.images.arrayValue.values) {
      const firstImg = fields.images.arrayValue.values[0]?.stringValue;
      if (firstImg) imageUrl = firstImg;
    } else if (fields.photoURL?.stringValue) {
      imageUrl = fields.photoURL.stringValue;
    }

    // 5. Отдаём HTML для бота
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
  path: ["/*", "/post.html", "/post/*", "/t/*"],
};
                  
