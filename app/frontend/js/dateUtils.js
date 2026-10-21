// =========================================================
// PAMSIMAS STUDIO - DATE, TIME & COORDINATE UTILITIES
// =========================================================

export const INDO_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export const INDO_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export const INDO_MONTH_MAP = {
  'januari': 0, 'jan': 0, 'january': 0,
  'februari': 1, 'feb': 1, 'february': 1,
  'maret': 2, 'mar': 2, 'march': 2,
  'april': 3, 'apr': 3,
  'mei': 4, 'may': 4,
  'juni': 5, 'jun': 5, 'june': 5,
  'juli': 6, 'jul': 6, 'july': 6,
  'agustus': 7, 'agu': 7, 'ags': 7, 'agt': 7, 'aug': 7, 'august': 7,
  'september': 8, 'sep': 8, 'sept': 8,
  'oktober': 9, 'okt': 9, 'oct': 9, 'october': 9,
  'november': 10, 'nov': 10,
  'desember': 11, 'des': 11, 'dec': 11, 'december': 11
};

/**
 * Parses an Indonesian timestamp string like:
 * "Sabtu, 15 Agustus 2026 09:30:15 WIB"
 * Returns structured components and Date object.
 */
export function parseIndonesianTimestamp(str) {
  if (!str || typeof str !== 'string') {
    const now = new Date();
    return {
      dayName: INDO_DAYS[now.getDay()],
      dayNum: now.getDate(),
      monthIndex: now.getMonth(),
      monthName: INDO_MONTHS[now.getMonth()],
      year: now.getFullYear(),
      hours: now.getHours(),
      minutes: now.getMinutes(),
      seconds: now.getSeconds(),
      isoDate: now.toISOString().slice(0, 10),
      timeStr24: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
      timezone: 'WIB',
      dateObj: now
    };
  }

  // Match: DayName, Day Month Year HH:MM:SS TZ
  const dayMatch = str.match(/^(Minggu|Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)[,\s]+/i);
  const matchedDay = dayMatch ? dayMatch[1] : null;

  const timePattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  const timeMatch = str.match(timePattern);

  const tzMatch = str.match(/\b(WIB|WITA|WIT)\b/i);
  const tz = tzMatch ? tzMatch[1].toUpperCase() : 'WIB';

  let dayNum = 15;
  let monthIndex = 7; // Agustus default (0-indexed)
  let year = 2026;

  // Cek apakah diawali format ISO YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    monthIndex = parseInt(isoMatch[2], 10) - 1;
    dayNum = parseInt(isoMatch[3], 10);
  } else {
    const datePattern = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/;
    const dateMatch = str.match(datePattern);
    if (dateMatch) {
      dayNum = parseInt(dateMatch[1], 10);
      const mStr = dateMatch[2].toLowerCase();
      if (mStr in INDO_MONTH_MAP) {
        monthIndex = INDO_MONTH_MAP[mStr];
      }
      year = parseInt(dateMatch[3], 10);
    }
  }

  let hours = 9;
  let minutes = 15;
  let seconds = 23;

  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
  }

  const dateObj = new Date(year, monthIndex, dayNum, hours, minutes, seconds);
  const computedDay = INDO_DAYS[dateObj.getDay()];

  const isoDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
  const timeStr24 = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return {
    dayName: matchedDay || computedDay,
    dayNum,
    monthIndex,
    monthName: INDO_MONTHS[monthIndex],
    year,
    hours,
    minutes,
    seconds,
    isoDate,
    timeStr24,
    timezone: tz,
    dateObj
  };
}

/**
 * Formats a Date object or ISO date + time into official Indonesian timestamp:
 * e.g. "Jumat, 14 Agustus 2026 09:15:23 WIB"
 */
