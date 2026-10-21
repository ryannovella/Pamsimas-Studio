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
  // Kabupaten Banjarnegara
  "masaran": { lat: "-7.419200", lon: "109.641500", kec: "Bawang", kab: "Kabupaten Banjarnegara" },
  "pejawaran": { lat: "-7.246800", lon: "109.782400", kec: "Pejawaran", kab: "Kabupaten Banjarnegara" },
  "bandingan": { lat: "-7.412600", lon: "109.528300", kec: "Rakit", kab: "Kabupaten Banjarnegara" },

  // Kabupaten Banyumas
  "sawangan": { lat: "-7.418500", lon: "109.086400", kec: "Ajibarang", kab: "Kabupaten Banyumas" },
  "kasegeran": { lat: "-7.431200", lon: "109.146800", kec: "Cilongok", kab: "Kabupaten Banyumas" },
  "rempoah": { lat: "-7.358400", lon: "109.236200", kec: "Baturraden", kab: "Kabupaten Banyumas" },
  "karangkedawung": { lat: "-7.452300", lon: "109.286500", kec: "Sokaraja", kab: "Kabupaten Banyumas" },
  "gandatapa": { lat: "-7.349600", lon: "109.274100", kec: "Sumbang", kab: "Kabupaten Banyumas" },

  // Kabupaten Boyolali
  "mojosari": { lat: "-7.371420", lon: "110.712350", kec: "Karanggede", kab: "Kabupaten Boyolali" },

  // Kabupaten Cilacap
  "pegadingan": { lat: "-7.428500", lon: "108.764200", kec: "Cipari", kab: "Kabupaten Cilacap" },
  "kertajaya": { lat: "-7.521400", lon: "108.856300", kec: "Gandrungmangu", kab: "Kabupaten Cilacap" },
  "jeruklegi kulon": { lat: "-7.581200", lon: "109.004500", kec: "Jeruklegi", kab: "Kabupaten Cilacap" },
  "sumingkir": { lat: "-7.564800", lon: "109.031200", kec: "Jeruklegi", kab: "Kabupaten Cilacap" },
  "karangpucung": { lat: "-7.411600", lon: "108.898400", kec: "Karangpucung", kab: "Kabupaten Cilacap" },
  "surusunda": { lat: "-7.392400", lon: "108.871500", kec: "Karangpucung", kab: "Kabupaten Cilacap" },
  "bener": { lat: "-7.314200", lon: "108.732600", kec: "Majenang", kab: "Kabupaten Cilacap" },
  "cibeunying": { lat: "-7.291800", lon: "108.761400", kec: "Majenang", kab: "Kabupaten Cilacap" },
  "jenang": { lat: "-7.298500", lon: "108.754200", kec: "Majenang", kab: "Kabupaten Cilacap" },
  "sidamukti": { lat: "-7.592400", lon: "108.758300", kec: "Patimuan", kab: "Kabupaten Cilacap" },
  "kunci": { lat: "-7.468200", lon: "108.791500", kec: "Sidareja", kab: "Kabupaten Cilacap" },
  "purwasari": { lat: "-7.336400", lon: "108.678200", kec: "Wanareja", kab: "Kabupaten Cilacap" },

  // Kabupaten Karanganyar
  "sidomukti": { lat: "-7.541800", lon: "111.124600", kec: "Jenawi", kab: "Kabupaten Karanganyar" },
  "gempolan": { lat: "-7.558320", lon: "111.084530", kec: "Kerjo", kab: "Kabupaten Karanganyar" },
  "kebak": { lat: "-7.638400", lon: "110.964200", kec: "Jumantono", kab: "Kabupaten Karanganyar" },
  "pendem": { lat: "-7.539200", lon: "111.028400", kec: "Mojogedang", kab: "Kabupaten Karanganyar" },
  "pojok": { lat: "-7.526800", lon: "111.014500", kec: "Mojogedang", kab: "Kabupaten Karanganyar" },

  // Kabupaten Kebumen
  "tlogosari": { lat: "-7.625124", lon: "109.684125", kec: "Ayah", kab: "Kabupaten Kebumen" },
  "karanggayam": { lat: "-7.585210", lon: "109.612450", kec: "Karanggayam", kab: "Kabupaten Kebumen" },
  "aditirto": { lat: "-7.683412", lon: "109.641238", kec: "Pejagoan", kab: "Kabupaten Kebumen" },
  "seboro": { lat: "-7.524600", lon: "109.718500", kec: "Sadang", kab: "Kabupaten Kebumen" },

  // Kabupaten Magelang
  "baleagung": { lat: "-7.391520", lon: "110.312050", kec: "Grabag", kab: "Kabupaten Magelang" },
  "ketawang": { lat: "-7.408820", lon: "110.324540", kec: "Grabag", kab: "Kabupaten Magelang" },
  "jati": { lat: "-7.510160", lon: "110.380950", kec: "Sawangan", kab: "Kabupaten Magelang" },
  "jambewangi": { lat: "-7.451824", lon: "110.331825", kec: "Pakis", kab: "Kabupaten Magelang" },
  "genito": { lat: "-7.397820", lon: "110.156540", kec: "Windusari", kab: "Kabupaten Magelang" },
  "tanjungsari": { lat: "-7.422850", lon: "110.133040", kec: "Windusari", kab: "Kabupaten Magelang" },

  // Kabupaten Purbalingga
  "karangcengis": { lat: "-7.431600", lon: "109.428500", kec: "Bukateja", kab: "Kabupaten Purbalingga" },
  "pelumutan": { lat: "-7.468400", lon: "109.371200", kec: "Kemangkon", kab: "Kabupaten Purbalingga" },
  "tlahab kidul": { lat: "-7.258400", lon: "109.336500", kec: "Karangreja", kab: "Kabupaten Purbalingga" },
  "limbangan": { lat: "-7.349200", lon: "109.321800", kec: "Kutasari", kab: "Kabupaten Purbalingga" },
  "lambur": { lat: "-7.331500", lon: "109.354200", kec: "Mrebet", kab: "Kabupaten Purbalingga" },
  "arenan": { lat: "-7.378400", lon: "109.412600", kec: "Kaligondang", kab: "Kabupaten Purbalingga" },
  "pengadegan": { lat: "-7.416200", lon: "109.451800", kec: "Pengadegan", kab: "Kabupaten Purbalingga" },
  "panusupan": { lat: "-7.294600", lon: "109.498200", kec: "Rembang", kab: "Kabupaten Purbalingga" },

  // Kabupaten Purworejo
  "mayungsari": { lat: "-7.612400", lon: "110.048600", kec: "Bener", kab: "Kabupaten Purworejo" },
  "rimun": { lat: "-7.658200", lon: "110.054200", kec: "Loano", kab: "Kabupaten Purworejo" },

  // Kabupaten Sragen
  "bukuran": { lat: "-7.426210", lon: "110.978120", kec: "Kalijambe", kab: "Kabupaten Sragen" },
  "ngebung": { lat: "-7.448600", lon: "110.849200", kec: "Kalijambe", kab: "Kabupaten Sragen" },
  "gabus": { lat: "-7.362140", lon: "111.045230", kec: "Ngrampal", kab: "Kabupaten Sragen" },
  "sambi": { lat: "-7.486200", lon: "111.084600", kec: "Sambirejo", kab: "Kabupaten Sragen" },
  "sigit": { lat: "-7.324800", lon: "111.061500", kec: "Tangen", kab: "Kabupaten Sragen" },

  // Kabupaten Temanggung
  "kembangsari": { lat: "-7.258600", lon: "110.198400", kec: "Kandangan", kab: "Kabupaten Temanggung" },
  "kemiri": { lat: "-7.241200", lon: "110.246800", kec: "Kaloran", kab: "Kabupaten Temanggung" },
  "gentingsari": { lat: "-7.284500", lon: "110.056200", kec: "Bansari", kab: "Kabupaten Temanggung" },
  "dlimoyo": { lat: "-7.239400", lon: "110.068400", kec: "Ngadirejo", kab: "Kabupaten Temanggung" },
  "gondangwinangun": { lat: "-7.251800", lon: "110.074200", kec: "Ngadirejo", kab: "Kabupaten Temanggung" },

  // Kabupaten Wonogiri
  "pulutan wetan": { lat: "-7.896400", lon: "110.864200", kec: "Wuryantoro", kab: "Kabupaten Wonogiri" },
  "gebangharjo": { lat: "-8.041200", lon: "110.812600", kec: "Pracimantoro", kab: "Kabupaten Wonogiri" },
  "sembukan": { lat: "-7.824500", lon: "111.028400", kec: "Sidoharjo", kab: "Kabupaten Wonogiri" },
  "gunan": { lat: "-7.831600", lon: "111.164200", kec: "Slogohimo", kab: "Kabupaten Wonogiri" },
  "sugihan": { lat: "-7.884200", lon: "111.124800", kec: "Jatiroto", kab: "Kabupaten Wonogiri" },

  // Kota Semarang
  "petompon": { lat: "-6.998400", lon: "110.406200", kec: "Gajahmungkur", kab: "Kota Semarang" }
};

