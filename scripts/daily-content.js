// Grade My Finance — Daily Content Engine
// Reads existing posts, generates N new articles via the Claude API (with
// web search for fact-checking), and either publishes them (writing the
// blog post, manifest, sitemap, and blog index entries) or — if a claim
// can't be verified — drops a draft into /queue for manual review.
//
// Runs inside GitHub Actions. Requires ANTHROPIC_API_KEY as an env var.

const fs = require('fs');
const path = require('path');
const { publishArticlesToPinterest } = require('./pinterest');

const ROOT = path.join(__dirname, '..');
const ARTICLES_PER_DAY = parseInt(process.env.ARTICLES_PER_DAY || '2', 10);
const MODEL = 'claude-sonnet-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY env var. Aborting.');
  process.exit(1);
}

// ---------- Load existing manifest ----------

function loadManifest() {
  const raw = fs.readFileSync(
    path.join(ROOT, 'posts-manifest.js'),
    'utf8'
  );

  const match = raw.match(
    /var GMF_BLOG_POSTS = (\[[\s\S]*?\]);/
  );

  if (!match) {
    throw new Error('Could not parse posts-manifest.js');
  }

  // The array is our own repository file, not external input.
  // eslint-disable-next-line no-eval
  const posts = eval(match[1]);

  return {
    raw,
    posts,
    arrayLiteral: match[1]
  };
}

// ---------- Call the Anthropic API ----------

async function callClaude(promptText) {
  const res = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: promptText
          }
        ],
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search'
          }
        ]
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Anthropic API error ${res.status}: ${text}`
    );
  }

  const data = await res.json();

  const textBlocks = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '');

  return textBlocks.join('\n');
}

// ---------- Robust JSON extraction ----------
//
// Claude occasionally returns literal newlines, tabs, or other
// control characters inside JSON strings, especially inside bodyHtml.
// Normal JSON.parse() rejects those with:
//
// "Bad control character in string literal in JSON"
//
// This function fixes those characters before parsing.

function extractJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Claude returned an empty response.');
  }

  // Remove markdown fences if Claude added them.
  const cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(
      'Claude response did not contain a JSON object.'
    );
  }

  const candidate = cleaned.slice(
    firstBrace,
    lastBrace + 1
  );

  let insideString = false;
  let escaped = false;
  let fixed = '';

  for (const char of candidate) {
    if (insideString) {
      if (escaped) {
        fixed += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        fixed += char;
        escaped = true;
        continue;
      }

      if (char === '"') {
        fixed += char;
        insideString = false;
        continue;
      }

      // Fix literal control characters inside JSON strings.
      if (char === '\n') {
        fixed += '\\n';
        continue;
      }

      if (char === '\r') {
        fixed += '\\r';
        continue;
      }

      if (char === '\t') {
        fixed += '\\t';
        continue;
      }

      fixed += char;
      continue;
    }

    if (char === '"') {
      insideString = true;
    }

    fixed += char;
  }

  try {
    return JSON.parse(fixed);
  } catch (err) {
    throw new Error(
      `Invalid Claude JSON after cleanup: ${err.message}`
    );
  }
}

// ---------- Build the article prompt ----------

function buildPrompt(existingPosts) {
  const existingList = existingPosts
    .map(
      (p) =>
        `- [${p.category}] ${p.title} (slug: ${p.slug})`
    )
    .join('\n');

  return `You are writing one original blog article for grademyfinance.com, a plain-spoken personal finance site. Brand voice: practical, no fluff, no hype, no fake urgency. Reading level: clear and direct, short paragraphs, concrete numbers over vague advice.

Here is every article already published on the site (do NOT duplicate any of these topics):
${existingList}

TASK:

1. Pick ONE topic not already covered above that would genuinely help a reader improve their financial grade or understanding.
2. If the article involves any claim about tax brackets, IRS rules, contribution limits, interest rates, or other current/time-sensitive facts, use web search to verify the current figures against official/authoritative sources (irs.gov, consumerfinance.gov, federalreserve.gov, etc.) before writing.
3. Write the full article.

RULES:

