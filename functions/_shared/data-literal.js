// Deliberately small data-literal grammar. Never evaluates JavaScript.
// Accepts quoted/unquoted keys, comments, trailing commas and scalar literals.
export function parseDataLiteral(text) {
    let i = 0;
    const fail = () => { throw new Error('Unsupported data literal at offset ' + i); };
    function space() {
        while (i < text.length) {
            if (/\s/.test(text[i])) { i++; continue; }
            if (text.startsWith('//', i)) { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end + 1; continue; }
            if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); if (end < 0) fail(); i = end + 2; continue; }
            break;
        }
    }
    function string() {
        const quote = text[i++];
        let value = '';
        while (i < text.length) {
            const ch = text[i++];
            if (ch === quote) return value;
            if (ch === '\n' || ch === '\r') fail();
            if (ch !== '\\') { value += ch; continue; }
            const esc = text[i++];
            const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
            if (esc === 'u' || esc === 'x') {
                const size = esc === 'u' ? 4 : 2;
                const hex = text.slice(i, i + size);
                if (!new RegExp('^[0-9a-fA-F]{' + size + '}$').test(hex)) fail();
                value += String.fromCharCode(parseInt(hex, 16)); i += size;
            } else if (esc in escapes) {
                if (esc === '0' && /[0-9]/.test(text[i] || '')) fail();
                value += escapes[esc];
            } else if (esc === '\n') { /* line continuation */ }
            else if (esc === '\r') { if (text[i] === '\n') i++; }
            else if (esc && !/[0-9]/.test(esc)) value += esc;
            else fail();
        }
        fail();
    }
    function value(depth = 0) {
        if (depth > 80) fail();
        space();
        const ch = text[i];
        if (ch === '"' || ch === "'") return string();
        if (ch === '[' || ch === '{') {
            i++;
            const array = ch === '[';
            const close = array ? ']' : '}';
            const result = array ? [] : Object.create(null);
            space();
            while (text[i] !== close) {
                if (array) result.push(value(depth + 1));
                else {
                    space();
                    let key;
                    if (text[i] === '"' || text[i] === "'") key = string();
                    else { const m = /^[a-zA-Z_$][\w$]*/.exec(text.slice(i)); if (!m) fail(); key = m[0]; i += key.length; }
                    if (['__proto__', 'prototype', 'constructor'].includes(key) || Object.hasOwn(result, key)) fail();
                    space(); if (text[i++] !== ':') fail();
                    result[key] = value(depth + 1);
                }
                space();
                if (text[i] === close) break;
                if (text[i++] !== ',') fail();
                space();
            }
            i++; return result;
        }
        const scalar = /^(true|false|null)(?![\w$])/.exec(text.slice(i));
        if (scalar) { i += scalar[0].length; return JSON.parse(scalar[0]); }
        const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
        if (number) { i += number[0].length; const n = Number(number[0]); if (!Number.isFinite(n)) fail(); return n; }
        fail();
    }
    const result = value(); space(); if (i !== text.length) fail(); return result;
}
