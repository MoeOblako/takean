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

  // 1. Извлекаем postId из ?id=, либо из пути (/post/ID, /post.html/ID и т.д.)
  let postId = url.searchParams.get("id");
  
  if (!postId) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      postId = pathParts[pathParts.length - 1];
    }
  }

  // Очищаем ID от возможных расширений .html, если они прилипли к концу ID
  if (postId) {
    postId = postId.replace(/\.html$/i, "");
  }

  const isBot = BOT_AGENTS.some((bot) => userAgent.includes(bot));
  if (!postId || !isBot) {
    return context.next();
  }

  try {
    let fields: Record<string, any> | null = null;

    // 2. Если ID длинный (Direct Document ID из Firestore)
    if (postId.length > 15) {
      const docUrl = `${FIRESTORE_URL}/posts/${postId}`;
      const fsResponse = await fetch(docUrl);
      if (fsResponse.ok) {
        const docData = await fsResponse.json();
        fields = docData.fields || {};
      }
    }

    // 3. Если по Direct ID не нашли или это shortId — делаем запрос по полю shortId
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

    if (!fields) {
      return context.next();
    }

    // 4. Заголовок
    const title = fields.title?.stringValue || "Takean - Тейк";

    // 5. Текст (проверяем все популярные имена полей в Firestore)
    const rawContent = 
      fields.content?.stringValue || 
      fields.text?.stringValue || 
      fields.description?.stringValue || 
      fields.body?.stringValue || 
      "";

    // Вырезаем BB-коды, маркдаун, лишние пробелы и переносы
    let cleanDescription = rawContent
      .replace(/\[.*?\]/g, "")           // [img]https://...[/img] или [b]text[/b]
      .replace(/!\[.*?\]\(.*?\)/g, "")   // Markdown картинки
      .replace(/#+/g, "")                // H1, H2 заголовки
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanDescription) {
      cleanDescription = "Читайте тейк на платформе Takean";
    } else if (cleanDescription.length > 250) {
      cleanDescription = cleanDescription.substring(0, 247) + "...";
    }

    // 6. Поиск обложки / изображения для баннера
    let imageUrl = "";

    // Сначала смотрим массив images
    if (fields.images?.arrayValue?.values?.length > 0) {
      imageUrl = fields.images.arrayValue.values[0]?.stringValue || "";
    } 
    // Если массива нет, ищем одиночные поля
    if (!imageUrl) {
      imageUrl = 
        fields.coverURL?.stringValue || 
        fields.cover?.stringValue || 
        fields.photoURL?.stringValue || 
        fields.imageUrl?.stringValue || 
        fields.image?.stringValue || 
        "";
    }

    // Вспомогательный поиск картинки прямо из BB-кодов [img]URL[/img], если поля были пустыми
    if (!imageUrl && rawContent.includes("[img]")) {
      const match = rawContent.match(/\[img\](.*?)\[\/img\]/i);
      if (match && match[1]) imageUrl = match[1].trim();
    }

    // Fallback дефолтная картинка
    if (!imageUrl) {
      imageUrl = "https://takean.cl.is/og-image.png";
    }

    // 7. Генерация HTML с метатегами
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>${escapeXml(title)} | Takean</title>
    
    <!-- Open Graph (Telegram, VK, Facebook) -->
    <meta property="og:site_name" content="Takean">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeXml(title)}">
    <meta property="og:description" content="${escapeXml(cleanDescription)}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:secure_url" content="${imageUrl}">
    <meta property="og:url" content="${url.href}">

    <!-- Twitter / Telegram Large Banner -->
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
  path: ["/*"],
};
               
