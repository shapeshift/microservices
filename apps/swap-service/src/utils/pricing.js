"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssetPriceUsd = getAssetPriceUsd;
exports.calculateUsdValue = calculateUsdValue;
const axios_1 = __importDefault(require("axios"));
const caip_1 = require("@shapeshiftoss/caip");
// Simple in-memory cache
const priceCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
async function getAssetPriceUsd(asset) {
    const cacheKey = asset.assetId;
    // Check cache
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.price;
    }
    try {
        // Use CAIP adapters to dynamically get CoinGecko URL for any supported asset
        const url = caip_1.adapters.makeCoingeckoAssetUrl(asset.assetId);
        if (!url) {
            console.warn(`No CoinGecko URL mapping for assetId: ${asset.assetId}`);
            return null;
        }
        // Fetch price from CoinGecko
        const { data } = await axios_1.default.get(url, {
            timeout: 5000,
        });
        const price = data?.market_data?.current_price?.usd || null;
        if (price !== null) {
            // Cache the result
            priceCache.set(cacheKey, { price, timestamp: Date.now() });
            return price;
        }
        else {
            console.warn(`No price data found for ${asset.assetId} (symbol: ${asset.symbol})`);
            return null;
        }
    }
    catch (error) {
        console.error(`Failed to fetch price for ${asset.assetId}:`, error);
        return null;
    }
}
function calculateUsdValue(cryptoAmount, priceUsd) {
    try {
        const amount = parseFloat(cryptoAmount);
        if (isNaN(amount))
            return '0';
        const usdValue = amount * priceUsd;
        return usdValue.toFixed(2);
    }
    catch (error) {
        console.error('Failed to calculate USD value:', error);
        return '0';
    }
}
