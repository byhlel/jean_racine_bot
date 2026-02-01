const logger = require('../utils/signale')
const url = require('url')
const { curly } = require('node-libcurl')
const { pause } = require('../utils/util')

logger.log('cURL instantiated with Anti-Ban protection')

// --- Configuration des limites Root-Me ---
let activeConnections = 0;
const MAX_SIMULTANEOUS = 20; // Seuil de sécurité (Max 25 autorisé)
const MIN_DELAY_BETWEEN_REQS = 250; // Max 4 requêtes/sec pour rester discret
let lastRequestTime = Date.now();

const getRandom = () => {
    return Math.random().toString(36).replace(/[^a-z]+/g, '').slice(0, 5)
}

const getCookie = () => {
    if (process.env.API_KEY_FIRST) return `api_key=${process.env.API_KEY_FIRST}`
    else if (process.env.SPIP_SESSION) return `spip_session=${process.env.SPIP_SESSION}`
    else return `api_key=${process.env.API_KEY}`
}

const HEADERS_OBJ = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'cookie': `msg_history=explication_site_multilingue%3B; ${getCookie()}`
}

const baseUrl = process.env.ROOTME_API_URL ? process.env.ROOTME_API_URL.replace(/https?:\/\//, '') : 'api.www.root-me.org'

const get = async (pathname, options) => {
    // 1. Limitation de la simultanéité (Max 25 TCP)
    while (activeConnections >= MAX_SIMULTANEOUS) {
        await pause(200);
    }

    // 2. Limitation du débit (Max 25 requêtes / sec)
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_DELAY_BETWEEN_REQS) {
        await pause(MIN_DELAY_BETWEEN_REQS - timeSinceLast);
    }

    activeConnections++;
    lastRequestTime = Date.now();

    options ||= {}
    options.params ||= {}
    let hostname = baseUrl;

    // Suppression du hack %2E%2E (qui déclenche les 401/403 du WAF moderne)
    const s = url.format({
        hostname,
        pathname: pathname || undefined,
        protocol: 'https:',
        query: options.params
    }).toString()

    const optionalHeaders = options?.headers || {}
    const tmpHeaders = { ...HEADERS_OBJ, ...optionalHeaders }
    const headers = Object.entries(tmpHeaders).map(([k, v]) => `${k}: ${v}`)

    const opts = {
        timeoutMs: process.env.TIMEOUT_MS || 10000,
        followLocation: true,
        httpHeader: headers
    }

    try {
        const { statusCode, data } = await curly.get(s, opts);
        activeConnections--;

        if (statusCode !== 200) {
            if (statusCode === 429) {
                logger.warn('Rate limit 429 : Pause de 15 secondes...');
                await pause(15000);
            }
            if (statusCode === 35 || statusCode === 403) {
                logger.error(`ALERTE BAN (${statusCode}) : Pare-feu Root-Me activé.`);
                logger.warn('Pause obligatoire de 5 minutes. Ne pas interrompre le bot.');
                await pause(1000 * 60 * 5 + 10000);
            }
            throw { code: statusCode };
        }
        return { data, statusCode };

    } catch (e) {
        activeConnections--;
        // Gestion des erreurs réseau (Connection reset by peer)
        if (e.code === 35 || e.code === 56 || (e.message && e.message.includes('reset by peer'))) {
            logger.error('Connexion réinitialisée par Root-Me (Ban 5 min probable)');
            await pause(1000 * 60 * 5 + 10000);
            return await get(pathname, options); // Tentative de reprise après pause
        }
        throw e;
    }
}

module.exports = { get }
