const FIREBASE_PROJECT_ID = "takean";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const BOT_REGEX = /telegrambot|twitterbot|facebookexternalhit|whatsapp|discordbot|vkshare|linkedinbot|yandexbot|googlebot|bingbot|applebot|slackbot|skypeuripreview/i;

export default async (request, context) => {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") || "";

  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff|woff2|ttf)$/i)) {
    return context.next();
  }

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

  if (!postId || !isBot) {
    return context.next();
  }

  try {
    let fields = null;

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

    if (!fields) {
      const queryUrl = `${FIRESTORE_URL}:runQuery`;
      
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

    if (!fields) {
      return context.next();
    }

    const title = fields.title?.stringValue || "Takean";

    const rawContent = 
      fields.content?.stringValue || 
      fields.text?.stringValue || 
      fields.description?.stringValue || 
      fields.body?.stringValue || 
      "";

    let imageUrl = "";

    if (rawContent.includes("[img]")) {
      const match = rawContent.match(/\[img\]\s*(.*?)\s*\[\/img\]/i);
      if (match && match[1]) imageUrl = match[1];
    }

    if (!imageUrl && fields.images?.arrayValue?.values?.length > 0) {
      const firstImg = fields.images.arrayValue.values[0];
      imageUrl = firstImg.stringValue || firstImg.mapValue?.fields?.url?.stringValue || "";
    }

    if (!imageUrl) {
      imageUrl = 
        fields.coverURL?.stringValue || 
        fields.cover?.stringValue || 
        fields.photoURL?.stringValue || 
        fields.imageUrl?.stringValue || 
        fields.image?.stringValue || 
        "";
    }

    if (imageUrl) {
      if (imageUrl.startsWith("//")) imageUrl = "https:" + imageUrl;
      else if (!imageUrl.startsWith("http")) imageUrl = "https://" + imageUrl;
    } else {
      imageUrl = "https://takean.cl.is/og-image.png";
    }

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

function escapeXml(unsafe) {
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
