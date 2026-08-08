// Grade My Finance — Daily Content Engine
//
// Reads existing posts, generates N new articles via the Claude API
// with web search for fact-checking, and either publishes them or
// places them into /queue for manual review.
//
// Runs inside GitHub Actions.
// Requires ANTHROPIC_API_KEY as an env var.

const fs = require('fs');
const path = require('path');
const { publishArticlesToPinterest } = require('./pinterest');

const ROOT = path.join(__dirname, '..');
const ARTICLES_PER_DAY = parseInt(
  process.env.ARTICLES_PER_DAY || '2',
  10
);

const MODEL = 'claude-sonnet-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY env var. Aborting.');
  process.exit(1);
}

// ============================================================
// Load existing manifest
// ============================================================

function loadManifest() {
  const manifestPath = path.join(ROOT, 'posts-manifest.js');
  const raw = fs.readFileSync(manifestPath, 'utf8');

  const match = raw.match(
    /var\s+GMF_BLOG_POSTS\s*=\s*(\[[\s\S]*?\]);/
  );

  if (!match) {
    throw new Error('Could not parse posts-manifest.js');
  }

  // This is our own repository file, not external input.
  // eslint-disable-next-line no-eval
  const posts = eval(match[1]);

  return {
    raw,
    posts,
    arrayLiteral: match[1]
  };
}

// ============================================================
// Call Claude API
// ============================================================

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
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '');

  if (!textBlocks.length) {
    throw new Error('Claude returned no text content.');
  }

  return textBlocks.join('\n');
}

// ============================================================
// Robust JSON extraction
//
// Claude occasionally returns:
// - markdown fences
// - explanatory text before JSON
// - literal newlines inside JSON strings
// - tabs/control characters inside HTML
//
// This parser handles those cases instead of letting JSON.parse()
// kill the entire article.
// ============================================================

function stripMarkdownFences(text) {
  return String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function findJsonObject(text) {
  const start = text.indexOf('{');

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (insideString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        insideString = false;
      }

      continue;
    }

    if (char === '"') {
      insideString = true;
      continue;
    }

    if (char === '{') {
      depth++;
      continue;
    }

    if (char === '}') {
      depth--;

      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

// Escape literal control characters that appear INSIDE JSON
// strings. This is the specific fix for:
//
// "Bad control character in string literal in JSON"
//
function sanitizeJsonControlCharacters(jsonText) {
  let result = '';
  let insideString = false;
  let escaped = false;

  for (let i = 0; i < jsonText.length; i++) {
    const char = jsonText[i];
    const code = char.charCodeAt(0);

    if (insideString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        result += char;
        escaped = true;
        continue;
      }

      if (char === '"') {
        result += char;
        insideString = false;
        continue;
      }

      // Literal newline inside JSON string
      if (char === '\n') {
        result += '\\n';
        continue;
      }

      // Literal carriage return
      if (char === '\r') {
        result += '\\r';
        continue;
      }

      // Literal tab
      if (char === '\t') {
        result += '\\t';
        continue;
      }

      // Other ASCII control characters
      if (code < 0x20) {
        result += '\\u' + code
          .toString(16)
          .padStart(4, '0');
        continue;
      }

      result += char;
      continue;
    }

    if (char === '"') {
      insideString = true;
    }

    result += char;
  }

  return result;
}

function extractJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Claude returned an empty response.');
  }

  const cleaned = stripMarkdownFences(rawText);

  const candidate = findJsonObject(cleaned);

  if (!candidate) {
    console.error(
      'Claude response did not contain a JSON object.'
    );

    console.error(
      'Response preview:',
      cleaned.slice(0, 1000)
    );

    throw new Error(
      'Could not find JSON object in Claude response.'
    );
  }

  // First attempt: normal JSON parsing.
  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    // Second attempt: repair literal control characters.
    const repaired = sanitizeJsonControlCharacters(candidate);

    try {
      return JSON.parse(repaired);
    } catch (secondError) {
      console.error(
        'JSON parsing failed after repair.'
      );

      console.error(
        'Original JSON error:',
        firstError.message
      );

      console.error(
        'Repaired JSON error:',
        secondError.message
      );

      console.error(
        'Candidate preview:',
        candidate.slice(0, 2000)
      );

      throw new Error(
        `Invalid Claude JSON: ${secondError.message}`
      );
    }
  }
}

// ============================================================
// Build article prompt
// ============================================================

