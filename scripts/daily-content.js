// Grade My Finance — Daily Content Engine
// Reads existing posts, generates N new articles via the Claude API (with
// web search for fact-checking), and either publishes them (writing the
// blog post, manifest, sitemap, and blog index entries) or — if a claim
// can't be verified — drops a draft into /queue for manual review.
//
// Runs inside GitHub Actions. Requires ANTHROPIC_API_KEY as an env var.

const fs = require('fs');
const path = require('path');
const { jsonrepair } = require('jsonrepair');
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
  const raw = fs.readFileSync(path.join(ROOT, 'posts-manifest.js'), 'utf8');
  const match = raw.match(/var GMF_BLOG_POSTS = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not parse posts-manifest.js');
  // The array literal uses unquoted keys — safe to eval since it's our own
  // repo file, not external input.
  // eslint-disable-next-line no-eval
  const posts = eval(match[1]);
  return { raw, posts, arrayLiteral: match[1] };
}

// ---------- Call the Anthropic API ----------

async function callClaude(promptText) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: promptText }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  // Concatenate all text blocks; the model's final JSON answer is what we want.
  const textBlocks = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text);
  return textBlocks.join('\n');
}

// Escapes raw control characters (newlines, tabs, etc.) that appear
// INSIDE quoted JSON string values, while leaving structural whitespace
// between tokens (e.g. the newline after "{" in pretty-printed JSON)
// completely untouched. That distinction matters: raw newlines/tabs are
// valid, insignificant JSON whitespace outside of strings, but illegal
// unescaped inside them. A previous version of this function escaped
// control characters everywhere, which inserted a literal backslash
// into positions where the JSON spec doesn't allow one - breaking
// otherwise-valid pretty-printed JSON. This walks the text character by
// character, tracking whether we're currently inside a string (handling
// escaped quotes correctly), and only touches control characters found
function extractJson(rawText) {
  // Strip markdown fences if the model added them despite instructions.
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  // Grab the last {...} block in case there's reasoning text before it.
  const firstBrace = cleaned.indexOf('{');
  const candidate = cleaned.slice(firstBrace, cleaned.lastIndexOf('}') + 1);
  const toParse = candidate.length ? candidate : cleaned;

  // Try a direct parse first (fast path - most responses are already
  // valid JSON). Only fall back to jsonrepair, a well-tested library
  // purpose-built for fixing exactly the kinds of small mistakes LLMs
  // make in generated JSON (missing commas between array/object
  // elements, unescaped control characters inside strings, trailing
  // commas, etc.), when the direct parse fails. This replaced several
  // rounds of hand-rolled fixes here that kept missing edge cases one at
  // a time - a dedicated library covers far more cases than we can
  // realistically anticipate and patch for individually.
  try {
    return JSON.parse(toParse);
  } catch (directErr) {
    try {
      const repaired = jsonrepair(toParse);
      return JSON.parse(repaired);
    } catch (repairErr) {
      const pos = Number((directErr.message.match(/position (\d+)/) || [])[1]);
      const context = Number.isFinite(pos)
        ? toParse.slice(Math.max(0, pos - 80), pos + 80)
        : toParse.slice(0, 200);
      throw new Error(
        `JSON parse failed even after repair attempt. Direct error: ${directErr.message}. Repair error: ${repairErr.message}\nContext: ...${context}...`
      );
    }
  }
}

// ---------- Build the article prompt ----------