export const KABUPATEN_COORDS_FRONTEND = {
  "banjarnegara": { lat: "-7.398700", lon: "109.697400" },
  "banyumas": { lat: "-7.424400", lon: "109.230200" },
  "batang": { lat: "-6.992600", lon: "109.832400" },
  "blora": { lat: "-6.969800", lon: "111.418600" },
  "boyolali": { lat: "-7.536000", lon: "110.596000" },
  "brebes": { lat: "-6.998400", lon: "108.948200" },
  "cilacap": { lat: "-7.516200", lon: "108.924800" },
  "demak": { lat: "-6.894600", lon: "110.638400" },
  "grobogan": { lat: "-7.086400", lon: "110.916200" },
  "jepara": { lat: "-6.588800", lon: "110.668400" },
  "karanganyar": { lat: "-7.596200", lon: "110.952100" },
  "kebumen": { lat: "-7.669800", lon: "109.652100" },
  "kendal": { lat: "-6.982400", lon: "110.184600" },
  "klaten": { lat: "-7.705800", lon: "110.606200" },
  "kudus": { lat: "-6.804800", lon: "110.840600" },
  "magelang": { lat: "-7.585500", lon: "110.297400" },
  "pati": { lat: "-6.755800", lon: "111.038000" },
  "pekalongan": { lat: "-7.026800", lon: "109.618400" },
  "pemalang": { lat: "-6.986200", lon: "109.382400" },
  "purbalingga": { lat: "-7.388500", lon: "109.363800" },
  "purworejo": { lat: "-7.714200", lon: "110.008600" },
  "rembang": { lat: "-6.708600", lon: "111.341600" },
  "semarang": { lat: "-7.148600", lon: "110.428400" },
  "kota semarang": { lat: "-6.993200", lon: "110.420300" },
  "sragen": { lat: "-7.426600", lon: "111.022200" },
  "sukoharjo": { lat: "-7.682400", lon: "110.834200" },
  "tegal": { lat: "-7.018400", lon: "109.142600" },
  "temanggung": { lat: "-7.316400", lon: "110.175800" },
  "wonogiri": { lat: "-7.813600", lon: "110.925400" },
  "wonosobo": { lat: "-7.361400", lon: "109.902600" }
};

