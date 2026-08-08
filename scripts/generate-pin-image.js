// Grade My Finance — Pin image generator
// Renders a branded 1000x1500 PNG for each article, matching the dark/gold
// visual identity used across the site. Returns a Buffer — nothing is
// written to disk or committed to the repo; it's generated fresh each time
// and handed straight to Pinterest as base64 image data.

const { createCanvas } = require('@napi-rs/canvas');

const WIDTH = 1000;
const HEIGHT = 1500;

const COLORS = {
  bgTop: '#14161C',
  bgBottom: '#0A0B0E',
  goldBright: '#E4C24E',
  gold: '#C9A227',
  text: '#F2F3F5',
  muted: '#8B92A0',
  badgeText: '#1A1300',
};

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function generatePinImage({ title, category }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, WIDTH * 0.3, HEIGHT);
  bg.addColorStop(0, COLORS.bgTop);
  bg.addColorStop(0.6, COLORS.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Soft gold glow, top right
  const glow = ctx.createRadialGradient(
    WIDTH - 80, 80, 0,
    WIDTH - 80, 80, 420
  );
  glow.addColorStop(0, 'rgba(228,194,78,0.20)');
  glow.addColorStop(1, 'rgba(228,194,78,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const pad = 72;

  // Logo badge
  const badgeSize = 76;
  const badgeGrad = ctx.createLinearGradient(pad, pad, pad + badgeSize, pad + badgeSize);
  badgeGrad.addColorStop(0, COLORS.goldBright);
  badgeGrad.addColorStop(1, COLORS.gold);
  ctx.fillStyle = badgeGrad;
  roundRect(ctx, pad, pad, badgeSize, badgeSize, 18);
  ctx.fill();
  ctx.fillStyle = COLORS.badgeText;
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A+', pad + badgeSize / 2, pad + badgeSize / 2 + 2);

  // Wordmark
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('Grade my finance', pad + badgeSize + 20, pad + badgeSize / 2 + 12);

  // Category eyebrow
  const eyebrowY = 340;
  ctx.fillStyle = COLORS.goldBright;
  ctx.font = 'bold 26px monospace';
  ctx.fillText((category || '').toUpperCase(), pad, eyebrowY);

  // Title, word-wrapped
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 62px sans-serif';
  const maxTitleWidth = WIDTH - pad * 2;
  const lines = wrapText(ctx, title, maxTitleWidth).slice(0, 5);
  let ty = eyebrowY + 90;
  const lineHeight = 76;
  for (const line of lines) {
    ctx.fillText(line, pad, ty);
    ty += lineHeight;
  }

  // Bottom divider + CTA
  const dividerY = HEIGHT - 130;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, dividerY);
  ctx.lineTo(WIDTH - pad, dividerY);
  ctx.stroke();

  ctx.font = '30px sans-serif';
  ctx.fillStyle = COLORS.muted;
  const ctaPrefix = 'Free grade in ';
  ctx.fillText(ctaPrefix, pad, dividerY + 50);
  const prefixWidth = ctx.measureText(ctaPrefix).width;
  ctx.fillStyle = COLORS.goldBright;
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('2 minutes', pad + prefixWidth, dividerY + 50);

  return canvas.toBuffer('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

module.exports = { generatePinImage };