export function formatIndonesianTimestamp(isoDate, timeStr = "09:14:23", tz = "WIB") {
  let dateObj;
  if (isoDate instanceof Date) {
    dateObj = isoDate;
  } else if (typeof isoDate === 'string' && isoDate.includes('-')) {
    const parts = isoDate.split('-').map(Number);
    const tParts = (timeStr || '09:14:23').split(':').map(Number);
    dateObj = new Date(parts[0], parts[1] - 1, parts[2], tParts[0] || 0, tParts[1] || 0, tParts[2] || 0);
  } else {
    dateObj = new Date();
  }

  const dayName = INDO_DAYS[dateObj.getDay()];
  const dayNum = dateObj.getDate();
  const monthName = INDO_MONTHS[dateObj.getMonth()];
  const year = dateObj.getFullYear();

  const hh = String(dateObj.getHours()).padStart(2, '0');
  const mm = String(dateObj.getMinutes()).padStart(2, '0');
  const ss = String(dateObj.getSeconds()).padStart(2, '0');

  return `${dayName}, ${dayNum} ${monthName} ${year} ${hh}:${mm}:${ss} ${tz}`;
}

/**
 * Formats an ISO date (YYYY-MM-DD) into Indonesian date string:
 * e.g. "14 Agustus 2026". Returns original if already formatted.
 */