- No fake statistics, no fake studies, no fake testimonials, no invented sources.
- If you cannot confidently verify a time-sensitive claim central to the article, set "verified": false and explain why in "verificationNotes" — do not guess.
- Every claim in "sourcesUsed" must be a real source you actually found via search, with a real URL.
- Body content should be substantive — at least 500 words — organized with subheadings, using only these HTML tags: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a>. No inline styles, no <script>, no <iframe>, no <html>/<body> wrapper.
- Include a "Grade My Finance" mention naturally once in the body, encouraging the reader to check their financial grade, without being a hard sales pitch.
- Return valid JSON.
- Do not put markdown fences around the JSON.
- Do not include any text before or after the JSON.
- Do not use literal newline characters inside JSON string values. Keep bodyHtml as one JSON string. If you need spacing inside bodyHtml, use normal HTML tags.

Respond with ONLY a single JSON object, no other text, no markdown fences, matching exactly this shape:

{
  "slug": "kebab-case-slug",
  "title": "Article Title",
  "metaDescription": "One sentence, under 155 characters",
  "category": "One of: Budgeting, Debt, Savings, Investing, Retirement, Credit, Housing, Taxes, Insurance, Habits, Relationships, Advice, Income, Money Mindset, Net Worth, Financial Grade",
  "readTimeMinutes": 4,
  "bodyHtml": "<p>...full article HTML...</p>",
  "faqItems": [
    {"question": "...", "answer": "..."},
    {"question": "...", "answer": "..."}
  ],
  "containsTimeSensitiveClaims": true,
  "verified": true,
  "verificationNotes": "Brief note on what was checked and against what source, or why verification failed.",
  "sourcesUsed": [
    {"name": "Source name", "url": "https://example.com"}
  ]
}`;
}

// ---------- Templates ----------

const SITE_CSS = `:root{--bg:#0A0B0E;--surface:#14161C;--line:rgba(255,255,255,.09);--text:#F2F3F5;--muted:#8B92A0;--muted-2:#5D636F;--gold:#C9A227;--gold-soft:rgba(201,162,39,.14);--gold-bright:#E4C24E;--radius-lg:20px;--shadow:0 20px 50px rgba(0,0,0,.45);--font-display:'Space Grotesk',sans-serif;--font-body:'Inter',sans-serif;--font-mono:'IBM Plex Mono',monospace;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.6;-webkit-font-smoothing:antialiased;}
h1,h2,h3{font-family:var(--font-display);letter-spacing:-.01em;margin:0 0 .5em}
.container{max-width:760px;margin:0 auto;padding:0 22px}
a{color:var(--gold-bright)}
header.site{border-bottom:1px solid var(--line);background:rgba(10,11,14,.8);backdrop-filter:blur(10px);position:sticky;top:0;z-index:10}
.hdr-row{max-width:760px;margin:0 auto;padding:16px 22px;display:flex;align-items:center;gap:10px}
.seal{width:32px;height:32px;border-radius:8px;background:linear-gradient(155deg,var(--gold-bright),var(--gold));display:grid;place-items:center;flex:none}
.seal span{font-family:var(--font-mono);font-weight:700;font-size:11px;color:#1a1300}
.wordmark{font-weight:700;font-size:15.5px;color:var(--text);text-decoration:none}
.hdr-row a.wordmark{display:flex;align-items:center;gap:10px}
.btn{margin-left:auto;background:linear-gradient(155deg,var(--gold-bright),var(--gold));color:#1a1300;font-weight:700;padding:9px 16px;border-radius:9px;text-decoration:none;font-size:13.5px;white-space:nowrap}
main{padding:48px 0 70px}
.eyebrow{font-family:var(--font-mono);font-size:12px;color:var(--gold-bright);letter-spacing:.06em;text-transform:uppercase}
h1{font-size:clamp(26px,4vw,36px);margin-top:10px}
p.lede{color:var(--muted);font-size:16.5px;margin-top:14px}
.prose p,.prose li{font-size:15.5px;color:#D6D9DE}
.prose h2{font-size:21px;margin-top:38px}
table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.03em}
td.mono{font-weight:600}
.cta-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:24px;margin:32px 0;box-shadow:var(--shadow)}
.cta-card h3{margin-top:0;font-size:19px}
.cta-card p{color:var(--muted);font-size:14.5px}
.cta-btn{display:inline-block;background:linear-gradient(155deg,var(--gold-bright),var(--gold));color:#1a1300;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;margin-top:6px}
.faq-item{border-top:1px solid var(--line);padding:16px 0}
.faq-item summary{cursor:pointer;font-weight:600;font-size:15px;list-style:none}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item p{color:var(--muted);font-size:14.5px;margin-top:8px}
.related{margin-top:40px;padding-top:24px;border-top:1px solid var(--line)}
.related a{display:block;margin:6px 0;font-size:14.5px}
footer.site{border-top:1px solid var(--line);padding:26px 0;text-align:center;color:var(--muted-2);font-size:12.5px}
footer.site a{color:var(--muted)}`;

// ---------- HTML escaping ----------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Render article ----------

function renderPostHtml(article, relatedPosts) {
  const year = new Date().getFullYear();

  const faqHtml = article.faqItems
    .map(
      (f) =>
        `<div class="faq-item"><details><summary>${escapeHtml(
          f.question
        )}</summary><p>${escapeHtml(
          f.answer
        )}</p></details></div>`
    )
    .join('\n');

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: article.faqItems.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer
      }
    }))
  };

  const relatedHtml = relatedPosts.length
    ? `<div class="related"><span class="eyebrow">Related</span>${relatedPosts
        .map(
          (p) =>
            `<a href="${escapeHtml(
              p.slug
            )}.html">${escapeHtml(p.title)}</a>`
        )
        .join('')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(article.title)} | Grade My Finance</title>
<meta name="description" content="${escapeHtml(
    article.metaDescription
  )}">
<link rel="canonical" href="https://grademyfinance.com/blog/${escapeHtml(
    article.slug
  )}.html">