function buildPrompt(existingPosts) {
  const existingList = existingPosts
    .map(
      (p) =>
        `- [${p.category}] ${p.title} (slug: ${p.slug})`
    )
    .join('\n');

  return `
You are writing one original blog article for grademyfinance.com, a plain-spoken personal finance site.

Brand voice:
- Practical
- No fluff
- No hype
- No fake urgency
- Clear and direct
- Short paragraphs
- Concrete numbers over vague advice

Here is every article already published on the site.
Do NOT duplicate these topics:

${existingList}

TASK:

1. Pick ONE useful topic not already covered above.
2. The topic should genuinely help a reader improve their financial grade or understanding.
3. If the article involves tax brackets, IRS rules, contribution limits, interest rates, housing rules, Social Security rules, credit rules, or other current/time-sensitive facts, use web search to verify the current figures against official or authoritative sources.
4. Write the full article.

IMPORTANT JSON RULES:

You MUST return valid JSON.

Inside every JSON string:
- NEVER use literal line breaks.
- NEVER use literal tab characters.
- Escape quotation marks properly.
- Use \\n if a line break is absolutely necessary.
- Do not put markdown fences around the JSON.
- Do not include any explanation before or after the JSON.

RULES:

- No fake statistics.
- No fake studies.
- No fake testimonials.
- No invented sources.
- If you cannot confidently verify a time-sensitive claim central to the article, set "verified": false and explain why in "verificationNotes".
- Do not guess current figures.
- Every claim in "sourcesUsed" must be a real source you actually found via search, with a real URL.
- Body content must be substantive — at least 500 words.
- Use subheadings.
- bodyHtml may ONLY use these HTML tags:
  <p>
  <h2>
  <h3>
  <ul>
  <ol>
  <li>
  <strong>
  <em>
  <a>

- No inline styles.
- No scripts.
- No iframe.
- No full HTML document wrapper.
- Include a natural mention of "Grade My Finance" once in the body.
- Encourage the reader to check their financial grade without using a hard sales pitch.

Return ONLY this JSON object:

{
  "slug": "kebab-case-slug",
  "title": "Article Title",
  "metaDescription": "One sentence, under 155 characters",
  "category": "One of: Budgeting, Debt, Savings, Investing, Retirement, Credit, Housing, Taxes, Insurance, Habits, Relationships, Advice, Income, Money Mindset, Net Worth, Financial Grade",
  "readTimeMinutes": 4,
  "bodyHtml": "<p>...</p><h2>...</h2><p>...</p>",
  "faqItems": [
    {
      "question": "...",
      "answer": "..."
    },
    {
      "question": "...",
      "answer": "..."
    }
  ],
  "containsTimeSensitiveClaims": true,
  "verified": true,
  "verificationNotes": "Brief note on what was checked and against what source, or why verification failed.",
  "sourcesUsed": [
    {
      "name": "Source name",
      "url": "https://example.com"
    }
  ]
}
`;
}

// ============================================================
// Site CSS
// ============================================================

