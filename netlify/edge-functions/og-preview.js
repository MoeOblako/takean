import { Context } from "@netlify/edge-functions";

const FIREBASE_PROJECT_ID = "takean";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Расширенный список ботов мессенджеров и соцсетей
const BOT_REGEX = /telegrambot|twitterbot|facebookexternalhit|whatsapp|discordbot|vkshare|linkedinbot|yandexbot|googlebot|bingbot|applebot|slackbot|skypeuripreview/i;

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") || "";

  // Пропускаем статику и запросы к ресурсам
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff|woff2|ttf)$/i)) {
    return context.next();
  }

  // 1. Извлекаем postId из query-параметра ?id= или из пути (/post/ID, /post.html?id=ID)
  let postId = url.searchParams.get("id");
  if (!postId) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart !== "post" && lastPart !== "post.html" && lastPart !== "post.htm") {
        postId = lastPart;
      }
    }
  }

  if (postId) {
    postId = postId.replace(/\.htm(l)?$/i, "").trim();
  }

  const isBot = BOT_REGEX.test(userAgent);

  // Если это не бот или нет ID, отдаем обычную страницу
  if (!postId || !isBot) {
    return context.next();
  }

  try {
    let fields: Record<string, any> | null = null;

    // 2. Попытка №1: Прямой запрос по Document ID (если ID длинее 15 символов)
    if (postId.length >= 15) {
      try {
        const docUrl = `${FIRESTORE_URL}/posts/${postId}`;
        const fsResponse = await fetch(docUrl);
        if (fsResponse.ok) {
          const docData = await fsResponse.json();
          fields = docData.fields || null;
        }
      } catch (e) {
        console.error("Direct fetch error:", e);
      }
    }

    // 3. Попытка №2: Поиск по shortId или id в Firestore
    if (!fields) {
      const queryUrl = `${FIRESTORE_URL}:runQuery`;
      
      // Ищем либо по shortId, либо по id
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: "posts" }],
          where: {
            compositeFilter: {
              op: "OR",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "shortId" },
                    op: "EQUAL",
                    value: { stringValue: postId }
                  }
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "id" },
                    op: "EQUAL",
                    value: { stringValue: postId }
                  }
                }
              ]
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
        if (Array.isArray(fsData) && fsData[0]?.document?.fields) {
          fields = fsData[0].document.fields;
        }
      }
    }

    // Если данные поста не найдены в Firestore, отдаем обычную страницу
    if (!fields) {
      return context.next();
    }

    // 4. Извлечение заголовка
    const title = fields.title?.stringValue || "Takean";

    // 5. Извлечение текста
    const rawContent = 
      fields.content?.stringValue || 
      fields.text?.stringValue || 
      fields.description?.stringValue || 
      fields.body?.stringValue || 
      "";

    // 6. Извлечение изображения
    let imageUrl = "";

    // Картинка из BB-кода [img]URL[/img]
    if (rawContent.includes("[img]")) {
      const match = rawContent.match(/\[img\]\s*(.*?)\s*\[\/img\]/i);
      if (match && match[1]) imageUrl = match[1];
    }

    // Массив images (берем элемент 0)
    if (!imageUrl && fields.images?.arrayValue?.values?.length > 0) {
      const firstImg = fields.images.arrayValue.values[0];
      imageUrl = firstImg.stringValue || firstImg.mapValue?.fields?.url?.stringValue || "";
    }

    // Одиночные поля
    if (!imageUrl) {
      imageUrl = 
        fields.coverURL?.stringValue || 
        fields.cover?.stringValue || 
        fields.photoURL?.stringValue || 
        fields.imageUrl?.stringValue || 
        fields.image?.stringValue || 
        "";
    }

    // Нормализация ссылок (гарантируем https://)
    if (imageUrl) {
      if (imageUrl.startsWith("//")) imageUrl = "https:" + imageUrl;
      else if (!imageUrl.startsWith("http")) imageUrl = "https://" + imageUrl;
    } else {
      // Стандартный баннер-логотип, если картинки у поста нет
      imageUrl = "https://takean.cl.is/og-image.png";
    }

    // 7. Формирование короткого описания (удаляем тэги и переносы)
    let cleanDescription = rawContent
      .replace(/\[img\].*?\[\/img\]/gi, "")
      .replace(/\[.*?\]/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/#+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanDescription) {
      cleanDescription = "Смотрите подробнее на Takean";
    } else if (cleanDescription.length > 180) {
      cleanDescription = cleanDescription.substring(0, 177) + "...";
    }

    // 8. HTML-ответ
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>${escapeXml(title)}</title>
    <meta name="description" content="${escapeXml(cleanDescription)}">

    <!-- Open Graph -->
    <meta property="og:site_name" content="Takean">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeXml(title)}">
    <meta property="og:description" content="${escapeXml(cleanDescription)}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:secure_url" content="${imageUrl}">
    <meta property="og:url" content="${url.href}">

    <!-- Twitter / Telegram Large Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeXml(title)}">
    <meta name="twitter:description" content="${escapeXml(cleanDescription)}">
    <meta name="twitter:image" content="${imageUrl}">
</head>
<body>
    <h1>${escapeXml(title)}</h1>
    <p>${escapeXml(cleanDescription)}</p>
    <img src="${imageUrl}" alt="Cover">
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300"
      }
    });

  } catch (err) {
    console.error("OG Generator Error:", err);
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
