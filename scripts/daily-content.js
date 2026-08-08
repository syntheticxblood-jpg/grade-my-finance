// Grade My Finance — Daily Content Engine
// Generates articles with Claude + web search, publishes them to the site,
// updates the manifest/sitemap/blog index, and sends published articles
// to Pinterest.
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

// ------------------------------------------------------------
// LOAD MANIFEST
// ------------------------------------------------------------

function loadManifest() {
  const manifestPath = path.join(ROOT, 'posts-manifest.js');

  if (!fs.existsSync(manifestPath)) {
    throw new Error('posts-manifest.js not found');
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');

  const match = raw.match(
    /var\s+GMF_BLOG_POSTS\s*=\s*(\[[\s\S]*?\]);/
  );

  if (!match) {
    throw new Error('Could not parse posts-manifest.js');
  }

  // This is our own repository file.
  // eslint-disable-next-line no-eval
  const posts = eval(match[1]);

  return {
    raw,
    posts,
    arrayLiteral: match[1]
  };
}

// ------------------------------------------------------------
// ARTICLE SCHEMA
// ------------------------------------------------------------

const ARTICLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,

  properties: {
    slug: {
      type: 'string',
      description:
        'Lowercase kebab-case slug using only letters, numbers, and hyphens.'
    },

    title: {
      type: 'string',
      description: 'Clear and useful article title.'
    },

    metaDescription: {
      type: 'string',
      description:
        'One sentence under 155 characters.'
    },

    category: {
      type: 'string',
      enum: [
        'Budgeting',
        'Debt',
        'Savings',
        'Investing',
        'Retirement',
        'Credit',
        'Housing',
        'Taxes',
        'Insurance',
        'Habits',
        'Relationships',
        'Advice',
        'Income',
        'Money Mindset',
        'Net Worth',
        'Financial Grade'
      ]
    },

    readTimeMinutes: {
      type: 'integer',
      description: 'Estimated reading time.'
    },

    bodyHtml: {
      type: 'string',
      description:
        'Complete article HTML. At least 500 words. Allowed tags only: p, h2, h3, ul, ol, li, strong, em, a.'
    },

    faqItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: {
            type: 'string'
          },
          answer: {
            type: 'string'
          }
        },
        required: [
          'question',
          'answer'
        ]
      }
    },

    containsTimeSensitiveClaims: {
      type: 'boolean'
    },

    verified: {
      type: 'boolean'
    },

    verificationNotes: {
      type: 'string'
    },

    sourcesUsed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string'
          },
          url: {
            type: 'string'
          }
        },
        required: [
          'name',
          'url'
        ]
      }
    }
  },

  required: [
    'slug',
    'title',
    'metaDescription',
    'category',
    'readTimeMinutes',
    'bodyHtml',
    'faqItems',
    'containsTimeSensitiveClaims',
    'verified',
    'verificationNotes',
    'sourcesUsed'
  ]
};

// ------------------------------------------------------------
// CLAUDE API
// ------------------------------------------------------------
//
// IMPORTANT:
// We do NOT use:
// disable_parallel_tool_use
//
// That was the source of the current Anthropic 400 error.
//
// Claude can use web search and then use submit_article.
// We allow the API to manage the tool sequence normally.
// ------------------------------------------------------------