const SITE_CSS = `
:root{
  --bg:#0A0B0E;
  --surface:#14161C;
  --line:rgba(255,255,255,.09);
  --text:#F2F3F5;
  --muted:#8B92A0;
  --muted-2:#5D636F;
  --gold:#C9A227;
  --gold-soft:rgba(201,162,39,.14);
  --gold-bright:#E4C24E;
  --radius-lg:20px;
  --shadow:0 20px 50px rgba(0,0,0,.45);
  --font-display:'Space Grotesk',sans-serif;
  --font-body:'Inter',sans-serif;
  --font-mono:'IBM Plex Mono',monospace;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:var(--bg);
  color:var(--text);
  font-family:var(--font-body);
  line-height:1.6;
  -webkit-font-smoothing:antialiased;
}

h1,h2,h3{
  font-family:var(--font-display);
  letter-spacing:-.01em;
  margin:0 0 .5em;
}

.container{
  max-width:760px;
  margin:0 auto;
  padding:0 22px;
}

a{
  color:var(--gold-bright);
}

header.site{
  border-bottom:1px solid var(--line);
  background:rgba(10,11,14,.8);
  backdrop-filter:blur(10px);
  position:sticky;
  top:0;
  z-index:10;
}

.hdr-row{
  max-width:760px;
  margin:0 auto;
  padding:16px 22px;
  display:flex;
  align-items:center;
  gap:10px;
}

.seal{
  width:32px;
  height:32px;
  border-radius:8px;
  background:linear-gradient(155deg,var(--gold-bright),var(--gold));
  display:grid;
  place-items:center;
  flex:none;
}

.seal span{
  font-family:var(--font-mono);
  font-weight:700;
  font-size:11px;
  color:#1a1300;
}

.wordmark{
  font-weight:700;
  font-size:15.5px;
  color:var(--text);
  text-decoration:none;
}

.hdr-row a.wordmark{
  display:flex;
  align-items:center;
  gap:10px;
}

.btn{
  margin-left:auto;
  background:linear-gradient(155deg,var(--gold-bright),var(--gold));
  color:#1a1300;
  font-weight:700;
  padding:9px 16px;
  border-radius:9px;
  text-decoration:none;
  font-size:13.5px;
  white-space:nowrap;
}

main{
  padding:48px 0 70px;
}

.eyebrow{
  font-family:var(--font-mono);
  font-size:12px;
  color:var(--gold-bright);
  letter-spacing:.06em;
  text-transform:uppercase;
}

h1{
  font-size:clamp(26px,4vw,36px);
  margin-top:10px;
}

p.lede{
  color:var(--muted);
  font-size:16.5px;
  margin-top:14px;
}

.prose p,
.prose li{
  font-size:15.5px;
  color:#D6D9DE;
}

.prose h2{
  font-size:21px;
  margin-top:38px;
}

.prose h3{
  font-size:18px;
  margin-top:28px;
}

table{
  width:100%;
  border-collapse:collapse;
  margin:18px 0;
  font-size:14px;
}

th,td{
  text-align:left;
  padding:10px 12px;
  border-bottom:1px solid var(--line);
}

th{
  color:var(--muted);
  font-weight:600;
  font-size:12.5px;
  text-transform:uppercase;
  letter-spacing:.03em;
}

.cta-card{
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:var(--radius-lg);
  padding:24px;
  margin:32px 0;
  box-shadow:var(--shadow);
}

.cta-card h3{
  margin-top:0;
  font-size:19px;
}

.cta-card p{
  color:var(--muted);
  font-size:14.5px;
}

.cta-btn{
  display:inline-block;
  background:linear-gradient(155deg,var(--gold-bright),var(--gold));
  color:#1a1300;
  font-weight:700;
  padding:12px 20px;
  border-radius:10px;
  text-decoration:none;
  margin-top:6px;
}

.faq-item{
  border-top:1px solid var(--line);
  padding:16px 0;
}

.faq-item summary{
  cursor:pointer;
  font-weight:600;
  font-size:15px;
  list-style:none;
}

.faq-item summary::-webkit-details-marker{
  display:none;
}

.faq-item p{
  color:var(--muted);
  font-size:14.5px;
  margin-top:8px;
}

.related{
  margin-top:40px;
  padding-top:24px;
  border-top:1px solid var(--line);
}

.related a{
  display:block;
  margin:6px 0;
  font-size:14.5px;
}

footer.site{
  border-top:1px solid var(--line);
  padding:26px 0;
  text-align:center;
  color:var(--muted-2);
  font-size:12.5px;
}

footer.site a{
  color:var(--muted);
}
`;

// ============================================================
// HTML escaping
// ============================================================

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Render article HTML
// ============================================================

function renderPostHtml(article, relatedPosts) {
  const year = new Date().getFullYear();

  const faqItems = Array.isArray(article.faqItems)
    ? article.faqItems
    : [];

  const faqHtml = faqItems
    .map(
      (f) => `
        <div class="faq-item">
          <details>
            <summary>${escapeHtml(f.question)}</summary>
            <p>${escapeHtml(f.answer)}</p>
          </details>
        </div>
      `
    )
    .join('\n');

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer
      }
    }))
  };

  const relatedHtml = relatedPosts.length
    ? `
      <div class="related">
        <span class="eyebrow">Related</span>
        ${relatedPosts
          .map(
            (p) =>
              `<a href="${escapeHtml(
                p.slug
              )}.html">${escapeHtml(p.title)}</a>`
          )
          .join('\n')}
      </div>
    `
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${escapeHtml(article.title)} | Grade My Finance</title>

  <meta
    name="description"
    content="${escapeHtml(article.metaDescription)}"
  >

  <link
    rel="canonical"
    href="https://grademyfinance.com/blog/${encodeURIComponent(
      article.slug
    )}.html"
  >

  <style>${SITE_CSS}</style>
</head>

<body>

<header class="site">
  <div class="hdr-row">
    <a class="wordmark" href="https://grademyfinance.com/">
      <span class="seal"><span>GMF</span></span>
      Grade My Finance
    </a>

    <a class="btn" href="https://grademyfinance.com/">
      Check Your Grade
    </a>
  </div>
</header>

<main>
  <article class="container">

    <div class="eyebrow">
      ${escapeHtml(article.category)}
    </div>

    <h1>${escapeHtml(article.title)}</h1>

    <p class="lede">
      ${escapeHtml(article.metaDescription)}
    </p>

    <div class="prose">
      ${article.bodyHtml}
    </div>

    ${
      faqItems.length
        ? `
          <section class="related">
            <h2>Frequently Asked Questions</h2>
            ${faqHtml}
          </section>
        `
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

<script type="application/ld+json">
${JSON.stringify(faqSchema)}
</script>

</body>
</html>
`;
}