<style>${SITE_CSS}</style>
</head>
<body>

<header class="site">
<div class="hdr-row">
<a class="wordmark" href="https://grademyfinance.com/">
<span class="seal"><span>GMF</span></span>
Grade My Finance
</a>
<a class="btn" href="https://grademyfinance.com/">Check Your Grade</a>
</div>
</header>

<main>
<article class="container">

<div class="eyebrow">${escapeHtml(
    article.category
  )}</div>

<h1>${escapeHtml(article.title)}</h1>

<p class="lede">${escapeHtml(
    article.metaDescription
  )}</p>

<div class="prose">
${article.bodyHtml}
</div>

${
  article.faqItems.length
    ? `<section class="related">
<h2>Frequently Asked Questions</h2>
${faqHtml}
</section>`
    : ''
}

${relatedHtml}

</article>
</main>

<footer class="site">
<div class="container">
© ${year} Grade My Finance
</div>
</footer>

<script type="application/ld+json">${JSON.stringify(
    faqSchema
  )}</script>

</body>
</html>`;
}

// ---------- File updates ----------

function updateManifest(manifestState, article) {
  const newEntry =
    `  { slug:${JSON.stringify(
      article.slug
    )}, title:${JSON.stringify(
      article.title
    )}, category:${JSON.stringify(
      article.category
    )} }`;

  const updatedArray =
    manifestState.arrayLiteral.replace(
      /]$/,
      manifestState.posts.length
        ? `,\n${newEntry}\n]`
        : `\n${newEntry}\n]`
    );

  const updatedRaw =
    manifestState.raw.replace(
      manifestState.arrayLiteral,
      updatedArray
    );

  fs.writeFileSync(
    path.join(ROOT, 'posts-manifest.js'),
    updatedRaw
  );
}

function updateSitemap(article) {
  const sitemapPath = path.join(
    ROOT,
    'sitemap.xml'
  );

  const raw = fs.readFileSync(
    sitemapPath,
    'utf8'
  );

  const entry = `<url>
<loc>https://grademyfinance.com/blog/${article.slug}.html</loc>
<changefreq>monthly</changefreq>
<priority>0.7</priority>
</url>
`;

  const updated = raw.replace(
    '</urlset>',
    `${entry}</urlset>`
  );

  fs.writeFileSync(
    sitemapPath,
    updated
  );
}

function updateBlogIndex(article) {
  const indexPath = path.join(
    ROOT,
    'blog',
    'index.html'
  );

  const raw = fs.readFileSync(
    indexPath,
    'utf8'
  );

  const year = new Date().getFullYear();

  const entry = `    <li>
      <a class="title" href="${article.slug}.html">${escapeHtml(
    article.title
  )}</a>
      <p>${escapeHtml(
        article.metaDescription
      )}</p>
      <span class="meta">${year} · ${
    article.readTimeMinutes
  } min read</span>
    </li>