async function callClaude(promptText) {
  const tools = [
    {
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: 3
    },

    {
      name: 'submit_article',
      description:
        'Submit the completed Grade My Finance article after researching any necessary current facts.',
      strict: true,
      input_schema: ARTICLE_SCHEMA
    }
  ];

  let messages = [
    {
      role: 'user',
      content: promptText
    }
  ];

  for (let turn = 0; turn < 8; turn++) {
    const response = await fetch(
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
          max_tokens: 7000,
          messages,
          tools
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Anthropic API error ${response.status}: ${text}`
      );
    }

    const data = await response.json();

    const content = Array.isArray(data.content)
      ? data.content
      : [];

    // --------------------------------------------------------
    // LOOK FOR OUR ARTICLE TOOL CALL
    // --------------------------------------------------------

    const articleToolCall = content.find(
      (block) =>
        block &&
        block.type === 'tool_use' &&
        block.name === 'submit_article'
    );

    if (articleToolCall) {
      if (
        !articleToolCall.input ||
        typeof articleToolCall.input !== 'object'
      ) {
        throw new Error(
          'Claude submitted an empty article.'
        );
      }

      return articleToolCall.input;
    }

    // --------------------------------------------------------
    // CONTINUE TOOL CONVERSATION
    // --------------------------------------------------------

    if (
      data.stop_reason === 'tool_use' ||
      data.stop_reason === 'pause_turn'
    ) {
      messages.push({
        role: 'assistant',
        content
      });

      // If Claude used a client-side custom tool that requires
      // a result, provide a continuation message.
      //
      // Web search is server-side, so Anthropic handles that
      // result internally.
      const customToolUses = content.filter(
        (block) =>
          block &&
          block.type === 'tool_use' &&
          block.name !== 'web_search' &&
          block.name !== 'submit_article'
      );

      if (customToolUses.length > 0) {
        messages.push({
          role: 'user',
          content:
            'Continue the task and submit the completed article using the submit_article tool.'
        });
      }

      continue;
    }

    if (data.stop_reason === 'max_tokens') {
      throw new Error(
        'Claude reached the token limit before submitting the article.'
      );
    }

    if (data.stop_reason === 'refusal') {
      throw new Error(
        'Claude refused to generate the article.'
      );
    }

    // --------------------------------------------------------
    // LAST CHANCE: SOME API RESPONSES MAY RETURN TEXT
    // --------------------------------------------------------

    const text = content
      .filter(
        (block) =>
          block && block.type === 'text'
      )
      .map(
        (block) => block.text
      )
      .join('\n')
      .trim();

    if (text) {
      throw new Error(
        `Claude returned text instead of submit_article. Response: ${text.slice(
          0,
          500
        )}`
      );
    }

    throw new Error(
      `Claude ended without submitting an article. Stop reason: ${
        data.stop_reason || 'unknown'
      }`
    );
  }

  throw new Error(
    'Claude exceeded the maximum number of generation turns.'
  );
}

// ------------------------------------------------------------
// PROMPT
// ------------------------------------------------------------

function buildPrompt(existingPosts) {
  const existingList = existingPosts
    .map(
      (p) =>
        `- [${p.category}] ${p.title} (slug: ${p.slug})`
    )
    .join('\n');

  return `
You are writing one original personal-finance article for grademyfinance.com.

BRAND VOICE:

- Practical
- Plain-spoken
- No fluff
- No hype
- No fake urgency
- No exaggerated promises
- Clear and direct
- Short paragraphs
- Useful examples
- Concrete numbers when appropriate

EXISTING ARTICLES:

The following articles already exist.

DO NOT duplicate these topics:

${existingList}

TASK:

Choose ONE genuinely useful personal-finance topic that is not already covered.

The article should help readers improve their finances, understand money better, or improve their financial grade.

CURRENT INFORMATION:

If the article involves information that can change over time, use the web_search tool before submitting the article.

Examples include:

- IRS rules
- Tax brackets
- Contribution limits
- Social Security rules
- Interest rates
- Credit rules
- Government programs
- Inflation figures
- Current financial regulations
- Current limits or thresholds
- Other current financial statistics

Prefer authoritative sources such as:

- irs.gov
- consumerfinance.gov
- federalreserve.gov
- ssa.gov
- fdic.gov
- sec.gov
- usa.gov

Never invent:

- Statistics
- Studies
- Testimonials
- Quotes
- Sources
- URLs

If a time-sensitive claim is central to the article and you cannot verify it, set:

verified = false

and explain the issue in verificationNotes.

If you use current information, put the real sources you actually used in sourcesUsed.

ARTICLE REQUIREMENTS:

- Minimum 500 words.
- Use useful subheadings.
- Use only these HTML tags inside bodyHtml:

<p>
<h2>
<h3>
<ul>
<ol>
<li>
<strong>
<em>
<a>

- No markdown.
- No scripts.
- No iframes.
- No inline CSS.
- No HTML or BODY wrapper.
- Include "Grade My Finance" naturally once.
- The Grade My Finance mention should encourage readers to check their financial grade.
- Do not make it sound like an aggressive advertisement.
- Include at least two FAQ questions and answers.
- Use a lowercase kebab-case slug.
- Keep metaDescription under 155 characters.
- sourcesUsed must contain only sources actually used.
- If no external sources were needed, sourcesUsed may be an empty array.

IMPORTANT:

Do not respond with the article as normal text.

When the article is complete, submit it using the submit_article tool.

You MUST use submit_article to return the completed article.
`;
}

// ------------------------------------------------------------
// HTML ESCAPING
// ------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ------------------------------------------------------------
// SITE CSS
// ------------------------------------------------------------

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
box-sizing:border-box
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
margin:0 0 .5em
}

.container{
max-width:760px;
margin:0 auto;
padding:0 22px
}

a{
color:var(--gold-bright)
}

header.site{
border-bottom:1px solid var(--line);
background:rgba(10,11,14,.8);
backdrop-filter:blur(10px);
position:sticky;
top:0;
z-index:10
}

.hdr-row{
max-width:760px;
margin:0 auto;
padding:16px 22px;
display:flex;
align-items:center;
gap:10px
}

.seal{
width:32px;
height:32px;
border-radius:8px;
background:linear-gradient(155deg,var(--gold-bright),var(--gold));
display:grid;
place-items:center;
flex:none
}

.seal span{
font-family:var(--font-mono);
font-weight:700;
font-size:11px;
color:#1a1300
}

.wordmark{
font-weight:700;
font-size:15.5px;
color:var(--text);
text-decoration:none
}

.hdr-row a.wordmark{
display:flex;
align-items:center;
gap:10px
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
white-space:nowrap
}

main{
padding:48px 0 70px
}

.eyebrow{
font-family:var(--font-mono);
font-size:12px;
color:var(--gold-bright);
letter-spacing:.06em;
text-transform:uppercase
}

h1{
font-size:clamp(26px,4vw,36px);
margin-top:10px
}

p.lede{
color:var(--muted);
font-size:16.5px;
margin-top:14px
}

.prose p,
.prose li{
font-size:15.5px;
color:#D6D9DE
}

.prose h2{
font-size:21px;
margin-top:38px
}

table{
width:100%;
border-collapse:collapse;
margin:18px 0;
font-size:14px
}

th,td{
text-align:left;
padding:10px 12px;
border-bottom:1px solid var(--line)
}

th{
color:var(--muted);
font-weight:600;
font-size:12.5px;
text-transform:uppercase;
letter-spacing:.03em
}

td.mono{
font-weight:600
}

.cta-card{
background:var(--surface);
border:1px solid var(--line);
border-radius:var(--radius-lg);
padding:24px;
margin:32px 0;
box-shadow:var(--shadow)
}

.cta-card h3{
margin-top:0;
font-size:19px
}

.cta-card p{
color:var(--muted);
font-size:14.5px
}

.cta-btn{
display:inline-block;
background:linear-gradient(155deg,var(--gold-bright),var(--gold));
color:#1a1300;
font-weight:700;
padding:12px 20px;
border-radius:10px;
text-decoration:none;
margin-top:6px
}

.faq-item{
border-top:1px solid var(--line);
padding:16px 0
}

.faq-item summary{
cursor:pointer;
font-weight:600;
font-size:15px;
list-style:none
}

.faq-item summary::-webkit-details-marker{
display:none
}

.faq-item p{
color:var(--muted);
font-size:14.5px;
margin-top:8px
}

.related{
margin-top:40px;
padding-top:24px;
border-top:1px solid var(--line)
}

.related a{
display:block;
margin:6px 0;
font-size:14.5px
}

footer.site{
border-top:1px solid var(--line);
padding:26px 0;
text-align:center;
color:var(--muted-2);
font-size:12.5px
}

footer.site a{
color:var(--muted)
}
`;

// ------------------------------------------------------------
// RENDER ARTICLE
// ------------------------------------------------------------

function renderPostHtml(article, relatedPosts) {
  const year = new Date().getFullYear();

  const faqHtml = article.faqItems
    .map(
      (f) => `
<div class="faq-item">
  <details>
    <summary>${escapeHtml(f.question)}</summary>
    <p>${escapeHtml(f.answer)}</p>
  </details>
</div>`
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

  const relatedHtml =
    relatedPosts.length > 0
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
</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

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

<style>
${SITE_CSS}
</style>

<script type="application/ld+json">
${JSON.stringify(faqSchema)}
</script>

</head>

<body>

<header class="site">
  <div class="hdr-row">
    <a class="wordmark" href="https://grademyfinance.com/">
      <span class="seal">
        <span>GMF</span>
      </span>
      Grade My Finance
    </a>

    <a
      class="btn"
      href="https://grademyfinance.com/"
    >
      Check Your Grade
    </a>
  </div>
</header>

<main>
  <article class="container">

    <div class="eyebrow">
      ${escapeHtml(article.category)}
    </div>

    <h1>
      ${escapeHtml(article.title)}
    </h1>

    <p class="lede">
      ${escapeHtml(article.metaDescription)}
    </p>

    <div class="prose">
      ${article.bodyHtml}
    </div>

    <section class="faq">
      <h2>Frequently Asked Questions</h2>
      ${faqHtml}
    </section>

    ${relatedHtml}

  </article>
</main>

<footer class="site">
  <div class="container">
    © ${year} Grade My Finance
  </div>
</footer>

</body>
</html>
`;
}

// ------------------------------------------------------------
// UPDATE MANIFEST
// ------------------------------------------------------------

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
      /\]$/,
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

// ------------------------------------------------------------
// UPDATE SITEMAP
// ------------------------------------------------------------

function updateSitemap(article) {
  const sitemapPath =
    path.join(ROOT, 'sitemap.xml');

  if (!fs.existsSync(sitemapPath)) {
    console.warn(
      'sitemap.xml not found; skipping sitemap update.'
    );
    return;
  }

  const raw =
    fs.readFileSync(
      sitemapPath,
      'utf8'
    );

  const articleUrl =
    `https://grademyfinance.com/blog/${article.slug}.html`;

  if (raw.includes(articleUrl)) {
    return;
  }

  const entry = `
  <url>
    <loc>${articleUrl}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;

  const marker = '</urlset>';

  if (!raw.includes(marker)) {
    throw new Error(
      'Could not find </urlset> in sitemap.xml'
    );
  }

  const updated =
    raw.replace(
      marker,
      `${entry}${marker}`
    );

  fs.writeFileSync(
    sitemapPath,
    updated
  );
}

// ------------------------------------------------------------
// UPDATE BLOG INDEX
// ------------------------------------------------------------

function updateBlogIndex(article) {
  const indexPath =
    path.join(
      ROOT,
      'blog',
      'index.html'
    );

  if (!fs.existsSync(indexPath)) {
    console.warn(
      'blog/index.html not found; skipping blog index update.'
    );
    return;
  }

  const raw =
    fs.readFileSync(
      indexPath,
      'utf8'
    );

  if (
    raw.includes(
      `${article.slug}.html`
    )
  ) {
    return;
  }

  const year =
    new Date().getFullYear();

  const entry = `
<li>
  <a
    class="title"
    href="${escapeHtml(article.slug)}.html"
  >
    ${escapeHtml(article.title)}
  </a>

  <p>
    ${escapeHtml(article.metaDescription)}
  </p>

  <span class="meta">
    ${year} · ${article.readTimeMinutes} min read
  </span>
</li>
`;

  // Try the existing "Latest posts" marker.
  const marker =
    /(Latest posts<\/span>\s*)/i;

  if (marker.test(raw)) {
    const updated =
      raw.replace(
        marker,
        `$1${entry}`
      );

    fs.writeFileSync(
      indexPath,
      updated
    );

    return;
  }

  // Fallback: put it before the first </ul>.
  const ulMarker = '</ul>';

  if (raw.includes(ulMarker)) {
    const updated =
      raw.replace(
        ulMarker,
        `${entry}\n${ulMarker}`
      );

    fs.writeFileSync(
      indexPath,
      updated
    );

    return;
  }

  throw new Error(
    'Could not find a place to insert article into blog/index.html'
  );
}

// ------------------------------------------------------------
// VALIDATE ARTICLE
// ------------------------------------------------------------

function validateArticle(
  article,
  existingSlugs
) {
  const problems = [];

  if (
    !article ||
    typeof article !== 'object'
  ) {
    problems.push(
      'article was not an object'
    );

    return problems;
  }

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
    !article.title ||
    !article.metaDescription
  ) {
    problems.push(
      'missing title/meta'
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
    !Array.isArray(
      article.faqItems
    ) ||
    article.faqItems.length < 2
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

  if (
    !Array.isArray(
      article.sourcesUsed
    )
  ) {
    problems.push(
      'sourcesUsed must be an array'
    );
  }

  return problems;
}

// ------------------------------------------------------------
// QUEUE DRAFT
// ------------------------------------------------------------

function writeQueueDraft(
  article,
  reason
) {
  const queueDir =
    path.join(
      ROOT,
      'queue'
    );

  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(
      queueDir,
      {
        recursive: true
      }
    );
  }

  const slug =
    article &&
    article.slug
      ? article.slug
      : `untitled-${Date.now()}`;

  const queuePath =
    path.join(
      queueDir,
      `${slug}.json`
    );

  fs.writeFileSync(
    queuePath,
    JSON.stringify(
      {
        ...(article || {}),
        queuedAt:
          new Date().toISOString(),
        reason
      },
      null,
      2
    )
  );
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

async function main() {
  const manifestState =
    loadManifest();

  const existingSlugs =
    new Set(
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
      console.log(
        `Generating article ${i + 1} of ${ARTICLES_PER_DAY}...`
      );

      const prompt =
        buildPrompt(
          manifestState.posts
        );

      const article =
        await callClaude(
          prompt
        );

      console.log(
        `Claude returned article: ${article.title}`
      );

      const problems =
        validateArticle(
          article,
          existingSlugs
        );

      if (
        problems.length > 0
      ) {
        console.warn(
          `Article ${i + 1} queued: ${problems.join(
            '; '
          )}`
        );

        writeQueueDraft(
          article,
          problems.join(
            '; '
          )
        );

        results.queued.push({
          slug:
            article.slug,
          reason:
            problems.join(
              '; '
            )
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

      const articlePath =
        path.join(
          ROOT,
          'blog',
          `${article.slug}.html`
        );

      fs.writeFileSync(
        articlePath,
        html
      );

      updateManifest(
        manifestState,
        article
      );

      const refreshed =
        loadManifest();

      manifestState.raw =
        refreshed.raw;

      manifestState.posts =
        refreshed.posts;

      manifestState.arrayLiteral =
        refreshed.arrayLiteral;

      existingSlugs.add(
        article.slug
      );

      updateSitemap(
        article
      );

      updateBlogIndex(
        article
      );

      results.published.push(
        article.slug
      );

      publishedArticles.push(
        article
      );

      console.log(
        `Published: ${article.slug}`
      );

    } catch (err) {
      console.error(
        `Article ${i + 1} failed:`,
        err.message
      );

      results.failed.push(
        err.message
      );
    }
  }

  // ----------------------------------------------------------
  // PINTEREST
  // ----------------------------------------------------------

  let pinterestResults = {
    posted: [],
    failed: []
  };

  if (
    publishedArticles.length > 0
  ) {
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
        failed: [
          err.message
        ]
      };
    }
  }

  // ----------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------

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

// ------------------------------------------------------------
// START
// ------------------------------------------------------------

main().catch(
  (err) => {
    console.error(
      'Fatal error in content engine:',
      err
    );

    process.exit(1);
  }
);
