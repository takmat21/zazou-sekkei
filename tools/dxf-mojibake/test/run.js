// DXF の文字化けを直す道具の試験（node で回す）： node tools/dxf-mojibake/test/run.js
//   1. 正しい DXF を壊さない（日本語・半角カナ・西欧語・ロシア語・ギリシャ語・記号。$DWGCODEPAGE が中身と矛盾しなければ信じる）
//   2. 化けた DXF を直せる（文字コードの食い違い・縺繧型・ã型・ƒ型・二重の化け・\U+XXXX・\M+1XXXX・混ざった物・BOM・長い MTEXT）
//   3. 元のバイトが欠けた物は、正しく戻せた物だけ直し、ほかは「直せませんでした」に出す（まちがった字を入れない）
//   4. 書き出し（Jw_cad 向け R12・Shift_JIS／AutoCAD 向け）を読み直して、文字と形が合う
//   5. 図面に書かれそうな文 400 あまりを化けさせて戻す（コーパス）
// 環境変数 DXFMOJI_OUT にフォルダを入れると、書き出した DXF をそこに残す（ほかの CAD・ライブラリで開いて確かめる用）。
'use strict';
const fs = require('fs'), path = require('path');
const M = require('../dxfmoji.js');
const FIX = path.join(__dirname, 'fixtures');
const OUT = process.env.DXFMOJI_OUT || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });

let nOk = 0, nNg = 0; const fails = [];
function rec(group, name, ok, detail) {
  if (ok) nOk++; else { nNg++; fails.push(`${group}｜${name}｜${detail || ''}`); }
  console.log(`${ok ? '○' : '×'} ${group}｜${name}${detail ? '｜' + detail : ''}`);
}

