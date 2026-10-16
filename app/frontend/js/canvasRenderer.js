// =========================================================
// PAMSIMAS STUDIO - CANVAS RENDERING ENGINE
// =========================================================
import { STAMP_CONFIG } from './config.js';

function wrapAddressLines(text, maxChars = 42) {
  const result = [];
  const paras = String(text || '').split('\n');
  for (const para of paras) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= maxChars) {
      result.push(p);
      continue;
    }
    const words = p.split(' ');
    let currentLine = '';
    for (const w of words) {
      if (!currentLine) {
        currentLine = w;
      } else if ((currentLine + ' ' + w).length <= maxChars) {
        currentLine += ' ' + w;
      } else {
        result.push(currentLine);
        currentLine = w;
      }
    }
    if (currentLine) result.push(currentLine);
  }
  return result;
}

export function renderStampedPhoto(canvas, imgObj, meta, showRaw = false) {
  const ctx = canvas.getContext('2d');
  const w = imgObj.width;
  const rawH = imgObj.height;

  // If user requested raw photo or keeping original without new stamp, show entire image untouched
  if (showRaw || meta?.keep_original || meta?.skip_stamp) {
    canvas.width = w;
    canvas.height = rawH;
    ctx.drawImage(imgObj, 0, 0);
    return;
  }

  // If photo contains legacy camera timestamp and hasn't been cropped yet,
  // automatically clip the legacy timestamp area from the bottom so the new stamp never collides or duplicates!
  const hasLegacyStamp = !!(meta?.has_timestamp && !meta?.is_cropped);
  const cropPct = hasLegacyStamp ? Math.max(0.05, Math.min(0.38, parseFloat(meta?.suggested_crop_bottom || meta?.crop_bottom_pct || 0.18) || 0.18)) : 0;
  const h = hasLegacyStamp ? Math.round(rawH * (1.0 - cropPct)) : rawH;

  canvas.width = w;
  canvas.height = h;

  // Draw photo (clipped at the bottom if legacy timestamp was present)
  ctx.drawImage(imgObj, 0, 0, w, h, 0, 0, w, h);

  // Calculate geometric mean of width and height to normalize aspect ratio variance
  const baseDim = Math.sqrt(w * h);

  // Proportional font sizing & line calculations with user font scale
  const fontScale = parseFloat(meta?.font_scale || meta?.fontScale || 1.0) || 1.0;
  const fontSize = Math.max(10, Math.round(baseDim * STAMP_CONFIG.fontSizeRatio * fontScale));
  const lineHeight = Math.round(fontSize * STAMP_CONFIG.lineHeightRatio);
  const marginRight = Math.max(10, Math.round(w * STAMP_CONFIG.marginRightRatio));
  const marginBottom = Math.max(10, Math.round(h * STAMP_CONFIG.marginBottomRatio));

  // Format coordinates with comma separator
  const latStr = String(meta?.lat || '').trim().replace('.', ',');
  const lonStr = String(meta?.lon || '').trim().replace('.', ',');
  const coordsLine = `${latStr} ${lonStr}`;
  
  const customAddr = String(meta?.custom_address || meta?.address || meta?.raw_address || '').trim();
  const addressMode = meta?.address_mode || 'auto';

  let lines = [
    (meta?.time_str || '').trim(),
    coordsLine
  ];

  if (customAddr && addressMode !== 'structured') {
    // Mode 1: Murni hasil tangkapan alamat lewat GPS / penitikkan peta (Natural)
    const addrLines = wrapAddressLines(customAddr, 42);
    lines.push(...addrLines);
  } else {
    // Mode 2: Hierarki wilayah administratif
    let kecClean = (meta?.kecamatan || '').trim();
    if (kecClean && !kecClean.toLowerCase().startsWith('kecamatan')) {
      kecClean = `Kecamatan ${kecClean}`;
    }
    let desaClean = (meta?.desa || '').trim();
    if (desaClean && !desaClean.toLowerCase().startsWith('desa')) {
      desaClean = `Desa ${desaClean}`;
    }

    if (meta?.dusun) lines.push(meta.dusun.trim());
    if (desaClean) lines.push(desaClean);
    if (kecClean) lines.push(kecClean);
    if (meta?.kabupaten) lines.push(meta.kabupaten.trim());
    if (meta?.provinsi) lines.push(meta.provinsi.trim());
  }

  lines = lines.filter(l => l && l.length > 0);
  
  const totalTextH = lines.length * lineHeight;
  const startY = h - marginBottom - totalTextH + fontSize * 0.85;
  
  ctx.save();
  ctx.font = `${fontSize}px ${STAMP_CONFIG.fontFamily}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  
  // Soft natural drop shadow
  ctx.shadowColor = STAMP_CONFIG.shadowColor;
  ctx.shadowOffsetX = STAMP_CONFIG.shadowDxRatio * fontSize;
  ctx.shadowOffsetY = STAMP_CONFIG.shadowDyRatio * fontSize;
  ctx.shadowBlur = STAMP_CONFIG.shadowBlurRatio * fontSize;
  
  ctx.fillStyle = STAMP_CONFIG.textColor;
  
  lines.forEach((line, i) => {
    const lineY = startY + i * lineHeight;
    ctx.fillText(line, w - marginRight, lineY);
  });
  
  ctx.restore();
}
