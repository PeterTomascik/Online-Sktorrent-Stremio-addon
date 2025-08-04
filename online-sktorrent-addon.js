// online-sktorrent-addon.js
// Note: Use Node.js v20.09 LTS for testing (https://nodejs.org/en/blog/release/v20.9.0)
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.0",
    name: "SKTonline Online Streams",
    description: "Priame online videá (720p/480p/360p) z online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "sktonline-movie", name: "SKTonline Filmy" },
        { type: "series", id: "sktonline-series", name: "SKTonline Seriály" }
    ],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

// --- NOVÉ KONŠTANTY PRE PROXY (OPRAVENÁ LOGIKA) ---
const PROXY_KEY = '205111'; // *** SEM NAHRAĎ SVOJ SKUTOČNÝ KĽÚČ ***
const PROXY_BASE_URL = 'https://corsproxy.io/?'; 
// --- NOVÉ KONŠTANTY PRE PROXY (KONIEC OPRAVY) ---

// Hlavičky sa teraz rozšíria o x-corsproxy-key
const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36',
    'Accept-Encoding': 'identity',
    'x-corsproxy-key': PROXY_KEY // <--- PRIDANÉ: Kľúč ako hlavička pre corsproxy.io
};


function removeDiacritics(str) {
    return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function shortenTitle(title, wordCount = 3) {
    return title.split(/\s+/).slice(0, wordCount).join(" ");
}

function extractFlags(title) {
    const flags = [];
    if (/\bCZ\b/i.test(title)) flags.push("cz");
    if (/\bSK\b/i.test(title)) flags.push("sk");
    if (/\bEN\b/i.test(title)) flags.push("en");
    if (/\bHU\b/i.test(title)) flags.push("hu");
    if (/\bDE\b/i.test(title)) flags.push("de");
    if (/\bFR\b/i.test(title)) flags.push("fr");
    if (/\bIT\b/i.test(title)) flags.push("it");
    if (/\bES\b/i.test(title)) flags.push("es");
    if (/\bRU\b/i.test(title)) flags.push("ru");
    if (/\bPL\b/i.test(title)) flags.push("pl");
    if (/\bJP\b/i.test(title)) flags.push("jp");
    if (/\bCN\b/i.test(title)) flags.push("cn");
    return flags;
}

function formatTitle(label) {
    const qualityIcon = /720p|HD/i.test(label) ? "🟦 HD (720p)" :
                        /480p|SD/i.test(label) ? "🟨 SD (480p)" :
                        /360p|LD/i.test(label) ? "🟥 LD (360p)" : label;
    return `SKTonline ${qualityIcon}`;
}

function formatName(fullTitle, flagsArray) {
    const flagIcons = {
        cz: "🇨🇿", sk: "🇸🇰", en: "🇬🇧", hu: "🇭🇺", de: "🇩🇪", fr: "🇫🇷",
        it: "🇮🇹", es: "🇪🇸", ru: "🇷🇺", pl: "🇵🇱", jp: "🇯🇵", cn: "🇨🇳"
    };
    const iconStr = flagsArray.map(f => flagIcons[f]).filter(Boolean).join(" ");
    return fullTitle + "\n⚙️SKTonline" + (iconStr ? "\n" + iconStr : "");
}

async function getTitleFromIMDb(imdbId) {
    try {
        const url = `https://www.imdb.com/title/${imdbId}/`;
        console.log(`[DEBUG] 🌐 IMDb Request: ${url}`);
        const res = await axios.get(url, { headers: commonHeaders });

        if (res.status === 404) {
            console.error("[ERROR] IMDb scraping zlyhal: stránka neexistuje (404)");
            return null;
        }

        const $ = cheerio.load(res.data);
        const titleRaw = $('title').text().split(' - ')[0].trim();
        const title = decode(titleRaw);
        const ldJson = $('script[type="application/ld+json"]').html();
        let originalTitle = title;
        if (ldJson) {
            const json = JSON.parse(ldJson);
            if (json && json.name) originalTitle = decode(json.name.trim());
        }

        console.log(`[DEBUG] 🎬 IMDb title: ${title}, original: ${originalTitle}`);
        return { title, originalTitle };
    } catch (err) {
        console.error("[ERROR] IMDb scraping zlyhal:", err.message);
        return null;
    }
}

async function searchOnlineVideos(query) {
    const originalSearchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
    // --- ZMENA PRE PROXY (OPRAVENÁ LOGIKA) ---
    // Teraz posielame iba zakódovanú cieľovú URL ako parameter 'url'
    const proxiedSearchUrl = `${PROXY_BASE_URL}url=${encodeURIComponent(originalSearchUrl)}`;
    console.log(`[INFO] 🔍 Hľadám '${query}' na ${proxiedSearchUrl} (cez proxy)`);
    // --- ZMENA PRE PROXY (KONIEC OPRAVY) ---

    try {
        // Axios automaticky pridá hlavičky z 'commonHeaders', vrátane 'x-corsproxy-key'
        const res = await axios.get(proxiedSearchUrl, { headers: commonHeaders }); 
        console.log(`[DEBUG] Status: ${res.status}`);
        // Zväčšujeme dĺžku HTML snipppetu
        console.log(`[DEBUG] HTML Snippet (first 5000 chars):`, res.data.slice(0, 5000)); 

        const $ = cheerio.load(res.data);
        const links = [];
        
        // Vyberáme všetky A tagy, ktoré majú href začínajúci na '/video/'
        // A ktoré majú v sebe aj span.video-title (aby sme odfiltrovali iné irelevantné linky)
        $("a[href^='/video/']:has(span.video-title)").each((i, el) => {
            const href = $(el).attr("href");
            if (href) {
                // Skúsime extrahovať ID videa priamo z URL
                const match = href.match(/\/video\/(\d+)/); 
                if (match && match[1]) {
                    links.push(match[1]);
                    console.log(`[DEBUG]   Found video link: ${href}, Extracted ID: ${match[1]}`); // Nový log
                } else {
                    console.log(`[DEBUG]   Found link, but could not extract ID from: ${href}`); // Nový log
                }
            }
        });
        
        console.log(`[INFO] 📺 Nájdených videí: ${links.length}`);
        return links;
    } catch (err) {
        console.error("[ERROR] ❌ Vyhľadávanie online videí zlyhalo:", err.message);
        return [];
    }
}

async function extractStreamsFromVideoId(videoId) {
    const originalUrl = `https://online.sktorrent.eu/video/${videoId}`;
    // --- ZMENA PRE PROXY (OPRAVENÁ LOGIKA) ---
    // Teraz posielame iba zakódovanú cieľovú URL ako parameter 'url'
    const proxiedUrl = `${PROXY_BASE_URL}url=${encodeURIComponent(originalUrl)}`;
    console.log(`[DEBUG] 🔎 Načítavam detaily videa: ${proxiedUrl} (cez proxy)`);
    // --- ZMENA PRE PROXY (KONIEC OPRAVY) ---

    try {
        // Axios automaticky pridá hlavičky z 'commonHeaders', vrátane 'x-corsproxy-key'
        const res = await axios.get(proxiedUrl, { headers: commonHeaders });
        console.log(`[DEBUG] Status: ${res.status}`);
        // Zväčšujeme dĺžku HTML snipppetu aj pre detaily videa
        console.log(`[DEBUG] Detail HTML Snippet (first 5000 chars):`, res.data.slice(0, 5000));

        const $ = cheerio.load(res.data);
        const sourceTags = $('video source');
        const titleText = $('title').text().trim();
        const flags = extractFlags(titleText);

        const streams = [];
        sourceTags.each((i, el) => {
            let src = $(el).attr('src');
            const label = $(el).attr('label') || 'Unknown';
            if (src && src.endsWith('.mp4')) {
                src = src.replace(/([^:])\/\/+/, '$1/');
                console.log(`[DEBUG] 🎞️ ${label} stream URL: ${src}`);
                streams.push({
                    title: formatName(titleText, flags),
                    name: formatTitle(label),
                    url: src
                });
            }
        });

        console.log(`[INFO] ✅ Našiel som ${streams.length} streamov pre videoId=${videoId}`);
        return streams;
    } catch (err) {
        console.error("[ERROR] ❌ Chyba pri načítaní detailu videa:", err.message);
        return [];
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`\n====== 🎮 STREAM požiadavka: type='${type}', id='${id}' ======`);
    const [imdbId, seasonStr, episodeStr] = id.split(":");
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    const titles = await getTitleFromIMDb(imdbId);
    if (!titles) return { streams: [] };

    const { title, originalTitle } = titles;
    const queries = new Set();

    const baseTitles = [title, originalTitle].map(t => t.replace(/\(.*?\)/g, '').trim());
    for (const base of baseTitles) {
        const noDia = removeDiacritics(base);
        const short = shortenTitle(noDia);
        const short1 = shortenTitle(noDia, 1);

        if (type === 'series' && season && episode) {
            const epTag1 = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
            const epTag2 = `${season}x${episode}`;
            [base, noDia, short, short1].forEach(b => {
                queries.add(`${b} ${epTag1}`);
                queries.add(`${b} ${epTag2}`);
            });
        } else {
            [base, noDia, short].forEach(b => {
                queries.add(b);
            });
        }
    }

    let allStreams = [];
    let attempt = 1;
    for (const q of queries) {
        console.log(`[DEBUG] 🔍 Pokus ${attempt++}: '${q}'`);
        const videoIds = await searchOnlineVideos(q);
        for (const vid of videoIds) {
            const streams = await extractStreamsFromVideoId(vid);
            allStreams.push(...streams);
        }
        if (allStreams.length > 0) break;
    }

    console.log(`[INFO] 📤 Odosielam ${allStreams.length} streamov do Stremio`);
    return { streams: allStreams };
});

builder.defineCatalogHandler(async ({ type, id }) => { // Pridáme 'async' pre správne fungovanie Promise
    console.log(`[DEBUG] 📚 Katalóg požiadavka pre typ='${type}' id='${id}'`);
    return { metas: [] };
});

console.log("📦 Manifest:", builder.getInterface().manifest);
serveHTTP(builder.getInterface(), { port: 7000 });
console.log("🚀 SKTonline Online addon beží na http://localhost:7000/manifest.json");