// ============================================================
// File updates
// ============================================================

function updateManifest(manifestState, article) {
  const newEntry =
    `  { slug:${JSON.stringify(article.slug)}, ` +
    `title:${JSON.stringify(article.title)}, ` +
    `category:${JSON.stringify(article.category)} }`;

  const updatedArray = manifestState.arrayLiteral.replace(
    /\]$/,
    manifestState.posts.length
      ? `,\n${newEntry}\n]`
      : `\n${newEntry}\n]`
  );

  const updatedRaw = manifestState.raw.replace(
    manifestState.arrayLiteral,
    updatedArray
  );

  fs.writeFileSync(
    path.join(ROOT, 'posts-manifest.js'),
    updatedRaw
  );
}

function updateSitemap(article) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');

  if (!fs.existsSync(sitemapPath)) {
    console.warn(
      'sitemap.xml not found. Skipping sitemap update.'
    );
    return;
  }

  const raw = fs.readFileSync(sitemapPath, 'utf8');

  const entry = `
  <url>
    <loc>https://grademyfinance.com/blog/${escapeHtml(
      article.slug
    )}.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;

  if (!raw.includes('</urlset>')) {
    throw new Error(
      'Could not find </urlset> in sitemap.xml'
    );
  }

  const updated = raw.replace(
    '</urlset>',
    `${entry}</urlset>`
  );

  fs.writeFileSync(sitemapPath, updated);
}

function updateBlogIndex(article) {
  const indexPath = path.join(
    ROOT,
    'blog',
    'index.html'
  );

  if (!fs.existsSync(indexPath)) {
    console.warn(
      'blog/index.html not found. Skipping blog index update.'
    );
    return;
  }

  const raw = fs.readFileSync(indexPath, 'utf8');

  const year = new Date().getFullYear();

  const entry = `
    <li>
      <a class="title" href="${escapeHtml(
        article.slug
      )}.html">
        ${escapeHtml(article.title)}
      </a>

      <p>${escapeHtml(article.metaDescription)}</p>

      <span class="meta">
        ${year} · ${article.readTimeMinutes} min read
      </span>
    </li>