function buildPrompt(existingPosts) {
  const existingList = existingPosts
    .map((p) => `- [${p.category}] ${p.title} (slug: ${p.slug})`)
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
- Body content should be substantive — at least 500 words — organized with <h2> subheadings, using only these HTML tags: <p>, <h2>, <h3>, <ul>, <li>, <table>, <tr>, <td>, <th>, <strong>. No inline styles, no <script>, no <html>/<body> wrapper.
- Include a "Grade My Finance" mention naturally once in the body, encouraging the reader to check their financial grade, without being a hard sales pitch.

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
  "sourcesUsed": [{"name": "Source name", "url": "https://..."}]
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

function renderPostHtml(article, relatedPosts) {
  const year = new Date().getFullYear();
  const faqHtml = article.faqItems
    .map(
      (f) => `<div class="faq-item"><details><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details></div>`
    )
    .join('\n');

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: article.faqItems.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };

  const relatedHtml = relatedPosts.length
    ? `<div class="related"><span class="section-label">Related</span>${relatedPosts
        .map((p) => `<a href="${p.slug}.html">${escapeHtml(p.title)}</a>`)
        .join('')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(article.title)} | Grade My Finance</title>
<meta name="description" content="${escapeHtml(article.metaDescription)}">
<meta name="theme-color" content="#0A0B0E">
<meta name="robots" content="index,follow">
<link rel="canonical" href="https://grademyfinance.com/blog/${article.slug}.html">
<meta property="og:title" content="${escapeHtml(article.title)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://grademyfinance.com/blog/${article.slug}.html">
<meta property="og:image" content="https://grademyfinance.com/og-image.png">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-H6223HYVS6"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-H6223HYVS6',{'anonymize_ip':true});</script>
<style>
${SITE_CSS}
</style>
</head>
<body>
<header class="site"><div class="hdr-row"><a class="wordmark" href="/index.html"><span class="seal"><span>A+</span></span>Grade My Finance</a><a class="btn" href="/index.html#grade">Get My Free Grade</a></div></header>
<main class="container">
<span class="eyebrow">${escapeHtml(article.category)}</span>
<h1>${escapeHtml(article.title)}</h1>
<p class="lede">${escapeHtml(article.metaDescription)}</p>
<div class="prose">
${article.bodyHtml}
</div>
<div class="cta-card">
<h3>What's your financial grade?</h3>
<p>Get a free A–F grade on your finances in under two minutes — no signup required.</p>
<a class="cta-btn" href="/index.html#grade">Get My Free Grade</a>
</div>
${faqHtml}
${relatedHtml}
</main>
<footer class="site"><div class="container">© ${year} Grade My Finance — educational use only, not financial advice. <a href="/privacy-policy.html">Privacy Policy</a> · <a href="/index.html">Home</a></div></footer>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- File updates ----------

function updateManifest(manifestState, article) {
  const newEntry = `  { slug:"${article.slug}", title:${JSON.stringify(article.title)}, category:"${article.category}" }`;
  const updatedArray = manifestState.arrayLiteral.replace(
    /\]$/,
    manifestState.posts.length ? `,\n${newEntry}\n]` : `\n${newEntry}\n]`
  );
  const updatedRaw = manifestState.raw.replace(manifestState.arrayLiteral, updatedArray);
  fs.writeFileSync(path.join(ROOT, 'posts-manifest.js'), updatedRaw);
}

function updateSitemap(article) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  const raw = fs.readFileSync(sitemapPath, 'utf8');
  const entry = `<url>\n<loc>https://grademyfinance.com/blog/${article.slug}.html</loc>\n<changefreq>monthly</changefreq>\n<priority>0.7</priority>\n</url>\n`;
  const updated = raw.replace('</urlset>', `${entry}</urlset>`);
  fs.writeFileSync(sitemapPath, updated);
}