// ------------------------------------------------------------ 化けを作る道具
const te = new TextEncoder();
const u8 = s => te.encode(s);
const sj = s => { const b = M.encodeSJ(s); if (!b) throw new Error('Shift_JIS に無い字: ' + s); return new Uint8Array(b); };
const from1252 = b => M.looseDecode(b, 'cp1252');                       // cp1252 に無い 5 つは同じ番号の字（ブラウザなどの読み方）
const mojiA = s => M.strictDecode(u8(s), 'cp932');                      // UTF-8 を Shift_JIS で読んだ（戻せる物だけ。だめなら null）
const mojiAlossy = s => M.looseDecode(u8(s), 'cp932');                  // 同じ。読めないバイトは「�」
const mojiB = s => from1252(u8(s));                                     // UTF-8 を cp1252 で読んだ
const mojiC = s => from1252(sj(s));                                     // Shift_JIS を cp1252 で読んだ
const sbEnc = {};
function singleByteEncoder(enc) {
  if (sbEnc[enc]) return sbEnc[enc];
  const m = new Map(); const d = new TextDecoder({ cp1250: 'windows-1250', cp1251: 'windows-1251', cp1252: 'windows-1252', cp1253: 'windows-1253' }[enc]);
  for (let b = 0; b < 256; b++) { const c = d.decode(new Uint8Array([b])); if (c !== '�' && !m.has(c)) m.set(c, b); }
  return (sbEnc[enc] = s => new Uint8Array([...s].map(c => { if (!m.has(c)) throw new Error(enc + ' に無い字: ' + c); return m.get(c); })));
}
function encodeText(s, enc) {          // 行ごとに書く（enc は関数でもよい：行の番号で変える）
  const lines = s.split(/\r?\n/); const parts = []; let k = 0;
  for (const ln of lines) {
    let e = typeof enc === 'function' ? (/^[\x00-\x7f]*$/.test(ln) ? 'utf-8' : enc(k++)) : enc;
    parts.push(e === 'utf-8' ? u8(ln) : e === 'cp932' ? sj(ln) : singleByteEncoder(e)(ln));
    parts.push(new Uint8Array([0x0D, 0x0A]));
  }
  const len = parts.reduce((a, b) => a + b.length, 0); const o = new Uint8Array(len); let p = 0;
  for (const b of parts) { o.set(b, p); p += b.length; }
  return o.subarray(0, len - 2);
}
function fixture(ver, { texts = [], layers = [], m0 = 'メモ', b0 = 'BLK', a0 = '属性', cp } = {}) {
  let s = fs.readFileSync(path.join(FIX, `base_${ver}.dxf`), 'latin1');
  s = s.replace(/@@L(\d+)@@/g, (m, i) => layers[i] !== undefined ? layers[i] : layers[i % Math.max(1, layers.length)] || '0')
    .replace(/@@M0@@/g, m0).replace(/@@B0@@/g, b0).replace(/@@A0@@/g, a0)
    .replace(/@@(\d+)@@/g, (m, i) => texts[i] !== undefined ? texts[i] : 'X');
  if (cp === null) s = s.replace(/  9\r?\n\$DWGCODEPAGE\r?\n  3\r?\n[^\r\n]*\r?\n/, '');
  else if (cp) s = s.replace(/(\$DWGCODEPAGE\r?\n  3\r?\n)[^\r\n]*/, '$1' + cp);
  return s;
}
const N_TEXT = 12, N_LAYER = 4;
const pad = (arr, n, fill) => { const r = arr.slice(0, n); while (r.length < n) r.push(fill); return r; };
function textsOf(an) {        // 直した後の TEXT の文（並び順）と、画層の名前
  const t = [], l = []; let ent = null;
  for (const g of an.tags) {
    if (g.c === 0) ent = g.val.trim();
    if (ent === 'TEXT' && g.c === 1) t.push(g.fixed);
    if (ent === 'LAYER' && g.c === 2) l.push(g.fixed);
    if (ent === 'MTEXT' && g.c === 1) t.push('MTEXT:' + g.fixed);
  }
  return { t: t.filter(x => !x.startsWith('MTEXT:')), l, m: t.filter(x => x.startsWith('MTEXT:')) };
}
const sjView = M.jwView;
function checkExport(group, name, an, truth, opt = {}) {
  for (const target of ['jw', 'acad']) {
    const r = M.exportDxf(an, target);
    if (!r.ok) { rec(group, `${name} → ${target}`, false, r.reason); continue; }
    if (OUT) fs.writeFileSync(path.join(OUT, `${name.replace(/[^\w぀-鿿]+/g, '_')}_${target}.dxf`), r.bytes);
    const rb = M.readBack(r.bytes, target);
    const vals = new Set(rb.vals.map(v => v.v));
    const want = truth.map(t => target === 'jw' ? sjView(t) : t).filter(t => !/^[\x00-\x7f]*$/.test(t));
    const miss = want.filter(t => !vals.has(t) && !(target === 'jw' && [...vals].some(v => v.includes(t))));
    const verOk = target === 'jw' ? rb.ver === 'AC1009' && rb.cp === 'ANSI_932' : (an.info.ver >= 'AC1021' ? rb.enc === 'utf-8' : rb.enc === 'cp932' && rb.cp === 'ANSI_932');
    let typesOk = true, types = '';
    if (target === 'jw') {
      const s = M.looseDecode(r.bytes, 'cp932'); const ty = new Set();
      const ls = s.split('\r\n'); for (let i = 0; i + 1 < ls.length; i += 2) if (ls[i].trim() === '0') ty.add(ls[i + 1].trim());
      const R12 = new Set(['SECTION', 'ENDSEC', 'TABLE', 'ENDTAB', 'LTYPE', 'LAYER', 'STYLE', 'BLOCK', 'ENDBLK', 'LINE', 'POINT', 'CIRCLE', 'ARC', 'TEXT', 'SOLID', 'TRACE', '3DFACE', 'INSERT', 'ATTDEF', 'ATTRIB', 'POLYLINE', 'VERTEX', 'SEQEND', 'EOF', 'VPORT', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'DIMENSION', 'SHAPE']);
      const bad = [...ty].filter(x => !R12.has(x)); typesOk = !bad.length; types = bad.length ? ' R12 に無い図形 ' + bad.join(',') : '';
    }
    const ok = !miss.length && verOk && typesOk && (opt.allowLeft || r.verify.left === 0);
    rec(group, `${name} → ${target === 'jw' ? 'Jw_cad 向け' : 'AutoCAD 向け'}`, ok,
      ok ? `${rb.ver}・${rb.cp}・文字 ${rb.vals.length}` : `足りない文字 ${JSON.stringify(miss.slice(0, 3))} 版 ${rb.ver} ${rb.cp} 化けの残り ${r.verify.left}${types}`);
  }
}

// ------------------------------------------------------------ 1. 化け直し（ファイル）
const TRUTH = ['平面図', '宝飾・時計ブティック', 'ショーケース', '通り芯 X1', '寸法線', 'カウンター', '壁（RC）', 'あいうえお', 'テスト',
  '天井高さ CH=2,400', 'φ25 H7 のキー溝', '1階 電灯・コンセント設備平面図'];
const LAYERS = ['壁', '建具', '文字', 'A-WALL'];
const KEEP = ['São Paulo', 'Größe 5mm', '縺れる糸', 'Ação', 'ﾃｽﾄ（半角カナ）'];