`;

  const marker =
    /(Latest posts<\/span>\s*)/i;

  if (!marker.test(raw)) {
    throw new Error(
      'Could not find blog index insertion point'
    );
  }

  const updated = raw.replace(
    marker,
    `$1\n${entry}`
  );

  fs.writeFileSync(
    indexPath,
    updated
  );
}

function writeQueueDraft(article, reason) {
  const queueDir = path.join(
    ROOT,
    'queue'
  );

  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, {
      recursive: true
    });
  }

  const queuePath = path.join(
    queueDir,
    `${
      article.slug ||
      'untitled-' + Date.now()
    }.json`
  );

  fs.writeFileSync(
    queuePath,
    JSON.stringify(
      {
        ...article,
        queuedAt:
          new Date().toISOString(),
        reason
      },
      null,
      2
    )
  );
}

// ---------- Main ----------

async function main() {
  const manifestState =
    loadManifest();

  const existingSlugs = new Set(
    manifestState.posts.map(
      (p) => p.slug
    )
  );

  const results = {
    published: [],
    queued: [],
    failed: []
  };

  const publishedArticles = [];

  for (
    let i = 0;
    i < ARTICLES_PER_DAY;
    i++
  ) {
    try {
      const prompt =
        buildPrompt(
          manifestState.posts
        );

      const rawResponse =
        await callClaude(prompt);

      const article =
        extractJson(rawResponse);

      // Basic validation
      const problems = [];

      if (
        !article.slug ||
        !/^[a-z0-9-]+$/.test(
          article.slug
        )
      ) {
        problems.push(
          'invalid slug'
        );
      }

      if (
        existingSlugs.has(
          article.slug
        )
      ) {
        problems.push(
          'duplicate slug'
        );
      }

      if (
        !article.bodyHtml ||
        article.bodyHtml.length < 1500
      ) {
        problems.push(
          'body too short'
        );
      }

      if (
        !article.title ||
        !article.metaDescription
      ) {
        problems.push(
          'missing title/meta'
        );
      }

      if (
        !Array.isArray(
          article.faqItems
        ) ||
        article.faqItems.length < 1
      ) {
        problems.push(
          'missing FAQ'
        );
      }

      if (
        article.containsTimeSensitiveClaims &&
        !article.verified
      ) {
        problems.push(
          'unverified time-sensitive claims'
        );
      }

      if (problems.length) {
        writeQueueDraft(
          article,
          problems.join('; ')
        );

        results.queued.push({
          slug: article.slug,
          reason:
            problems.join('; ')
        });

        continue;
      }

      const relatedPosts =
        manifestState.posts
          .filter(
            (p) =>
              p.category ===
              article.category
          )
          .slice(0, 2);

      const html =
        renderPostHtml(
          article,
          relatedPosts
        );

      fs.writeFileSync(
        path.join(
          ROOT,
          'blog',
          `${article.slug}.html`
        ),
        html
      );

      updateManifest(
        manifestState,
        article
      );

      // Refresh in-memory state so a second article
      // this run doesn't collide.
      manifestState.raw =
        fs.readFileSync(
          path.join(
            ROOT,
            'posts-manifest.js'
          ),
          'utf8'
        );

      const reload =
        loadManifest();

      manifestState.posts =
        reload.posts;

      manifestState.arrayLiteral =
        reload.arrayLiteral;

      existingSlugs.add(
        article.slug
      );

      updateSitemap(article);
      updateBlogIndex(article);

      results.published.push(
        article.slug
      );

      publishedArticles.push(
        article
      );
    } catch (err) {
      console.error(
        `Article ${i + 1} failed:`,
        err.message
      );

      results.failed.push(
        err.message
      );

      // One failure doesn't stop the run.
      continue;
    }
  }

  // ---------- Social distribution ----------

  let pinterestResults = {
    posted: [],
    failed: []
  };

  try {
    pinterestResults =
      await publishArticlesToPinterest(
        publishedArticles
      );
  } catch (err) {
    console.error(
      'Pinterest distribution failed:',
      err.message
    );

    pinterestResults = {
      posted: [],
      failed: [err.message]
    };
  }

  // ---------- Summary ----------

  console.log(
    '--- Daily Content Engine summary ---'
  );

  console.log(
    'Published:',
    results.published
  );

  console.log(
    'Queued for review:',
    results.queued
  );

  console.log(
    'Failed:',
    results.failed
  );

  console.log(
    'Pinterest posted:',
    pinterestResults.posted
  );

  console.log(
    'Pinterest failed:',
    pinterestResults.failed
  );
}

main().catch((err) => {
  console.error(
    'Fatal error in content engine:',
    err
  );

  process.exit(1);
});
