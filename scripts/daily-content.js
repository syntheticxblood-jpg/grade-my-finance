// Grade My Finance — Daily Content Engine
// Generates articles with Claude + web search, receives the article through
// strict tool use (schema-validated), publishes it to the site, updates the
// manifest/sitemap/blog index, and sends published articles to Pinterest.
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
  console.error(
    'Missing ANTHROPIC_API_KEY env var. Aborting.'
  );
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
    throw new Error(
      'Could not parse posts-manifest.js'
    );
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

// ---------- Article schema ----------
//
// Claude is forced to provide this structure through strict tool use.
// This eliminates the JSON.parse() problem entirely.

const ARTICLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slug: {
      type: 'string',
      description:
        'Kebab-case URL slug using only lowercase letters, numbers, and hyphens.'
    },

    title: {
      type: 'string',
      description:
        'Clear, useful article title.'
    },

    metaDescription: {
      type: 'string',
      description:
        'One-sentence meta description under 155 characters.'
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
      description:
        'Estimated reading time in minutes.'
    },

    bodyHtml: {
      type: 'string',
      description:
        'Full article HTML, at least 500 words. Use only p, h2, h3, ul, ol, li, strong, em, and a tags. No markdown, scripts, iframes, inline styles, or html/body wrappers.'
    },

    faqItems: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
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

// ---------- Claude API ----------
//
// This uses:
// 1. Anthropic's web search server tool.
// 2. A strict custom "submit_article" tool.
//
// Claude can search first when necessary, then submit the finished
// article through the schema-validated tool.
//
// We never JSON.parse Claude's article text.

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
        'Submit the completed Grade My Finance article. You MUST use this tool when the article is finished. The input must contain the complete article and all required metadata. If current or time-sensitive financial facts are used, search the web first and include the sources actually used.',
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

  // Allow enough turns for:
  // search -> search result -> article submission
  // without creating an uncontrolled loop.
  for (let turn = 0; turn < 6; turn++) {
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
          max_tokens: 7000,
          messages,
          tools,

          // Claude must use one of the available tools.
          // Parallel calls are disabled so it can search first
          // and submit the article afterward.
          tool_choice: {
            type: 'any',
            disable_parallel_tool_use: true
          }
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

    // Look for our validated article tool call.
    const articleToolCall = (
      data.content || []
    ).find(
      (block) =>
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

    // If Claude used the web search server tool, Anthropic may return
    // pause_turn while it completes the search. Continue the same
    // conversation exactly as Anthropic recommends.
    if (
      data.stop_reason === 'pause_turn' ||
      data.stop_reason === 'tool_use'
    ) {
      messages.push({
        role: 'assistant',
        content: data.content
      });

      // For server-side web search, Claude's search results are already
      // incorporated by Anthropic. We continue the same message thread.
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

    throw new Error(
      `Claude ended without submitting an article. Stop reason: ${data.stop_reason || 'unknown'}`
    );
  }

  throw new Error(
    'Claude exceeded the maximum number of generation turns.'
  );
}

// ---------- Build article prompt ----------

function buildPrompt(existingPosts) {
  const existingList = existingPosts
    .map(
      (p) =>
        `- [${p.category}] ${p.title} (slug: ${p.slug})`
    )
    .join('\n');

  return `
You are writing one original blog article for grademyfinance.com.

Brand voice:
- Practical
- Plain-spoken
- No fluff
- No hype
- No fake urgency
- No exaggerated promises
- Clear and direct
- Short paragraphs
- Concrete numbers where appropriate

Here is every article already published on the site.

DO NOT duplicate these topics:

${existingList}

TASK:

1. Pick ONE genuinely useful personal-finance topic that is not already covered.
2. The article should help a reader improve their financial situation, financial knowledge, or financial grade.
3. If the topic contains current or time-sensitive information — including tax rules, IRS limits, contribution limits, interest rates, government programs, credit rules, or other changing figures — use the web search tool before submitting the article.
4. Prefer authoritative sources such as:
   - irs.gov
   - consumerfinance.gov
   - federalreserve.gov
   - ssa.gov
   - fdic.gov
   - sec.gov
   - usa.gov
   - official government or regulatory sources
5. If you use current facts, record the actual sources you used in sourcesUsed.
6. Never invent statistics, studies, testimonials, quotes, sources, or URLs.
7. If a central time-sensitive claim cannot be verified, set verified to false and explain why in verificationNotes.
8. Do not guess at current financial figures.

ARTICLE REQUIREMENTS:

- At least 500 words.
- Use useful subheadings.
- Use only these HTML tags in bodyHtml:
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
- No inline styles.
- No html/body wrapper.
- Include "Grade My Finance" naturally once in the article.
- The Grade My Finance mention should encourage the reader to check their financial grade without sounding like a hard sales pitch.
- FAQ should contain at least two useful questions and answers.
- The slug must be lowercase kebab-case.
- The meta description must be under 155 characters.
- sourcesUsed must contain only sources actually used.
- If no external sources were needed, sourcesUsed may be an empty array.
- The finished article must be submitted using the submit_article tool.
- Do not answer with a normal text response. Submit the completed article through submit_article.
`;
}

// ---------- HTML escaping ----------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Site CSS ----------

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

// ---------- Render article HTML ----------

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
<title>${escapeHtml(
    article.title
  )} | Grade My Finance</title>
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

<section class="related">
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

<script type="application/ld+json">${JSON.stringify(
    faqSchema
  )}</script>

</body>
</html>`;
}

// ---------- Update manifest ----------

function updateManifest(
  manifestState,
  article
) {
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
    path.join(
      ROOT,
      'posts-manifest.js'
    ),
    updatedRaw
  );
}

// ---------- Update sitemap ----------

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

  if (
    raw.includes(
      `/blog/${article.slug}.html`
    )
  ) {
    return;
  }

  const updated = raw.replace(
    '</urlset>',
    `${entry}</urlset>`
  );

  fs.writeFileSync(
    sitemapPath,
    updated
  );
}

// ---------- Update blog index ----------

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

  if (
    raw.includes(
      `${article.slug}.html`
    )
  ) {
    return;
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

// ---------- Queue failed validation ----------

function writeQueueDraft(
  article,
  reason
) {
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

// ---------- Validate article ----------

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

  return problems;
}

// ---------- Main ----------

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
        await callClaude(prompt);

      console.log(
        `Claude returned structured article: ${article.title}`
      );

      const problems =
        validateArticle(
          article,
          existingSlugs
        );

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

      // Refresh manifest after publishing.
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

      // Continue to the next article.
      continue;
    }
  }

  // ---------- Pinterest ----------

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

  // Don't make GitHub Actions fail merely because an individual
  // article failed. The workflow can still commit successful articles.
}

main().catch((err) => {
  console.error(
    'Fatal error in content engine:',
    err
  );

  process.exit(1);
});
