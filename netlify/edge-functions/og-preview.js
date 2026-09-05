export default async (request, context) => {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") || "";

  // Проверяем, зашел ли бот соцсети
  const isBot = /TelegramBot|Twitterbot|facebookexternalhit|vkShare|WhatsApp|LinkedInBot|Discordbot/i.test(userAgent);

  if (!isBot) {
    return context.next();
  }

  const postId = url.searchParams.get("id");
  if (!postId) {
    return context.next();
  }

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/takean/databases/(default)/documents/posts/${postId}`;
    const res = await fetch(firestoreUrl);

    if (!res.ok) return context.next();

    const data = await res.json();
    const fields = data.fields || {};

    const title = fields.title?.stringValue || "Пост на Takean";
    const description = fields.description?.stringValue || fields.text?.stringValue || "Смотрите подробнее на Takean";
    const image = fields.image?.stringValue || fields.imageUrl?.stringValue || "";

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  ${image ? `<meta property="og:image" content="${image}" />` : ''}
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url.href}" />
</head>
<body></body>
</html>`;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    return context.next();
  }
};
