// Grade My Finance — Pinterest publishing module
// Refreshes the long-lived Pinterest access token using the stored refresh
// token, finds (or falls back sensibly to) a board, and creates a Pin for
// each newly published article. Designed to fail soft: if anything here
// breaks, it logs and returns — it must never take down the blog-publishing
// run itself.

const APP_ID = process.env.PINTEREST_APP_ID;
const APP_SECRET = process.env.PINTEREST_APP_SECRET;
const REFRESH_TOKEN = process.env.PINTEREST_REFRESH_TOKEN;
const BOARD_ID_OVERRIDE = process.env.PINTEREST_BOARD_ID; // optional

const OG_IMAGE = 'https://grademyfinance.com/og-image.png';

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64');
}

async function getAccessToken() {
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinterest token refresh failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function pickBoard(accessToken) {
  if (BOARD_ID_OVERRIDE) return BOARD_ID_OVERRIDE;

  const res = await fetch('https://api.pinterest.com/v5/boards?page_size=25', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinterest board list failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  const boards = data.items || [];
  if (!boards.length) {
    throw new Error(
      'No Pinterest boards found on this account. Create at least one board (e.g. "Grade My Finance Blog") and re-run, or set PINTEREST_BOARD_ID.'
    );
  }
  const preferred = boards.find((b) => /grade ?my ?finance/i.test(b.name));
  const chosen = preferred || boards[0];
  console.log(`Pinterest: using board "${chosen.name}" (${chosen.id})`);
  return chosen.id;
}

async function createPin(accessToken, boardId, article) {
  const link = `https://grademyfinance.com/blog/${article.slug}.html?utm_source=pinterest&utm_medium=social&utm_campaign=blog_promotion&utm_content=${article.slug}`;

  const res = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      board_id: boardId,
      title: article.title.slice(0, 100),
      description: article.metaDescription.slice(0, 500),
      link,
      media_source: {
        source_type: 'image_url',
        url: OG_IMAGE,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinterest pin creation failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function publishArticlesToPinterest(articles) {
  const results = { posted: [], failed: [] };

  if (!APP_ID || !APP_SECRET || !REFRESH_TOKEN) {
    console.log('Pinterest: missing credentials, skipping social publish.');
    return results;
  }
  if (!articles.length) return results;

  try {
    const accessToken = await getAccessToken();
    const boardId = await pickBoard(accessToken);

    for (const article of articles) {
      try {
        const pin = await createPin(accessToken, boardId, article);
        console.log(`Pinterest: posted "${article.title}" -> pin ${pin.id}`);
        results.posted.push({ slug: article.slug, pinId: pin.id });
      } catch (err) {
        console.error(`Pinterest: failed to post "${article.slug}":`, err.message);
        results.failed.push({ slug: article.slug, reason: err.message });
      }
    }
  } catch (err) {
    // Token refresh or board lookup failed entirely — log and move on.
    console.error('Pinterest: setup failed, skipping all social posts this run:', err.message);
  }

  return results;
}

module.exports = { publishArticlesToPinterest };