`;

  // Try the existing "Latest posts" marker first.
  const marker =
    /(Latest posts<\/span>\s*)/i;

  if (marker.test(raw)) {
    const updated = raw.replace(
      marker,
      `$1\n${entry}`
    );

    fs.writeFileSync(indexPath, updated);
    return;
  }

  // Fallback: insert after the first <ul> in the posts area.
  const ulMatch = raw.match(/<ul[^>]*>/i);

  if (ulMatch) {
    const position =
      ulMatch.index + ulMatch[0].length;

    const updated =
      raw.slice(0, position) +
      `\n${entry}` +
      raw.slice(position);

    fs.writeFileSync(indexPath, updated);
    return;
  }

  console.warn(
    'Could not find blog index insertion point. Skipping blog index update.'
  );
}

// ============================================================
// Queue failed/unverified articles
// ============================================================

function writeQueueDraft(article, reason) {
  const queueDir = path.join(ROOT, 'queue');

  fs.mkdirSync(queueDir, {
    recursive: true
  });

  const safeSlug =
    article &&
    article.slug &&
    /^[a-z0-9-]+$/.test(article.slug)
      ? article.slug
      : `untitled-${Date.now()}`;

  const queuePath = path.join(
    queueDir,
    `${safeSlug}.json`
  );

  fs.writeFileSync(
    queuePath,
    JSON.stringify(
      {
        ...article,
        queuedAt: new Date().toISOString(),
        reason
      },
      null,
      2
    )
  );

  return queuePath;
}

// ============================================================
// Validate article
// ============================================================

function validateArticle(article, existingSlugs) {
  const problems = [];

  if (!article || typeof article !== 'object') {
    problems.push('article is not an object');
    return problems;
  }

  if (
    !article.slug ||
    typeof article.slug !== 'string' ||
    !/^[a-z0-9-]+$/.test(article.slug)
  ) {
    problems.push('invalid slug');
  }

  if (
    article.slug &&
    existingSlugs.has(article.slug)
  ) {
    problems.push('duplicate slug');
  }

  if (
    !article.title ||
    typeof article.title !== 'string'
  ) {
    problems.push('missing title');
  }

  if (
    !article.metaDescription ||
    typeof article.metaDescription !== 'string'
  ) {
    problems.push('missing meta description');
  }

  if (
    !article.bodyHtml ||
    typeof article.bodyHtml !== 'string' ||
    article.bodyHtml.length < 1500
  ) {
    problems.push('body too short');
  }

  if (!Array.isArray(article.faqItems)) {
    problems.push('missing FAQ');
  } else if (article.faqItems.length < 1) {
    problems.push('FAQ is empty');
  }

  if (
    article.containsTimeSensitiveClaims &&
    !article.verified
  ) {
    problems.push(
      'unverified time-sensitive claims'
    );
  }

  if (!article.category) {
    problems.push('missing category');
  }

  if (
    !article.sourcesUsed ||
    !Array.isArray(article.sourcesUsed)
  ) {
    problems.push('missing sourcesUsed array');
  }

  return problems;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const manifestState = loadManifest();

  const existingSlugs = new Set(
    manifestState.posts.map((p) => p.slug)
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
      console.log(
        `Generating article ${i + 1} of ${ARTICLES_PER_DAY}...`
      );

      // Refresh manifest before each article so the second article
      // sees the first article that was just published.
      const currentManifest = loadManifest();

      manifestState.raw = currentManifest.raw;
      manifestState.posts = currentManifest.posts;
      manifestState.arrayLiteral =
        currentManifest.arrayLiteral;

      for (const post of manifestState.posts) {
        existingSlugs.add(post.slug);
      }

      const prompt =
        buildPrompt(manifestState.posts);

      const rawResponse =
        await callClaude(prompt);

      console.log(
        `Claude response received for article ${i + 1}.`
      );

      const article =
        extractJson(rawResponse);

      const problems =
        validateArticle(
          article,
          existingSlugs
        );

      if (problems.length) {
        const queuePath =
          writeQueueDraft(
            article,
            problems.join('; ')
          );

        console.warn(
          `Article ${i + 1} queued for review:`,
          problems.join('; ')
        );

        console.warn(
          `Queue file: ${queuePath}`
        );

        results.queued.push({
          slug: article.slug,
          reason: problems.join('; ')
        });

        continue;
      }

      // Prevent accidental overwriting.
      const articlePath = path.join(
        ROOT,
        'blog',
        `${article.slug}.html`
      );

      if (fs.existsSync(articlePath)) {
        throw new Error(
          `Article file already exists: ${article.slug}.html`
        );
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
        articlePath,
        html
      );

      updateManifest(
        manifestState,
        article
      );

      updateSitemap(article);

      updateBlogIndex(article);

      existingSlugs.add(article.slug);

      results.published.push(
        article.slug
      );

      publishedArticles.push(article);

      console.log(
        `Published article: ${article.slug}`
      );
    } catch (err) {
      console.error(
        `Article ${i + 1} failed:`,
        err && err.message
          ? err.message
          : err
      );

      results.failed.push(
        err && err.message
          ? err.message
          : String(err)
      );

      // One failed article does not stop the batch.
      continue;
    }
  }

  // ==========================================================
  // Pinterest
  // ==========================================================

  let pinterestResults = {
    posted: [],
    failed: []
  };

  try {
    if (publishedArticles.length > 0) {
      console.log(
        `Sending ${publishedArticles.length} published article(s) to Pinterest...`
      );

      pinterestResults =
        await publishArticlesToPinterest(
          publishedArticles
        );
    } else {
      console.log(
        'No published articles. Skipping Pinterest.'
      );
    }
  } catch (err) {
    console.error(
      'Pinterest distribution failed:',
      err && err.message
        ? err.message
        : err
    );

    pinterestResults = {
      posted: [],
      failed: [
        err && err.message
          ? err.message
          : String(err)
      ]
    };
  }

  // ==========================================================
  // Summary
  // ==========================================================

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

// ============================================================
// Fatal error handler
// ============================================================

main().catch((err) => {
  console.error(
    'Fatal error in content engine:',
    err
  );

  process.exit(1);
});