export function formatIndonesianDateOnly(isoDate) {
  if (!isoDate) return '';
  const s = String(isoDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s;
  }
  const parts = s.slice(0, 10).split('-').map(Number);
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  return `${dateObj.getDate()} ${INDO_MONTHS[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
}

/**
 * Menghitung H+1 dari tanggal ISO (YYYY-MM-DD)
 */
export function getNextDayIso(isoDate) {
  if (!isoDate) return '';
  const s = String(isoDate).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parts = s.slice(0, 10).split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

/**
 * Mengonversi tanggal ke teks baku bahasa Indonesia (e.g. "22 September 2026")
 */
export function toIndonesianDateText(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return formatIndonesianDateOnly(s);
  }
  return s;
}

/**
 * Returns Indonesian Day Name from ISO date (YYYY-MM-DD)
 */
export function getIndonesianDayName(isoDate) {
  if (!isoDate) return 'Senin';
  const parts = isoDate.split('-').map(Number);
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  return INDO_DAYS[dateObj.getDay()];
}

/**
 * Generates an authentic non-round second offset:
 * Strictly avoids multiples of 5 (never ends in 0 or 5; e.g. produces 18, 23, 37, 42, 54, etc.)
 */
export function getRandomNonRoundSeconds(minSec = 17, maxSec = 74) {
  const pool = [];
  for (let s = minSec; s <= maxSec; s++) {
    if (s % 5 !== 0) pool.push(s);
  }
  if (pool.length === 0) return 23;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Adds natural time jitter (offset in seconds) to an existing Indonesian timestamp string.
 * Strictly avoids multiples of 5 on delta seconds, clock minutes, and clock seconds.
 */
export function applyTimeJitter(timeStr, jitterMinSec = -47, jitterMaxSec = 47) {
  const parsed = parseIndonesianTimestamp(timeStr);
  const curDate = parsed.dateObj;

  // Generate random delta avoiding multiples of 5
  const deltaPool = [];
  for (let d = jitterMinSec; d <= jitterMaxSec; d++) {
    if (d !== 0 && d % 5 !== 0) deltaPool.push(d);
  }
  const deltaSec = deltaPool.length > 0
    ? deltaPool[Math.floor(Math.random() * deltaPool.length)]
    : 17;

  const newDate = new Date(curDate.getTime() + deltaSec * 1000);

  // Guarantee non-round seconds on the clock (never :00, :05, :10, :15, etc.)
  if (newDate.getSeconds() % 5 === 0) {
    newDate.setSeconds(newDate.getSeconds() + (newDate.getSeconds() < 58 ? 2 : -2));
  }

  // Guarantee clock minutes are not a multiple of 5 if seconds are near round
  if (newDate.getMinutes() % 5 === 0) {
    newDate.setMinutes(newDate.getMinutes() + (newDate.getMinutes() < 59 ? 1 : -1));
  }

  return formatIndonesianTimestamp(newDate, null, parsed.timezone);
}

/**
 * Adds realistic GPS coordinate jitter to prevent identical coordinates ("plek ketiplek sama").
 * Default range: 5 meters to 2,000 meters (2 KM) around the village center.
 * Strictly avoids multiples of 5 for the drift distance in meters.
 * 1 meter approx = 0.000009 degrees latitude.
 * Returns { lat: string, lon: string } formatted with 6 decimal places.
 */
export function applyGpsJitter(lat, lon, minMeters = 5, maxMeters = 2000) {
  let latNum = parseFloat(String(lat).replace(',', '.'));
  let lonNum = parseFloat(String(lon).replace(',', '.'));

  if (isNaN(latNum) || isNaN(lonNum)) {
    return { lat: String(lat), lon: String(lon) };
  }

  const minM = Math.max(5, Math.ceil(minMeters));
  const maxM = Math.max(minM + 2, Math.floor(maxMeters));

  // Pick random integer meter distance in [minM, maxM] strictly avoiding multiples of 5
  let baseM = minM + Math.floor(Math.random() * (maxM - minM + 1));
  if (baseM % 5 === 0) {
    baseM = (baseM + 2 <= maxM) ? baseM + 2 : Math.max(minM, baseM - 1);
  }

  // Add irregular fractional meter offset (e.g. 0.13, 0.27, 0.38, 0.42, 0.63, 0.74, 0.86; avoiding .0 and .5)
  const fracPool = [0.13, 0.27, 0.38, 0.42, 0.63, 0.74, 0.86];
  const radius = baseM + fracPool[Math.floor(Math.random() * fracPool.length)];
  const angle = Math.random() * 2 * Math.PI;

  const metersPerDegLat = 111132.0;
  const metersPerDegLon = 111320.0 * Math.cos(latNum * (Math.PI / 180.0));

  const dLat = (radius * Math.cos(angle)) / metersPerDegLat;
  const dLon = (radius * Math.sin(angle)) / metersPerDegLon;

  const newLat = (latNum + dLat).toFixed(6);
  const newLon = (lonNum + dLon).toFixed(6);

  return {
    lat: newLat,
    lon: newLon
  };
}

/**
 * Generates an array of authentic, sequential Indonesian timestamps for field inspection photos.
 * Starts at baseIsoDate and baseTimeStr, then advances by irregular intervals.
 * Strictly avoids multiples of 5 for minutes, step seconds, and clock seconds.
 */
export function generateSequentialTimestamps(baseIsoDate, baseTimeStr = "09:14:23", count = 6, minStepMin = 3, maxStepMin = 8, tz = "WIB") {
  const result = [];
  const parts = (baseIsoDate || new Date().toISOString().slice(0, 10)).split('-').map(Number);
  const tParts = (baseTimeStr || "09:14:23").split(':').map(Number);
  let curDate = new Date(parts[0], parts[1] - 1, parts[2], tParts[0] || 9, tParts[1] || 14, tParts[2] || 23);

  // Pool of step minutes that are NOT multiples of 5 (avoids 5, 10, 15)
  const stepMinPool = [3, 4, 6, 7, 8, 9, 11, 12, 13, 14];
  const filteredStepMin = stepMinPool.filter(m => m >= minStepMin && m <= maxStepMin);
  const finalMinPool = filteredStepMin.length > 0 ? filteredStepMin : [3, 4, 6, 7];

  const stepSecPool = [17, 23, 31, 38, 42, 53, -19, -27, -33];

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      // First photo: guarantee non-round clock seconds and minutes
      let s = curDate.getSeconds();
      if (s % 5 === 0) {
        curDate.setSeconds(s + (s < 58 ? 2 : -2));
      }
      let m = curDate.getMinutes();
      if (m % 5 === 0) {
        curDate.setMinutes(m + (m < 59 ? 1 : -1));
      }
    } else {
      // Subsequent photos: advance by non-round minutes and irregular seconds
      const stepMin = finalMinPool[Math.floor(Math.random() * finalMinPool.length)];
      const stepSec = stepSecPool[Math.floor(Math.random() * stepSecPool.length)];
      curDate = new Date(curDate.getTime() + (stepMin * 60 + stepSec) * 1000);

      let s = curDate.getSeconds();
      if (s % 5 === 0) {
        curDate.setSeconds(s + (s < 58 ? 2 : -2));
      }
      let m = curDate.getMinutes();
      if (m % 5 === 0) {
        curDate.setMinutes(m + (m < 59 ? 1 : -1));
      }
    }
    result.push(formatIndonesianTimestamp(curDate, null, tz));
  }
  return result;
}

/**
 * Generates an array of authentic, evenly distributed Indonesian timestamps across multiple days.
 * 
 * Target: Photo uploads distributed evenly from startDate to endDate (e.g. 3 - 7 September 2026).
 * Realism Constraint: Realistic working hours, strictly starting at startTimeStr (e.g. 09:00 WIB)
 * and strictly not exceeding endTimeStr (e.g. 15:00 WIB / 3 sore).
 * Anti-Slop / Anti-Detection Rule: Clock minutes, delta minutes, and seconds strictly avoid multiples of 5.
 * 
 * @param {string} startIso - Start date 'YYYY-MM-DD'
 * @param {string} endIso - End date 'YYYY-MM-DD'
 * @param {number} count - Total number of photos
 * @param {string} startTimeStr - Starting hour 'HH:MM:SS' (default: "09:14:23")
 * @param {string} endTimeStr - Maximum ending hour 'HH:MM:SS' (default: "15:00:00")
 * @param {string} tz - Timezone string (default: "WIB")
 * @returns {Array<string>} Array of Indonesian timestamp strings
 */
export function generateMultiDayTimeline(
  startIso,
  endIso,
  count = 1,
  startTimeStr = "09:14:23",
  endTimeStr = "15:00:00",
  tz = "WIB"
) {
  if (count <= 0) return [];

  // Parse start and end date components
  const sParts = (startIso || new Date().toISOString().slice(0, 10)).split('-').map(Number);
  const eParts = (endIso || startIso || new Date().toISOString().slice(0, 10)).split('-').map(Number);

  let startDate = new Date(sParts[0], sParts[1] - 1, sParts[2]);
  let endDate = new Date(eParts[0], eParts[1] - 1, eParts[2]);

  if (endDate < startDate) {
    endDate = new Date(startDate);
  }

  // Build array of dates (YYYY-MM-DD)
  const dateList = [];
  const curD = new Date(startDate);
  while (curD <= endDate) {
    const y = curD.getFullYear();
    const m = String(curD.getMonth() + 1).padStart(2, '0');
    const d = String(curD.getDate()).padStart(2, '0');
    dateList.push(`${y}-${m}-${d}`);
    curD.setDate(curD.getDate() + 1);
  }

  const numDays = dateList.length;

  // Distribute photo counts proportionally across days
  const basePerDay = Math.floor(count / numDays);
  const remainder = count % numDays;
  const dayAllocations = dateList.map((isoDate, idx) => ({
    isoDate,
    count: basePerDay + (idx < remainder ? 1 : 0)
  }));

  // Parse start time and end time into total minutes from midnight
  const parseTimeToMinutes = (tStr, defaultH, defaultM) => {
    const match = (tStr || "").match(/(\d{1,2}):(\d{2})/);
    if (match) {
      return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }
    return defaultH * 60 + defaultM;
  };

  const startMinFromMid = parseTimeToMinutes(startTimeStr, 9, 14);
  const endMinFromMid = parseTimeToMinutes(endTimeStr, 15, 0);

  const nonRoundSecPool = [18, 23, 27, 34, 38, 42, 47, 53, 58];

  const results = [];

  dayAllocations.forEach((dayInfo, dayIdx) => {
    const k = dayInfo.count;
    if (k <= 0) return;

    const parts = dayInfo.isoDate.split('-').map(Number);

    // Initial starting hour jitter per day (e.g. 09:12, 09:17, 09:23)
    const dayStartJitter = (dayIdx * 7 + 3) % 23;
    let dayActualStartMin = startMinFromMid + dayStartJitter;
    if (dayActualStartMin % 5 === 0) dayActualStartMin += 2;

    if (k === 1) {
      // Single photo on this day: place within first 1.5 - 2 hours of survey
      let photoMin = dayActualStartMin + 18 + ((dayIdx * 11) % 45);
      if (photoMin >= endMinFromMid) photoMin = endMinFromMid - 18;
      if (photoMin % 5 === 0) photoMin += 2;

      const hh = Math.floor(photoMin / 60);
      const mm = photoMin % 60;
      const ss = nonRoundSecPool[(dayIdx * 3 + 1) % nonRoundSecPool.length];

      const dt = new Date(parts[0], parts[1] - 1, parts[2], hh, mm, ss);
      results.push(formatIndonesianTimestamp(dt, null, tz));
      return;
    }

    // Multiple photos: calculate realistic interval between start and end
    // Usable time window for the day
    const dayEndLimit = endMinFromMid - 4; // leave buffer before end limit
    const totalDaySpan = Math.max(20, dayEndLimit - dayActualStartMin);
    const avgStepMin = totalDaySpan / (k - 1);

    for (let pIdx = 0; pIdx < k; pIdx++) {
      let curPhotoMin = Math.round(dayActualStartMin + pIdx * avgStepMin);

      // Add slight irregular minute jitter (+- 1 to 4 minutes)
      if (pIdx > 0 && pIdx < k - 1) {
        const jitterPool = [-3, -2, 1, 2, 3];
        curPhotoMin += jitterPool[(dayIdx * 5 + pIdx * 7) % jitterPool.length];
      }

      // Hard clamp so it never exceeds endMinFromMid
      if (curPhotoMin > endMinFromMid) {
        curPhotoMin = endMinFromMid - 2 - (k - 1 - pIdx) * 3;
      }
      if (curPhotoMin < dayActualStartMin) {
        curPhotoMin = dayActualStartMin;
      }

      // Avoid minutes ending in 0 or 5
      if (curPhotoMin % 5 === 0) {
        curPhotoMin = (curPhotoMin + 2 <= endMinFromMid) ? curPhotoMin + 2 : curPhotoMin - 2;
      }

      const hh = Math.floor(curPhotoMin / 60);
      const mm = curPhotoMin % 60;
      const ss = nonRoundSecPool[(dayIdx * 7 + pIdx * 11) % nonRoundSecPool.length];

      const dt = new Date(parts[0], parts[1] - 1, parts[2], hh, mm, ss);
      results.push(formatIndonesianTimestamp(dt, null, tz));
    }
  });

  return results;
}

/**
 * Menghasilkan alur jadwal perjalanan dinas (1 hari atau multi-hari)
 * dan membagi foto secara merata antar-desa serta merata dalam rentang jam dinas (startTimeStr - endTimeStr).
 *
 * Aturan Kritis:
 * 1. Menit dan detik dilarang kelipatan 5 (non-mainstream).
 * 2. Jam foto tersebar merata dari jam mulai sampai jam selesai hari itu (tidak menumpuk di jam 9).
 * 3. Pembagian foto merata antar-desa: M foto / N desa = merata.
 * 4. Multi-hari: Hari 1 untuk Desa 1, Hari 2 untuk Desa 2, dst.
 */
export function generateTripSchedule({
  startIso,
  endIso,
  startTimeStr = "09:14:23",
  endTimeStr = "15:47:38",
  villages = [],
  photoCount = 0,
  tz = "WIB"
}) {
  if (photoCount <= 0) return [];

  const sIso = startIso || new Date().toISOString().slice(0, 10);
  const eIso = endIso || sIso;

  const sParts = sIso.split('-').map(Number);
  const eParts = eIso.split('-').map(Number);
  let sDate = new Date(sParts[0], sParts[1] - 1, sParts[2]);
  let eDate = new Date(eParts[0], eParts[1] - 1, eParts[2]);
  if (eDate < sDate) eDate = new Date(sDate);

  const tripDates = [];
  const cur = new Date(sDate);
  while (cur <= eDate) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    tripDates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }

  const validVillages = (villages && villages.length > 0)
    ? villages
    : [{ desa: '', kecamatan: '' }];
  const numVillages = validVillages.length;
  const numDays = tripDates.length;

  const photoVillageAllocations = [];
  const basePerVillage = Math.floor(photoCount / numVillages);
  const remVillage = photoCount % numVillages;

  let currentPhotoIdx = 0;
  for (let vIdx = 0; vIdx < numVillages; vIdx++) {
    const countThisVillage = basePerVillage + (vIdx < remVillage ? 1 : 0);
    for (let c = 0; c < countThisVillage; c++) {
      photoVillageAllocations.push({
        photoIndex: currentPhotoIdx++,
        villageIndex: vIdx,
        village: validVillages[vIdx]
      });
    }
  }

  let photoDayAllocations = [];
  if (numDays === 1) {
    photoDayAllocations = photoVillageAllocations.map(p => ({
      ...p,
      isoDate: tripDates[0],
      dayIndex: 0
    }));
  } else if (numDays === numVillages) {
    photoDayAllocations = photoVillageAllocations.map(p => ({
      ...p,
      isoDate: tripDates[p.villageIndex] || tripDates[tripDates.length - 1],
      dayIndex: p.villageIndex
    }));
  } else {
    const basePerDay = Math.floor(photoCount / numDays);
    const remDay = photoCount % numDays;
    let dayPIdx = 0;
    for (let dIdx = 0; dIdx < numDays; dIdx++) {
      const countThisDay = basePerDay + (dIdx < remDay ? 1 : 0);
      for (let c = 0; c < countThisDay; c++) {
        if (dayPIdx < photoVillageAllocations.length) {
          photoDayAllocations.push({
            ...photoVillageAllocations[dayPIdx],
            isoDate: tripDates[dIdx],
            dayIndex: dIdx
          });
          dayPIdx++;
        }
      }
    }
  }

  const parseTimeToMin = (tStr, defH, defM) => {
    const m = (tStr || "").match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : defH * 60 + defM;
  };
  const startMin = parseTimeToMin(startTimeStr, 9, 14);
  const endMin = parseTimeToMin(endTimeStr, 15, 47);

  const byDay = {};
  photoDayAllocations.forEach(item => {
    if (!byDay[item.isoDate]) byDay[item.isoDate] = [];
    byDay[item.isoDate].push(item);
  });

  const nonRoundSecPool = [18, 23, 27, 34, 38, 42, 47, 53, 58];
  const finalSchedule = new Array(photoCount);

  Object.keys(byDay).forEach((isoDate, dayIdx) => {
    const dayPhotos = byDay[isoDate];
    const k = dayPhotos.length;
    const parts = isoDate.split('-').map(Number);

    let dayStart = startMin + ((dayIdx * 9 + 4) % 19);
    if (dayStart % 5 === 0) dayStart += 2;

    const dayEndLimit = endMin - 3;
    const span = Math.max(30, dayEndLimit - dayStart);

    if (k === 1) {
      let pMin = Math.round(dayStart + span * 0.45);
      if (pMin % 5 === 0) pMin += 2;
      const hh = Math.floor(pMin / 60);
      const mm = pMin % 60;
      const ss = nonRoundSecPool[(dayIdx * 3 + 1) % nonRoundSecPool.length];
      const dt = new Date(parts[0], parts[1] - 1, parts[2], hh, mm, ss);
      finalSchedule[dayPhotos[0].photoIndex] = {
        ...dayPhotos[0],
        timeStr: formatIndonesianTimestamp(dt, null, tz),
        hours: hh,
        minutes: mm,
        seconds: ss
      };
      return;
    }

    const stepMin = span / (k - 1);
    for (let i = 0; i < k; i++) {
      let curMin = Math.round(dayStart + i * stepMin);

      if (i > 0 && i < k - 1) {
        const jit = [-3, -2, 1, 2, 3];
        curMin += jit[(dayIdx * 5 + i * 7) % jit.length];
      }

      if (curMin > dayEndLimit) curMin = dayEndLimit - (k - 1 - i) * 2;
      if (curMin < dayStart) curMin = dayStart + i * 2;

      if (curMin % 5 === 0) {
        curMin = (curMin + 2 <= dayEndLimit) ? curMin + 2 : curMin - 2;
      }

      const hh = Math.floor(curMin / 60);
      const mm = curMin % 60;
      const ss = nonRoundSecPool[(dayIdx * 7 + i * 11) % nonRoundSecPool.length];
      const dt = new Date(parts[0], parts[1] - 1, parts[2], hh, mm, ss);

      finalSchedule[dayPhotos[i].photoIndex] = {
        ...dayPhotos[i],
        timeStr: formatIndonesianTimestamp(dt, null, tz),
        hours: hh,
        minutes: mm,
        seconds: ss
      };
    }
  });

  return finalSchedule;
}

