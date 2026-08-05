import { lookup } from 'dns';
import { promisify } from 'util';
const lookupAsync = promisify(lookup);

const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0', 'metadata.google.internal'];

export async function isSSRF(urlString) {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    if (BLOCKED_HOSTNAMES.includes(url.hostname)) return true;
    
    // Resolve DNS and check for internal IPs
    const { address } = await lookupAsync(url.hostname);
    const parts = address.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    
    return false;
  } catch (e) {
    return true; // Invalid URL
  }
}

export function isValidUrl(urlString) {
  try {
    new URL(urlString);
    return true;
  } catch (e) {
    return false;
  }
}
