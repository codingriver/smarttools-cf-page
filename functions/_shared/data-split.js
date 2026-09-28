import { parseDataLiteral } from './data-literal.js';
const SPLIT_VERSION = 'v1';

export function nsSplitKeys(ns) {
    return {
        mode: `${ns}:split:${SPLIT_VERSION}`,
        sectionsMeta: `${ns}:sections_meta`,
        snapshot: `${ns}:data_snapshot`,
        sectionPrefix: `${ns}:section:`
    };
}

export function sectionStorageKey(ns, key) {
    return `${ns}:section:${key}`;
}

function findMatchingBracket(src, openIdx, openChar, closeChar) {
    let depth = 0;
    let quote = null;
    let escape = false;
    let lineComment = false;
    let blockComment = false;
    for (let i = openIdx; i < src.length; i++) {
        const ch = src[i];
        const next = src[i + 1];
        if (lineComment) {
            if (ch === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === '*' && next === '/') { blockComment = false; i++; }
            continue;
        }
        if (quote) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitTopLevelItems(src) {
    const items = [];
    let start = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let depthParen = 0;
    let quote = null;
    let escape = false;
    let lineComment = false;
    let blockComment = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        const next = src[i + 1];
        if (lineComment) {
            if (ch === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === '*' && next === '/') { blockComment = false; i++; }
            continue;
        }
        if (quote) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depthBrace++;
        else if (ch === '}') depthBrace--;
        else if (ch === '[') depthBracket++;
        else if (ch === ']') depthBracket--;
        else if (ch === '(') depthParen++;
        else if (ch === ')') depthParen--;
        else if (ch === ',' && depthBrace === 0 && depthBracket === 0 && depthParen === 0) {
            const item = src.slice(start, i).trim();
            if (item) items.push(item);
            start = i + 1;
        }
    }
    const tail = src.slice(start).trim();
    if (tail) items.push(tail);
    return items;
}

// Locate the declaration in code, never in a comment or quoted string.
function sectionsDeclaration(text) {
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') { i++; continue; }
            if (ch === quote) quote = null;
            continue;
        }
        if (text.startsWith('//', i)) { const end = text.indexOf('\n', i); if (end < 0) return null; i = end; continue; }
        if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); if (end < 0) return null; i = end + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === 'v' && (i === 0 || !/[\w$.]/.test(text[i - 1]))) {
            const match = /^var\s+sections\s*=\s*\[/.exec(text.slice(i));
            if (match) { match.index = i; return match; }
        }
    }
    return null;
}

export function extractSectionsFromDataJs(content) {
    const text = String(content || '');
    const m = sectionsDeclaration(text);
    if (!m) return null;
    const varStart = m.index;
    const arrayStart = m.index + m[0].lastIndexOf('[');
    const arrayEnd = findMatchingBracket(text, arrayStart, '[', ']');
    if (arrayEnd < 0) return null;
    let stmtEnd = arrayEnd + 1;
    while (stmtEnd < text.length && /\s/.test(text[stmtEnd])) stmtEnd++;
    if (text[stmtEnd] === ';') stmtEnd++;
    const before = text.slice(0, varStart).replace(/\s+$/, '');
    const after = text.slice(stmtEnd).replace(/^\s+/, '');
    const body = text.slice(arrayStart + 1, arrayEnd);
    const items = splitTopLevelItems(body);
    return { before, after, items, body };
}

function extractStringProp(src, prop) {
    const re = new RegExp("(?:^|[^\\w$])" + prop + "\\s*:\\s*(['\"])([\\s\\S]*?)\\1");
    const m = re.exec(src);
    return m ? m[2] : null;
}

function extractBooleanProp(src, prop, fallback = false) {
    const re = new RegExp("(?:^|[^\\w$])" + prop + "\\s*:\\s*(true|false)\\b");
    const m = re.exec(src);
    return m ? m[1] === 'true' : fallback;
}

export function sectionKeyFromItem(item) {
    try { return parseDataLiteral(item).key || null; }
    catch { return extractStringProp(item, 'key'); }
}

export function metaFromSectionItem(item) {
    try {
        const section = parseDataLiteral(item);
        if (!section.key) return null;
        return { ...section, cards: undefined };
    } catch {}
    const key = sectionKeyFromItem(item);
    if (!key) return null;
    const label = extractStringProp(item, 'label') || key;
    const kind = extractStringProp(item, 'kind') || 'card';
    const anchor = extractStringProp(item, 'anchor') || '';
    return {
        key,
        label,
        kind,
        anchor,
        visible: extractBooleanProp(item, 'visible', true),
        dynamic: extractBooleanProp(item, 'dynamic', false),
        private: extractBooleanProp(item, 'private', false)
    };
}

