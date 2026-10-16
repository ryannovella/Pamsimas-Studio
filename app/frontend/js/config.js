// =========================================================
// PAMSIMAS STUDIO - CONFIG & CONSTANTS
// =========================================================

export const STAMP_CONFIG = {
  fontFamily: 'Arial, sans-serif',
  fontSizeRatio: 0.04237,     // ~20px on 472px image height
  lineHeightRatio: 1.15,      // Line height multiplier
  marginRightRatio: 0.0222,   // Right padding multiplier
  marginBottomRatio: 0.0254,  // Bottom padding multiplier
  shadowDxRatio: 1.2 / 20.0,
  shadowDyRatio: 1.2 / 20.0,
  shadowBlurRatio: 0.8 / 20.0,
  shadowColor: 'rgba(0, 0, 0, 0.92)',
  textColor: '#ffffff'
};

export const DEFAULT_REGION = {
  kabupaten: 'Kabupaten Magelang',
  provinsi: 'Jawa Tengah'
};

export const SAMPLE_PHOTO_IDS = [4, 20, 28, 34, 45, 55];

export const KNOWN_COORDS_FRONTEND = {
  "baleagung": { lat: "-7.391520", lon: "110.312050", kec: "Grabag", kab: "Kabupaten Magelang" },
  "ketawang": { lat: "-7.408820", lon: "110.324540", kec: "Grabag", kab: "Kabupaten Magelang" },
  "jati": { lat: "-7.510160", lon: "110.380950", kec: "Sawangan", kab: "Kabupaten Magelang" },
  "jambewangi": { lat: "-7.451824", lon: "110.331825", kec: "Pakis", kab: "Kabupaten Magelang" },
  "genito": { lat: "-7.397820", lon: "110.156540", kec: "Windusari", kab: "Kabupaten Magelang" },
  "tanjungsari": { lat: "-7.422850", lon: "110.133040", kec: "Windusari", kab: "Kabupaten Magelang" },
  "karanggayam": { lat: "-7.585210", lon: "109.612450", kec: "Karanggayam", kab: "Kabupaten Kebumen" },
  "gempolan": { lat: "-7.558320", lon: "111.084530", kec: "Kerjo", kab: "Kabupaten Karanganyar" },
  "bukuran": { lat: "-7.426210", lon: "110.978120", kec: "Kalijambe", kab: "Kabupaten Sragen" },
  "gabus": { lat: "-7.362140", lon: "111.045230", kec: "Ngrampal", kab: "Kabupaten Sragen" },
  "aditirto": { lat: "-7.683412", lon: "109.641238", kec: "Pejagoan", kab: "Kabupaten Kebumen" },
  "tlogosari": { lat: "-7.625124", lon: "109.684125", kec: "Ayah", kab: "Kabupaten Kebumen" }
};

