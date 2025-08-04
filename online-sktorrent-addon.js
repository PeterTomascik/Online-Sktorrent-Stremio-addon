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

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36',
    'Accept-Encoding': 'identity'
};

// --- NOVÉ KONŠTANTY PRE PROXY (ZAČIATOK ZMENY) ---
const PROXY_KEY = '205111'; // *** SEM NAHRAĎ SVOJ SKUTOČNÝ KĽÚČ Z corsproxy.io ***
const PROXY_BASE_URL = 'https://corsproxy.io/?'; 
// --- NOVÉ KONŠTANTY PRE PROXY (KONIEC ZMENY) ---


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
    // --- ZMENA PRE PROXY (ZAČIATOK ZMENY) ---
    const proxiedSearchUrl = `${PROXY_BASE_URL}key=${PROXY_KEY}&url=${encodeURIComponent(originalSearchUrl)}`;
    console.log(`[INFO] 🔍 Hľadám '${query}' na ${proxiedSearchUrl} (cez proxy)`);
    // --- ZMENA PRE PROXY (KONIEC ZMENY) ---

    try {
        // Použi proxiedSearchUrl pre axios požiadavku
        const res = await axios.get(proxiedSearchUrl, { headers: commonHeaders }); 
        console.log(`[DEBUG] Status: ${res.status}`);
        console.log(`[DEBUG] HTML Snippet:`, res.data.slice(0, 300));

        const $ = cheerio.load(res.data);
        const links = [];
        $("a[href^='/video/']").each((i, el) => {
            const href = $(el).attr("href");
            if (href) {
                const match = href.match(/\/video\/(\d+)/);
                if (match) links.push(match[1]);
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
    // --- ZMENA PRE PROXY (ZAČIATOK ZMENY) ---
    const proxiedUrl = `${PROXY_
