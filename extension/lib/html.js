const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e]);

// 12500 -> "12 500 грн" (non-breaking spaces, so the price never wraps).
export const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} грн`;

export const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