export function isLegacyEncryptedSectionItem(item) {
    try {
        const s = parseDataLiteral(item);
        return s.encrypted === true || s.locked === true || Object.hasOwn(s, 'enc') || Object.hasOwn(s, '_enc');
    } catch {}
    const source = String(item || '');
    return /\bencrypted\s*:\s*true\b/.test(source)
        || /(?:^|[,\{])\s*(?:enc|_enc)\s*:/.test(source)
        || /\blocked\s*:\s*true\b/.test(source);
}

export function parseSectionItems(content) {
    const parsed = extractSectionsFromDataJs(content);
    if (!parsed) return null;
    const sectionMap = Object.create(null);
    const sectionsMeta = [];
    for (const item of parsed.items) {
        const key = sectionKeyFromItem(item);
        if (!key || sectionMap[key]) continue;
        sectionMap[key] = item;
        const meta = metaFromSectionItem(item);
        if (meta) sectionsMeta.push(meta);
    }
    return { ...parsed, sectionMap, sectionsMeta };
}

function pretty(val, indent = 0) {
    const pad = '    '.repeat(indent);
    const pad1 = '    '.repeat(indent + 1);
    if (Array.isArray(val)) {
        if (!val.length) return '[]';
        return '[\n' + val.map(v => pad1 + pretty(v, indent + 1)).join(',\n') + '\n' + pad + ']';
    }
    if (val !== null && typeof val === 'object') {
        const keys = Object.keys(val).filter(k => val[k] !== undefined);
        if (!keys.length) return '{}';
        return '{\n' + keys.map(k => {
            const ks = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
            return pad1 + ks + ': ' + pretty(val[k], indent + 1);
        }).join(',\n') + '\n' + pad + '}';
    }
    if (typeof val === 'string') {
        return "'" + val.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '') + "'";
    }
    return String(val);
}

export function normalizeSectionMeta(meta) {
    const key = String(meta && meta.key || '').trim();
    if (!key) return null;
    const out = {
        key,
        kind: String(meta.kind || 'card'),
        dynamic: meta.dynamic === true,
        label: String(meta.label || key),
        visible: meta.visible !== false
    };
    if (meta.anchor) out.anchor = String(meta.anchor);
    if (meta.private === true) out.private = true;
    return out;
}

export function renderSectionItem(meta, cards) {
    const sec = normalizeSectionMeta(meta);
    if (!sec) throw new Error('section key is required');
    return pretty({ ...meta, ...sec, cards: Array.isArray(cards) ? cards : [] }, 1);
}

export function renderDataJsFromSectionItems(baseParts, sectionsMeta, sectionMap) {
    const lines = ['var sections = ['];
    const orderedMeta = Array.isArray(sectionsMeta) ? sectionsMeta : [];
    const used = new Set();
    orderedMeta.forEach((rawMeta, idx) => {
        const meta = normalizeSectionMeta(rawMeta);
        if (!meta || used.has(meta.key)) return;
        const item = sectionMap[meta.key];
        if (!item) return;
        used.add(meta.key);
        lines.push('    // ==================== ' + String(meta.label || meta.key).replace(/[\r\n\u2028\u2029]/g, ' ') + ' ====================');
        lines.push('    ' + item + (idx === orderedMeta.length - 1 ? '' : ','));
    });
    if (lines.length > 1 && lines[lines.length - 1].endsWith(',')) {
        lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
    }
    lines.push('];');
    const before = baseParts && baseParts.before ? baseParts.before.replace(/\s+$/, '') + '\n\n' : '';
    const after = baseParts && baseParts.after ? '\n' + baseParts.after.replace(/^\s+/, '') : '';
    return before + lines.join('\n') + '\n' + after;
}

function filterSectionContent(content, predicate) {
    const parsed = parseSectionItems(content);
    if (!parsed) return String(content || '');
    const keptMeta = [];
    const keptMap = Object.create(null);
    for (const meta of parsed.sectionsMeta) {
        const item = parsed.sectionMap[meta.key];
        if (!item || !predicate(meta, item)) continue;
        keptMeta.push(meta);
        keptMap[meta.key] = item;
    }
    if (keptMeta.length === parsed.sectionsMeta.length) return String(content || '');
    return renderDataJsFromSectionItems(parsed, keptMeta, keptMap);
}