function caseFile(name, bytes, truthT, truthL, opt = {}) {
  const an = M.analyze(bytes);
  if (!an.ok) { rec('化け直し', name, false, an.reason); return null; }
  const { t, l } = textsOf(an);
  const tt = t.filter(x => !x.startsWith('MTEXT:'));
  const okT = JSON.stringify(tt.slice(0, truthT.length)) === JSON.stringify(truthT);
  const okL = !truthL || truthL.every(x => l.includes(x));
  const okN = opt.expectNoChange ? an.nItems === 0 : (opt.minItems === undefined || an.nItems >= opt.minItems);
  const okU = an.nUnfixed === (opt.unfixed || 0);
  rec('化け直し', name, okT && okL && okN && okU,
    (okT && okL ? '文字・画層とも正しい' : `文字 ${JSON.stringify(tt.slice(0, 4))} 画層 ${JSON.stringify(l.slice(0, 6))}`) +
    `（直した所 ${an.nItems}・直せなかった所 ${an.nUnfixed}・中身 ${M.encName(an.info.enc)}）`);
  if (opt.exportTruth) checkExport('書き出し', name, an, opt.exportTruth, opt);
  return an;
}

const T12 = pad(TRUTH, N_TEXT, 'X');
// 0. 正しい R2018（化けていない。化けでない字も変えない）
{
  const txt = TRUTH.concat(KEEP);
  // 正しい物は 12 個の印に入りきらないので、2 回に分けて見る
  caseFile('正しい R2018（直す所なし）', u8(fixture('R2018', { texts: T12, layers: LAYERS, m0: '注記 メモ', b0: '扉', a0: '属性の値' })), T12, LAYERS,
    { expectNoChange: true, exportTruth: TRUTH.concat(LAYERS, ['注記 メモ', '扉', '属性の値']) });
  caseFile('正しい R2018（化けでない字：São Paulo・Größe・縺れる糸・半角カナ）', u8(fixture('R2018', { texts: pad(KEEP, N_TEXT, 'X'), layers: LAYERS })), pad(KEEP, N_TEXT, 'X'), LAYERS,
    { expectNoChange: true, exportTruth: KEEP });
  void txt;
}
// 1. R2018 なのに中身が Shift_JIS
caseFile('食い違い：R2018 なのに中身が Shift_JIS', encodeText(fixture('R2018', { texts: T12, layers: LAYERS }), 'cp932'), T12, LAYERS, { minItems: 12, exportTruth: TRUTH.concat(LAYERS) });
// 2. R12・ANSI_932 なのに中身が UTF-8
caseFile('食い違い：R12・ANSI_932 なのに中身が UTF-8', u8(fixture('R12', { texts: T12, layers: LAYERS, cp: 'ANSI_932' })), T12, LAYERS, { minItems: 12, exportTruth: TRUTH.concat(LAYERS) });
// 3. R12・$DWGCODEPAGE 無し・中身は Shift_JIS（Jw_cad の DXF と同じ形）
caseFile('食い違い：R12・$DWGCODEPAGE 無し・中身は Shift_JIS（Jw_cad の形）', encodeText(fixture('R12', { texts: T12, layers: LAYERS, cp: null }), 'cp932'), T12, LAYERS, { exportTruth: TRUTH.concat(LAYERS) });
// 3b. R2000・ANSI_1252 と書いてあるのに中身が Shift_JIS
caseFile('食い違い：R2000・ANSI_1252 なのに中身が Shift_JIS', encodeText(fixture('R2000', { texts: T12, layers: LAYERS }), 'cp932'), T12, LAYERS, { minItems: 12, exportTruth: TRUTH.concat(LAYERS) });
// 3c. R2000・ANSI_932 で正しい Shift_JIS（直す所なし）
caseFile('正しい R2000・ANSI_932・Shift_JIS（直す所なし）', encodeText(fixture('R2000', { texts: T12, layers: LAYERS, cp: 'ANSI_932' }), 'cp932'), T12, LAYERS, { expectNoChange: true, exportTruth: TRUTH.concat(LAYERS) });
// 4. 縺繧型が焼きついた（戻せる物）
{
  const tA = TRUTH.filter(t => mojiA(t) !== null), lA = LAYERS.filter(l => mojiA(l) !== null);
  caseFile(`縺繧型（UTF-8 を Shift_JIS で読んで保存。文 ${tA.length}・画層 ${lA.length}）`, u8(fixture('R2018', { texts: pad(tA.map(mojiA), N_TEXT, 'X'), layers: lA.map(mojiA).concat(['A-WALL']) })),
    pad(tA, N_TEXT, 'X'), lA, { minItems: tA.length, exportTruth: tA.concat(lA) });
}
// 5. 縺繧型で、読めないバイトが「�」になった物：直せた物は元どおり、ほかは直さずに「直せませんでした」へ
{
  const tL = TRUTH.filter(t => mojiA(t) === null);
  const an = M.analyze(u8(fixture('R2018', { texts: pad(tL.map(mojiAlossy), N_TEXT, 'X'), layers: LAYERS })));
  const { t } = textsOf(an);
  let right = 0, kept = 0, wrong = [];
  tL.forEach((truth, i) => { if (t[i] === truth) right++; else if (t[i] === mojiAlossy(truth)) kept++; else wrong.push(t[i]); });
  const listed = an.unfixed.reduce((a, u) => a + u.n, 0);
  rec('化け直し', `縺繧型・バイトが欠けた物（文 ${tL.length}）`, !wrong.length && listed === kept && right + kept === tL.length,
    `元どおり ${right}・直さずに「直せませんでした」へ ${kept}（一覧 ${listed}）・まちがい ${wrong.length} ${JSON.stringify(wrong.slice(0, 2))}`);
  const g = an.items.filter(it => it.guesses).length;
  rec('化け直し', '欠けた字を当てた物は、印（［ ］）つきで一覧に出す', an.items.filter(it => it.guesses).every(it => /［.］/.test(it.marked)), `当てた文 ${g}`);
}
// 6. ã型
caseFile('ã型（UTF-8 を cp1252 で読んで保存）', u8(fixture('R2018', { texts: T12.map(mojiB), layers: LAYERS.map(mojiB) })), T12, LAYERS, { minItems: 12, exportTruth: TRUTH.concat(LAYERS) });
// 7. ƒ型
caseFile('ƒ型（Shift_JIS を cp1252 で読んで保存）', u8(fixture('R2018', { texts: T12.map(mojiC), layers: LAYERS.map(mojiC) })), T12, LAYERS, { minItems: 12, exportTruth: TRUTH.concat(LAYERS) });
// 8. 二重の化け
{
  const t2 = TRUTH.filter(t => mojiA(t) !== null);
  caseFile(`二重の化け（縺繧型の上に ã型。文 ${t2.length}）`, u8(fixture('R2018', { texts: pad(t2.map(t => mojiB(mojiA(t))), N_TEXT, 'X'), layers: LAYERS })), pad(t2, N_TEXT, 'X'), LAYERS, { minItems: t2.length, exportTruth: t2 });
  caseFile(`二重の化け（縺繧型の上に ƒ型。文 ${t2.length}）`, u8(fixture('R2018', { texts: pad(t2.map(t => mojiC(mojiA(t))), N_TEXT, 'X'), layers: LAYERS })), pad(t2, N_TEXT, 'X'), LAYERS, { minItems: t2.length, exportTruth: t2 });
  const t3 = t2.filter(t => { try { mojiC(mojiA(t)); return true; } catch (e) { return false; } });
  caseFile(`三重の化け（縺繧型 → ƒ型 → ã型。文 ${t3.length}）`, u8(fixture('R2018', { texts: pad(t3.map(t => mojiB(mojiC(mojiA(t)))), N_TEXT, 'X'), layers: LAYERS })), pad(t3, N_TEXT, 'X'), LAYERS, { minItems: t3.length });
}
// 9. \U+XXXX と \M+1XXXX
{
  const U = s => [...s].map(c => c.codePointAt(0) < 128 ? c : '\\U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
  const Mx = s => [...s].map(c => c.codePointAt(0) < 128 ? c : '\\M+1' + [...sj(c)].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')).join('');
  caseFile('\\U+XXXX と \\M+1XXXX の書き方（R2000）', u8(fixture('R2000', { texts: T12.map((t, i) => i % 2 ? Mx(t) : U(t)), layers: LAYERS.map(U) })), T12, LAYERS, { minItems: 12, exportTruth: TRUTH.concat(LAYERS) });
}
// 10. 1 本の中に UTF-8 と Shift_JIS が混ざった R12
caseFile('1 本に UTF-8 と Shift_JIS が混ざった R12', encodeText(fixture('R12', { texts: T12, layers: LAYERS, cp: 'ANSI_932' }), k => k % 2 ? 'utf-8' : 'cp932'), T12, LAYERS, { exportTruth: TRUTH.concat(LAYERS) });
// 11. BOM
{
  const b = u8(fixture('R2018', { texts: T12, layers: LAYERS })); const o = new Uint8Array(b.length + 3); o.set([0xEF, 0xBB, 0xBF]); o.set(b, 3);
  caseFile('先頭に BOM（UTF-8 の印）', o, T12, LAYERS, { exportTruth: TRUTH.concat(LAYERS) });
}
// 12. 長い MTEXT（続きの 3 の境目で化けた字が切れている）
{
  const longt = '天井高さ CH=2,400 の範囲。'.repeat(30);
  // 250 字ずつに切る（化けた字の途中で切れる）
  const garbled = mojiB(longt); const parts = []; for (let i = 0; i < garbled.length; i += 250) parts.push(garbled.slice(i, i + 250));
  let s = fixture('R2018', { texts: T12, layers: LAYERS, m0: 'QQQ' });
  s = s.replace(/  1\r?\nQQQ/, parts.slice(0, -1).map(p => '  3\r\n' + p).join('\r\n') + '\r\n  1\r\n' + parts[parts.length - 1]);
  const an = M.analyze(u8(s)); const { m } = textsOf(an);
  rec('化け直し', `長い MTEXT の ã型（${parts.length} 個に分かれた物）`, m.includes('MTEXT:' + longt), `MTEXT ${m.map(x => x.length - 6).join(',')} 字`);
  checkExport('書き出し', '長い MTEXT', an, ['天井高さ CH=2,400 の範囲。'.repeat(30)].map(x => x), { });
}

// ------------------------------------------------------------ 2. 正しい DXF を壊さない（点検で見つかった弱点）
{
  const keep = [
    ['半角カナだけ（R12・ANSI_932）', 'R12', 'cp932', 'ANSI_932', ['ｺﾝｾﾝﾄ', 'ｽｲｯﾁ 2個', 'ﾌﾟﾙﾎﾞｯｸｽ']],
    ['半角カナだけ（R12・$DWGCODEPAGE 無し）', 'R12', 'cp932', null, ['ｺﾝｾﾝﾄ', 'ｽｲｯﾁ']],
    ['半角カナだけ（R2000・ANSI_932・2 字の語）', 'R2000', 'cp932', 'ANSI_932', ['ﾃｽ', 'ﾄｲﾚ', 'ﾀﾞｸﾄ']],
    ['半角カナだけ（R2018・UTF-8）', 'R2018', 'utf-8', null, ['ﾃｽ', 'ｺﾝｾﾝﾄ']],
    ['アクセントの語が 1 つ（Länge、ANSI_1252）', 'R2000', 'cp1252', 'ANSI_1252', ['Länge 1200']],
    ['アクセントの語（Hélène・Café・Größe、ANSI_1252）', 'R2000', 'cp1252', 'ANSI_1252', ['Hélène', 'Café 3', 'Größe 5mm', 'Ação']],
    ['アクセントの語（Ściana、ANSI_1250）', 'R2000', 'cp1250', 'ANSI_1250', ['Ściana']],
    ['ANSI_1251（ロシア語）', 'R2000', 'cp1251', 'ANSI_1251', ['Стена', 'План этажа 1:100']],
    ['ANSI_1253（ギリシャ語）', 'R2000', 'cp1253', 'ANSI_1253', ['Τοίχος', 'Κάτοψη']],
    ['ANSI_1252 の記号だけ（° ² ±）', 'R2000', 'cp1252', 'ANSI_1252', ['45°', '25 m²', '±0.1']],
    ['R12・ANSI_1252 のアクセントの語', 'R12', 'cp1252', 'ANSI_1252', ['Länge', 'Hélène', 'Ação']],
    ['化けに出やすい漢字の本物（縺れる・繧・譁）', 'R2018', 'utf-8', null, ['縺れる糸', '繧', '譁']]];
  for (const [nm, ver, enc, cp, texts] of keep) {
    const s = fixture(ver, { texts: pad(texts, N_TEXT, 'X'), layers: ['0', 'A', 'B', 'C'], m0: 'memo', a0: 'v', b0: 'BLK', cp: ver === 'R2018' ? undefined : cp });
    const an = M.analyze(enc === 'utf-8' ? u8(s) : encodeText(s, enc));
    if (!an.ok) { rec('壊さない', nm, false, an.reason); continue; }
    const { t } = textsOf(an);
    // $DWGCODEPAGE が無い物は、中身の文字コードの見分け（enc）だけは直した所に数える（cp1252 とみなされるため）
    const onlyEnc = an.items.every(it => it.kinds.length === 1 && it.kinds[0] === 'enc');
    rec('壊さない', nm, JSON.stringify(t.slice(0, texts.length)) === JSON.stringify(texts) && (an.nItems === 0 || (cp === null && onlyEnc)),
      `${JSON.stringify(t.slice(0, texts.length))}（中身 ${M.encName(an.info.enc)}・直した所 ${an.nItems}）`);
  }
}

// ------------------------------------------------------------ 3. 直せない物は「直せませんでした」
{
  const bin = new Uint8Array(40); bin.set(u8('AutoCAD Binary DXF\r\n\x1a\x00'));
  const r1 = M.analyze(bin); rec('直せない物', 'バイナリ DXF', !r1.ok && /バイナリ/.test(r1.reason), r1.reason);
  const r2 = M.analyze(u8('こんにちは\nこれは DXF ではありません\n')); rec('直せない物', 'DXF でないファイル', !r2.ok && /DXF の形/.test(r2.reason), r2.reason);
  const r3 = M.analyze(new Uint8Array(0)); rec('直せない物', '空のファイル', !r3.ok, r3.reason);
  const r4 = M.analyze(u8('AC1032\x00\x00\x00binary')); rec('直せない物', 'DWG ファイル', !r4.ok && /DWG/.test(r4.reason), r4.reason);
  // 形がこわれた DXF（ENDSEC が無い）：読み直しで気づいて、書き出さない
  const s = fixture('R2018', { texts: T12, layers: LAYERS }).replace(/  0\r?\nENDSEC\r?\n  0\r?\nSECTION\r?\n  2\r?\nENTITIES/, '  0\r\nSECTION\r\n  2\r\nENTITIES');
  const an = M.analyze(u8(s)); const ex = M.exportDxf(an, 'acad');
  rec('直せない物', '形がこわれた DXF（ENDSEC が足りない）は書き出さない', an.ok && !ex.ok && /書き出しません/.test(ex.reason), ex.reason || 'ok');
  // どの文字コードでも読めないバイト
  const raw = encodeText(fixture('R2018', { texts: T12, layers: LAYERS }), 'utf-8');
  const s2 = new Uint8Array(raw); const idx = M.looseDecode(raw, 'cp1252').indexOf('平面図'.length ? 'X\r\n' : '');
  void idx;
  const pos = (() => { const t = M.looseDecode(raw, 'latin1'); return t.indexOf(M.looseDecode(u8('平面図'), 'latin1')); })();
  s2[pos] = 0xFF; s2[pos + 1] = 0xFE;
  const an2 = M.analyze(s2);
  rec('直せない物', 'どの文字コードでも読めないバイトがある文は、直さずに一覧へ', an2.ok && an2.unfixed.length >= 1 && /読めないバイト/.test(an2.unfixed[0].reason), an2.ok ? an2.unfixed.map(u => u.reason).join('／') : an2.reason);
}

// ------------------------------------------------------------ 4. 書き出しの中身（Jw_cad 向け R12 に、図形が残るか）
{
  const an = M.analyze(u8(fixture('R2018', { texts: T12, layers: LAYERS, m0: '一行目\\P二行目', a0: '属性の値', b0: '扉' })));
  const r = M.exportDxf(an, 'jw'); const s = M.looseDecode(r.bytes, 'cp932'); const ls = s.split('\r\n'); const cnt = {};
  for (let i = 0; i + 1 < ls.length; i += 2) if (ls[i].trim() === '0') cnt[ls[i + 1].trim()] = (cnt[ls[i + 1].trim()] || 0) + 1;
  const ok = cnt.LINE >= 4 && cnt.CIRCLE >= 2 && cnt.ARC >= 1 && cnt.POLYLINE >= 3 && cnt.TEXT >= 14 && cnt.INSERT >= 2 && cnt.ATTRIB >= 1 && !cnt.LWPOLYLINE && !cnt.MTEXT && !cnt.HATCH;
  rec('書き出し', 'Jw_cad 向け：R2018 の図形を R12 の形に（線・円・円弧・折れ線・文字・ブロック・属性・寸法の絵）', ok, JSON.stringify(cnt));
  rec('書き出し', 'Jw_cad 向け：MTEXT の 2 行を TEXT 2 つに', s.includes('一行目') && s.includes('二行目') && !s.includes('\\P'), '');
  rec('書き出し', 'Jw_cad 向け：書き出さなかった図形（ハッチ）を言う', r.notes.some(n => /HATCH 1 個/.test(n)), r.notes.join(' / '));
  rec('書き出し', 'Jw_cad 向け：Windows に無い書体（ipag.ttf）を MS ゴシックに', /msgothic\.ttc/.test(s) && !/ipag\.ttf/.test(s), '');
  const a = M.exportDxf(an, 'acad'); const sa = new TextDecoder().decode(a.bytes);
  rec('書き出し', 'AutoCAD 向け：R2018 は版を変えず UTF-8（$DWGCODEPAGE=ANSI_932）', /AC1032/.test(sa) && /ANSI_932/.test(sa) && sa.includes('宝飾・時計ブティック'), '');
  // Shift_JIS に無い字
  const an3 = M.analyze(u8(fixture('R2018', { texts: pad(['幅—100', '①〜③', '温度 −5℃', 'Ø50', '𠮷野家'], N_TEXT, 'X'), layers: LAYERS })));
  const r3 = M.exportDxf(an3, 'jw'); const s3 = M.looseDecode(r3.bytes, 'cp932');
  rec('書き出し', 'Jw_cad 向け：Shift_JIS に無い字は近い字に（— → ―、〜 → ～、− → －、Ø → φ）、無い字は ?', s3.includes('幅―100') && s3.includes('①～③') && s3.includes('温度 －5℃') && s3.includes('φ50') && s3.includes('?野家'),
    r3.notes.filter(n => /Shift_JIS/.test(n)).join(' / '));
}

// ------------------------------------------------------------ 5. コーパス（図面に書かれそうな文）
const PHRASES = `1階平面図 S=1/100|2階平面図|南立面図|A-A断面図|矩計図 S=1/30|天井伏図|基礎伏図|配置図兼1階平面図|展開図 A面|建具表
仕上表|特記仕様書|電灯コンセント設備図|給排水衛生設備図|空調換気設備図|単線結線図|分電盤結線図|弱電設備図|外構図|求積図
通り芯|寸法線|中心線|かくれ線|外形線|ハッチング|基準線|補助線|引出線|切断線
壁（RC）|床：フローリング t=15|天井：ビニルクロス貼|巾木 H=60|廻り縁|石膏ボード t=12.5|構造用合板 t=24|断熱材 グラスウール 16K|防水シート|モルタル金ゴテ
玄関|ホール|リビング|ダイニング|キッチン|洗面脱衣室|浴室|トイレ|寝室|和室6畳
クローゼット|納戸|バルコニー|吹抜|階段|廊下|物入|パントリー|書斎|子供室
店舗|売場|バックヤード|ショーケース|カウンター|レジカウンター|試着室|ストック|事務室|休憩室
宝飾・時計ブティック|什器配置図|ガラスケース W1200|照明ボックス|カッティングシート貼|ミラー貼|サイン工事|陳列棚|可動棚 5段|ハンガーパイプ φ32
コンセント 2P15A×2|スイッチ 3路|ダウンライト LED|分電盤 L-1|換気扇 φ100|エアコン 室内機|室外機置場|インターホン|火災報知器|非常照明
給水管 20A|排水管 VP75|給湯管|ガス管|ドレン管|止水栓|量水器|汚水桝|雨水桝|浸透桝
流し台 W2550|吊戸棚|レンジフード|食洗機|冷蔵庫置場|洗面台 W750|洗濯機パン|ユニットバス 1616|便器|手洗器
天板：ステンレス HL|側板 ポリ合板|扉 メラミン化粧板|引出し 3段|台輪 H=100|幕板|背板 t=4|丁番 スライド|取手 L=120|レール
道路中心線|計画高|現況地盤高|縦断勾配 2.0%|横断勾配|アスファルト舗装 t=50|路盤 t=150|側溝 300×300|集水桝|縁石
擁壁 H=2000|ブロック塀 H=1200|フェンス H=1800|門扉|カーポート|駐車場 2台|土間コンクリート t=120|砂利敷|植栽|アプローチ
敷地境界線|道路境界線|隣地境界線|官民境界|境界杭|基準点|測点 No.5|標高 TP+12.50|盛土|切土
歯車要目表|モジュール 2|歯数 40|圧力角 20°|基準円直径 80|キー溝 幅6|面取り C1|8×φ14 キリ|PCD160 等配|M10 タップ 深さ20
材質 S45C|熱処理 焼入れ焼戻し|表面処理 黒染|公差 H7|はめあい|表面粗さ Ra3.2|個数 2|質量 3.5kg|尺度 1:2|第三角法
ハウジング|ベアリング 6204|オイルシール|止め輪|フランジ|シャフト|ブラケット|カバー|ベースプレート|スプロケット
図面名|図面番号|工事名|縮尺|作成日|設計|製図|検図|承認|備考
改訂|訂正|変更|記事|数量|単位|仕様|規格|型番|メーカー
天井高 CH=2,400|床高 FL+0|階高 2,900|軒高|最高高さ 9,850|設計GL|1FL|2FL|地盤面|基準点 BM
既存|新設|撤去|移設|改修|別途工事|同上|参照|要確認|現場合せ
株式会社 松村設計|山田工務店 御中|田中様邸 新築工事|佐藤邸 改修工事|一級建築士事務所|鈴木製作所|高橋建設|渡辺電気|伊藤設備|中村木工
東京都港区|大阪市北区|名古屋市中区|横浜市西区|福岡市博多区|札幌市中央区|京都市左京区|神戸市灘区|仙台市青葉区|広島市南区
あいうえお|テスト|サンプル図面|メモ：要打合せ|※寸法は現場実測による|特記なき限り単位はmmとする|詳細は別図参照|指示なき面取りはC0.5|塗装色は別途指示|監督員の指示による
鉄筋コンクリート造 2階建|木造平屋建|鉄骨造 3階建|延床面積 125.50㎡|建築面積 68.20㎡|敷地面積 210.35㎡|建ぺい率 60%|容積率 200%|用途地域 第一種住居|防火地域 準防火
アンカーボルト M16|ベースプレート t=22|柱 H-300×300|梁 H-400×200|ブレース|スラブ t=150|かぶり厚さ 40|主筋 D19|あばら筋 D10@200|継手 L=40d
引違い窓 16511|片開きドア W800|両開き扉|引戸 W900|アルミサッシ|網戸|シャッター|庇 出600|手摺 H=1100|笠木
3階平面詳細図|屋根伏図 S=1/100|北立面図|B-B断面図|階段詳細図|便所詳細図|サッシ詳細図|機器リスト|照明器具姿図|幹線系統図
木製建具表|鋼製建具表|外部仕上表|内部仕上表|面積表|敷地求積図|日影図|仮設計画図|杭伏図|鉄骨詳細図
応接室|会議室A|更衣室（女）|給湯室|機械室|電気室|倉庫2|風除室|エントランス|エレベーターホール
受付カウンター W1800|ロッカー 6人用|本棚 H=2100|下駄箱|傘立て|掲示板|ホワイトボード|ブラインド|カーテンレール|ピクチャーレール
床：磁器質タイル 300角|壁：珪藻土塗|天井：岩綿吸音板|腰壁：羽目板貼|外壁：窯業系サイディング|屋根：ガルバリウム鋼板|軒天：ケイカル板|土間：コンクリート直押え|巾木：ソフト巾木|階段：集成材 t=36
非常用照明|誘導灯 B級|自動火災報知設備|スプリンクラー|屋内消火栓|排煙窓|防火戸|防火シャッター|避難はしご|消火器
冷媒管 6.4/12.7|全熱交換器|天井カセット形 4方向|床置形|加湿器|フィルター|ダンパー|吹出口 VHS|フレキシブルダクト|保温 グラスウール 25t
受水槽 FRP 2t|加圧給水ポンプ|電気温水器 370L|ガス給湯器 24号|グリーストラップ|排水金具|掃除口|通気管|床排水トラップ|オーバーフロー管
道路幅員 6.0m|歩道幅員 2.5m|街路樹|横断側溝|L型側溝|U型側溝 300|ヒューム管 φ600|マンホール 1号|ガードレール|区画線
平歯車|かさ歯車|ウォームギヤ|スラスト軸受|深溝玉軸受|六角ボルト M12×40|ばね座金|平行ピン|スナップリング|セットスクリュー
溶接記号|開先角度 60°|脚長 6|全周溶接|現場溶接|非破壊検査|ショットブラスト|さび止め塗装 2回|溶融亜鉛めっき HDZ55|ステンレス SUS304
担当：小林|承認：加藤|検図：吉田|作成：山本|第2版|2026年11月27日|ページ 3/12|原図 A1|縮尺 A3:1/200|図面サイズ
北側斜線|道路斜線|隣地斜線|高度地区|日影規制|接道 4.0m|セットバック|がけ条例|浄化槽 5人槽|合併処理
※現場にて寸法確認のこと|※下地補強を行うこと|※色は見本帳による|※詳細は施工図にて決定|※既存配管は撤去|※養生を十分に行う|※材料は承認後発注|※雨仕舞に注意|※設備機器は別途|※本図は参考図とする`.split(/\||\n/).filter(Boolean);
{
  const st = { keep: [0, 0], A: [0, 0], B: [0, 0], C: [0, 0], BA: [0, 0], CA: [0, 0], lossyRight: 0, lossyKept: 0, lossyWrong: [], lossyN: 0 };
  const bad = { keep: [], A: [], B: [], C: [], BA: [], CA: [] };
  const tryIt = (k, truth, garbled) => { if (garbled === null) return; st[k][1]++; const r = M.unmojibake(garbled); if (r.text === truth && r.lost === 0) st[k][0]++; else bad[k].push(`${truth}→${r.text}`); };
  for (const p of PHRASES) {
    st.keep[1]++; const r = M.unmojibake(p); if (r.text === p) st.keep[0]++; else bad.keep.push(p + '→' + r.text);
    const a = mojiA(p);
    tryIt('A', p, a); tryIt('B', p, mojiB(p)); tryIt('C', p, mojiC(p));
    if (a !== null) { tryIt('BA', p, mojiB(a)); let ca = null; try { ca = mojiC(a); } catch (e) { /* Shift_JIS に無い字 */ } tryIt('CA', p, ca); }
    else {
      st.lossyN++; const g = mojiAlossy(p); const u = M.unmojibake(g);
      if (u.lost === 0 && u.text === p) st.lossyRight++;
      else if (u.lost > 0) st.lossyKept++;
      else st.lossyWrong.push(`${p}→${u.text}`);
    }
  }
  const nm = { keep: '正しい文を変えない', A: '縺繧型', B: 'ã型', C: 'ƒ型', BA: '二重（縺繧型＋ã型）', CA: '二重（縺繧型＋ƒ型）' };
  for (const k of Object.keys(nm)) rec('コーパス', `${nm[k]}（${PHRASES.length} 文から）`, st[k][0] === st[k][1], `${st[k][0]}/${st[k][1]}` + (bad[k].length ? ' 例 ' + bad[k].slice(0, 3).join('、') : ''));
  rec('コーパス', `バイトが欠けた縺繧型（${st.lossyN} 文）：まちがった字を入れない`, st.lossyWrong.length === 0,
    `元どおり ${st.lossyRight}・直せませんでした ${st.lossyKept}・まちがい ${st.lossyWrong.length}` + (st.lossyWrong.length ? ' 例 ' + st.lossyWrong.slice(0, 3).join('、') : ''));
}

console.log(`\n${nOk}/${nOk + nNg} ○`);
if (nNg) { console.log('×の一覧：\n' + fails.join('\n')); process.exit(1); }