function updateBlogIndex(article) {
  const indexPath = path.join(ROOT, 'blog', 'index.html');
  const raw = fs.readFileSync(indexPath, 'utf8');
  const year = new Date().getFullYear();
  const entry = `    <li>\n      <a class="title" href="${article.slug}.html">${escapeHtml(article.title)}</a>\n      <p>${escapeHtml(article.metaDescription)}</p>\n      <span class="meta">${year} · ${article.readTimeMinutes} min read</span>\n    </li>\n`;

  // Insert right after the first <ul> tag that appears anywhere after the
  // "Latest posts" label. Deliberately does NOT require the <ul> to sit
  // immediately next to the label — the blog index page's layout can
  // change independently of this script (extra text, filters, etc.
  // inserted between them), which previously broke a strict adjacency
  // match. Anchoring on "next <ul> after the label" survives that.
  const labelText = '<span class="section-label">Latest posts</span>';
  const labelIdx = raw.indexOf(labelText);
  if (labelIdx === -1) throw new Error('Could not find "Latest posts" label in blog index');

  const ulIdx = raw.indexOf('<ul>', labelIdx);
  if (ulIdx === -1) throw new Error('Could not find blog index insertion point (<ul> after Latest posts label)');

  const insertAt = ulIdx + '<ul>'.length;
  const updated = raw.slice(0, insertAt) + '\n' + entry + raw.slice(insertAt);
  fs.writeFileSync(indexPath, updated);
}

function writeQueueDraft(article, reason) {
  const queuePath = path.join(ROOT, 'queue', `${article.slug || 'untitled-' + Date.now()}.json`);
  fs.writeFileSync(
    queuePath,
    JSON.stringify({ ...article, queuedAt: new Date().toISOString(), reason }, null, 2)
  );
}

// ---------- Main ----------

async function main() {
  const manifestState = loadManifest();
  const existingSlugs = new Set(manifestState.posts.map((p) => p.slug));

  const results = { published: [], queued: [], failed: [] };
  const publishedArticles = []; // full article objects, needed for social posting below

  for (let i = 0; i < ARTICLES_PER_DAY; i++) {
    try {
      const prompt = buildPrompt(manifestState.posts);
      const rawResponse = await callClaude(prompt);
      const article = extractJson(rawResponse);

      // Basic validation
      const problems = [];
      if (!article.slug || !/^[a-z0-9-]+$/.test(article.slug)) problems.push('invalid slug');
      if (existingSlugs.has(article.slug)) problems.push('duplicate slug');
      if (!article.bodyHtml || article.bodyHtml.length < 1500) problems.push('body too short');
      if (!article.title || !article.metaDescription) problems.push('missing title/meta');
      if (!Array.isArray(article.faqItems) || article.faqItems.length < 1) problems.push('missing FAQ');
      if (article.containsTimeSensitiveClaims && !article.verified) problems.push('unverified time-sensitive claims');

      if (problems.length) {
        writeQueueDraft(article, problems.join('; '));
        results.queued.push({ slug: article.slug, reason: problems.join('; ') });
        continue;
      }

      const relatedPosts = manifestState.posts
        .filter((p) => p.category === article.category)
        .slice(0, 2);

      const html = renderPostHtml(article, relatedPosts);
      fs.writeFileSync(path.join(ROOT, 'blog', `${article.slug}.html`), html);

      updateManifest(manifestState, article);
      // Refresh in-memory state so a second article this run doesn't collide.
      manifestState.raw = fs.readFileSync(path.join(ROOT, 'posts-manifest.js'), 'utf8');
      const reload = loadManifest();
      manifestState.posts = reload.posts;
      manifestState.arrayLiteral = reload.arrayLiteral;
      existingSlugs.add(article.slug);

      updateSitemap(article);
      updateBlogIndex(article);

      results.published.push(article.slug);
      publishedArticles.push(article);
    } catch (err) {
      console.error(`Article ${i + 1} failed:`, err.message);
      results.failed.push(err.message);
      // Per spec: one failure doesn't stop the run.
      continue;
    }
  }

  // Social distribution — runs after all articles are committed locally.
  // Failure here never affects the blog publish results above.
  const pinterestResults = await publishArticlesToPinterest(publishedArticles);

  console.log('--- Daily Content Engine summary ---');
  console.log('Published:', results.published);
  console.log('Queued for review:', results.queued);
  console.log('Failed:', results.failed);
  console.log('Pinterest posted:', pinterestResults.posted);
  console.log('Pinterest failed:', pinterestResults.failed);
}

main().catch((err) => {
  console.error('Fatal error in content engine:', err);
  process.exit(1);
});
