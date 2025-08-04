// online-sktorrent-addon.js
// Note: Use Node.js v20.09 LTS for testing (https://nodejs.org/en/blog/release/v20.9.0)
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios"); // Stále potrebujeme axios pre POST požiadavky na Netlify
// const cheerio = require("cheerio"); // Tieto už nepotrebujeme, scraping sa deje na Netlify
// const { decode } = require("entities"); // Tieto už nepotrebujeme, scraping sa deje na Netlify

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.0",
    name: "SKTonline Online Streams (Netlify)", // Aktualizovaný popis pre odlíšenie
    description: "Priame online videá (720p/480p/360p) z online.sktorrent.eu (cez Netlify Function)", // Upravený popis
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "sktonline-movie", name: "SKTonline Filmy" },
        { type: "series", id: "sktonline-series", name: "SKTonline Seriály" }
    ],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

// !!! DÔLEŽITÉ: TÁTO URL MUSÍ BYŤ SPRÁVNE NASTAVENÁ NA TVOJU NETLIFY FUNKCIU !!!
const NETLIFY_SCRAPER_FUNCTION_URL = 'https://sktorrent-scraper-netlify.netlify.app/.netlify/functions/scrape'; 

// Hlavičky pre požiadavky (teraz hlavne pre volanie Netlify funkcie)
const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36',
    'Accept-Encoding': 'identity',
    'Content-Type': 'application/json' // Dôležité pre POST požiadavky s JSON telom
};

// --- Tieto funkcie už nie sú potrebné v tomto addone, pretože scraping robí Netlify funkcia ---
/*
function removeDiacritics(str) {
    return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function shortenTitle(title, wordCount = 3) {
    return title.split(/\s+/).slice(0, wordCount).join(" ");
}

function extractFlags(title) {
    const flags = [];
    if (/\bCZ\b/i.test(title)) flags.push("cz");
    // ... ostatné vlajky
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
    return null; 
}

async function searchOnlineVideos(query) {
    return []; 
}

async function extractStreamsFromVideoId(videoId) {
    return []; 
}
*/
// --- KONIEC ODSTRÁNENÝCH / NEPOUŽÍVANÝCH FUNKCIÍ ---


builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`\n====== [ADDON] 🚀 STREAM požiadavka: type='${type}', id='${id}' ======`);
    const [imdbId, seasonStr, episodeStr] = id.split(":");
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    try {
        // Zavolaj Netlify funkciu
        console.log(`[ADDON] 🌐 Volám Netlify Scraper funkciu s dátami:`, { imdbId, type, season, episode });
        const response = await axios.post(
            NETLIFY_SCRAPER_FUNCTION_URL,
            { imdbId, type, season, episode },
            { headers: commonHeaders }
        );

        console.log(`[ADDON] ✅ Získané streamy z Netlify. Status: ${response.status}`);
        const { streams } = response.data;

        if (!streams || streams.length === 0) {
            console.log("[ADDON] 🤷‍♂️ Žiadne streamy nájdené cez Netlify funkciu.");
        } else {
            console.log(`[ADDON] 🎉 Našiel som ${streams.length} streamov cez Netlify funkciu.`);
        }

        return { streams: streams };

    } catch (error) {
        console.error("[ADDON ERROR] ❌ Chyba pri volaní Netlify Scraper funkcie:", error.message);
        if (error.response) {
            console.error("[ADDON ERROR] Status Netlify response:", error.response.status);
            console.error("[ADDON ERROR] Data Netlify response:", error.response.data);
        }
        return { streams: [] }; // Vráti prázdne streamy v prípade chyby
    }
});

builder.defineCatalogHandler(async ({ type, id }) => {
    console.log(`[ADDON] 📚 Katalóg požiadavka pre typ='${type}' id='${id}'`);
    // Pre tento addon zatiaľ nepoužívame katalógy na priame zobrazovanie videí.
    // Katalógy sú tu len pre to, aby sa addon zobrazil v Stremio UI.
    return { metas: [] };
});

console.log("📦 Manifest:", builder.getInterface().manifest);
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 }); // Použi port z premennej prostredia alebo 7000
console.log(`🚀 SKTonline Online addon beží na porte ${process.env.PORT || 7000}`);
