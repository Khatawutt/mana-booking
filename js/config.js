
/* ============ SETTINGS (edit here) ============
   API_URL = the Google Apps Script Web App (Deploy > Manage deployments > Web app URL, ends with /exec).
   The page calls it as a JSON API: GET ?api=availability..., POST (text/plain JSON) {api:'submit',...}. */
var API_URL = 'https://script.google.com/macros/s/AKfycbzQEwAnSvDTyj1Yfk2EWAEYtifJ1vk4eHhF14RvDHGtGJFPTgDcgUL4-msfKckN0sifNw/exec';
var DATA_URL = { garden: 'data/garden.json', ratch: 'data/ratch.json' };   // menu + branch settings
var QR_URL = 'assets/mana-qr.jpg';
var AVAIL_TIMEOUT_MS = 20000;   // Apps Script can take a few seconds when cold
var SUBMIT_TIMEOUT_MS = 60000;  // writes the sheet + sends LINE
/* logos / icons per branch (files in assets/) */
var BRANDS = {
  garden: { logo: 'assets/logo-garden.webp', mark: 'assets/mark-garden.webp', favicon: 'assets/favicon-garden.png', apple: 'assets/apple-touch-garden.png', og: 'assets/og-garden.png', theme: '#0b1b15' },
  ratch:  { logo: 'assets/logo-ratch.webp',  mark: 'assets/mark-ratch.webp',  favicon: 'assets/favicon-ratch.png',  apple: 'assets/apple-touch-ratch.png',  og: 'assets/og-ratch.png',  theme: '#0b1b15' }
};