// 旧密文明确不兼容：保存或恢复时直接丢弃整个旧加密分类。
export function discardLegacyEncryptedSections(content) {
    return filterSectionContent(content, (_meta, item) => !isLegacyEncryptedSectionItem(item));
}

// 匿名访问只得到公开分类；旧密文也永远不会下发。
export function stripPrivateSections(content) {
    // Do not return the original source when unsupported/duplicate sections were
    // skipped by the legacy source splitter: that could include a Private item.
    try {
        const parts = extractSectionsFromDataJs(content);
        if (!parts) throw new Error('Missing sections');
        const sections = parseDataLiteral('[' + parts.body + '\n]');
        const keys = new Set();
        for (const section of sections) {
            if (!section || typeof section.key !== 'string' || !section.key || keys.has(section.key)) throw new Error('Invalid sections');
            keys.add(section.key);
        }
    } catch { return 'var sections = [];\n'; }
    return filterSectionContent(content, (meta, item) => {
        // Unknown executable data cannot be proven public: fail closed.
        try { return parseDataLiteral(item).private !== true && !isLegacyEncryptedSectionItem(item); }
        catch { return false; }
    });
}

export async function readSplitSnapshot(env, ns) {
    if (!env.FAV_KV) return null;
    const keys = nsSplitKeys(ns);
    try {
        const [mode, snapshot] = await Promise.all([
            env.FAV_KV.get(keys.mode),
            env.FAV_KV.get(keys.snapshot)
        ]);
        if (mode === SPLIT_VERSION && snapshot) return snapshot;
    } catch {}
    return null;
}

export async function writeSplitFromContent(env, ns, content, previousContent = null) {
    if (!env.FAV_KV) return { ok: false, reason: 'missing-kv' };
    content = discardLegacyEncryptedSections(content);
    const parsed = parseSectionItems(content);
    if (!parsed) return { ok: false, reason: 'no-sections' };
    const keys = nsSplitKeys(ns);
    const writes = [
        env.FAV_KV.put(keys.mode, SPLIT_VERSION),
        env.FAV_KV.put(keys.sectionsMeta, JSON.stringify(parsed.sectionsMeta)),
        env.FAV_KV.put(keys.snapshot, content)
    ];
    parsed.sectionsMeta.forEach(meta => {
        writes.push(env.FAV_KV.put(sectionStorageKey(ns, meta.key), parsed.sectionMap[meta.key]));
    });
    // Delete removed groups in the same persistence pass, never write a key twice.
    const previous = previousContent ? parseSectionItems(previousContent) : null;
    for (const meta of previous?.sectionsMeta || []) {
        if (!Object.hasOwn(parsed.sectionMap, meta.key)) writes.push(env.FAV_KV.delete(sectionStorageKey(ns, meta.key)));
    }
    await Promise.all(writes);
    return { ok: true, sections: parsed.sectionsMeta.length };
}

// Build only. The save handler validates/backups the final content before persisting it once.
export function prepareSectionDelta(baseContent, payload) {
    const parsed = parseSectionItems(baseContent);
    if (!parsed) throw new Error('当前数据不是 sections 格式，无法分类级保存');
    const sectionMap = { ...parsed.sectionMap };
    const deleted = Array.isArray(payload.deletedSectionKeys) ? payload.deletedSectionKeys.map(String) : [];
    deleted.forEach(key => { delete sectionMap[key]; });
    const changed = Array.isArray(payload.changedSections) ? payload.changedSections : [];
    for (const item of changed) {
        const meta = normalizeSectionMeta(item && (item.meta || item));
        if (!meta) continue;
        let original = {};
        if (sectionMap[meta.key]) {
            try { original = parseDataLiteral(sectionMap[meta.key]); } catch {}
        }
        sectionMap[meta.key] = renderSectionItem({ ...original, ...(item.meta || item), ...meta, private: meta.private === true }, item.cards);
    }
    const sectionsMeta = (Array.isArray(payload.sectionsMeta) ? payload.sectionsMeta : parsed.sectionsMeta)
        .map(normalizeSectionMeta)
        .filter(Boolean)
        .filter(meta => sectionMap[meta.key]);
    if (!changed.length && !deleted.length
        && JSON.stringify(sectionsMeta) === JSON.stringify(parsed.sectionsMeta.map(normalizeSectionMeta))) {
        return { content: baseContent, changedCount: 0, deletedCount: 0, sectionCount: sectionsMeta.length };
    }
    const content = renderDataJsFromSectionItems(parsed, sectionsMeta, sectionMap);
    return { content, changedCount: changed.length, deletedCount: deleted.length, sectionCount: sectionsMeta.length };
}
