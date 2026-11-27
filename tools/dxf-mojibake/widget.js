/* DXF の文字化けを直す（埋め込む部品）  ZAZOU 設計Works
 * 使い方：<div data-dxf-mojibake></div> を置き、このファイルを読みこむだけ。
 *   data-title="見出し"        … 部品の中の見出し（省くと出さない）
 *   data-consult="URL"         … 「図面のご相談」の行き先（省くと /trace/mojibake/#contact）
 *   data-compact               … 小さめの形
 * ファイルはこのブラウザの中だけで読み、どこにも送らない（通信は、同じ場所の dxfmoji.js と widget.css を読むときだけ）。
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var BASE = me && me.src ? me.src.replace(/[^/]*(\?.*)?$/, '') : '/tools/dxf-mojibake/';
  var VER = '1127a';

  function ensureCss() {
    if (document.querySelector('link[data-dxfm-css]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + 'widget.css?v=' + VER; l.setAttribute('data-dxfm-css', '');
    document.head.appendChild(l);
  }
  var enginePromise = null;
  function engine() {            // 判定の本体は、使うときに読みこむ（ページを重くしない）
    if (window.DxfMoji) return Promise.resolve(window.DxfMoji);
    if (enginePromise) return enginePromise;
    enginePromise = new Promise(function (ok, ng) {
      var s = document.createElement('script'); s.src = BASE + 'dxfmoji.js?v=' + VER;
      s.onload = function () { window.DxfMoji ? ok(window.DxfMoji) : ng(new Error('読みこめませんでした')); };
      s.onerror = function () { enginePromise = null; ng(new Error('道具の本体を読みこめませんでした。ページを読み直してください。')); };
      document.head.appendChild(s);
    });
    return enginePromise;
  }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (attrs[k] === true) e.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var KIND = {
    enc: '文字コードの食い違い', esc: '\\U+XXXX などの書き方',
    wayA: '縺繧型の化け（UTF-8 を Shift_JIS で読んで保存）', wayB: 'ã型の化け（UTF-8 を cp1252 で読んで保存）', wayC: 'ƒ型の化け（Shift_JIS を cp1252 で読んで保存）'
  };
  function kindText(kinds) {
    var out = [], ways = kinds.filter(function (k) { return /^way/.test(k); });
    kinds.forEach(function (k) { if (!/^way/.test(k) && out.indexOf(KIND[k]) < 0) out.push(KIND[k]); });
    if (ways.length >= 2) out.push((ways.length === 2 ? '二重' : '三重') + 'の化け（' + ways.map(function (w) { return { wayA: '縺繧型', wayB: 'ã型', wayC: 'ƒ型' }[w]; }).join('・') + '）');
    else if (ways.length) out.push(KIND[ways[0]]);
    return out.join('、');
  }
  function show(s) { return s.length > 120 ? s.slice(0, 120) + '…' : s; }

  // 見本：いろいろな化け方をした DXF を、ブラウザの中で作る
  function makeSample(M) {
    var te = new TextEncoder();
    var A = function (s) { return M.strictDecode(te.encode(s), 'cp932'); };
    var Al = function (s) { return M.looseDecode(te.encode(s), 'cp932'); };
    var B = function (s) { return M.looseDecode(te.encode(s), 'cp1252'); };
    var C = function (s) { return M.looseDecode(new Uint8Array(M.encodeSJ(s)), 'cp1252'); };
    var U = function (s) { return Array.from(s).map(function (c) { var o = c.codePointAt(0); return o < 128 ? c : '\\U+' + o.toString(16).toUpperCase().padStart(4, '0'); }).join(''); };
    var texts = ['1階平面図 S=1/100', B('宝飾・時計ブティック'), A('ショーケース'), C('通り芯 X1'), B(A('カウンター')), U('寸法線'), Al('壁（RC）'), 'A-WALL'];
    var layers = ['0', B('壁'), A('建具'), C('文字')];
    var L = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$DWGCODEPAGE', '3', 'ANSI_932', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0', '0', 'ENDTAB',
      '0', 'TABLE', '2', 'LAYER', '70', String(layers.length)];
    layers.forEach(function (n, i) { L.push('0', 'LAYER', '2', n, '70', '0', '62', String(i + 1), '6', 'CONTINUOUS'); });
    L.push('0', 'ENDTAB', '0', 'TABLE', '2', 'STYLE', '70', '1', '0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0.0', '41', '1.0', '50', '0.0', '71', '0', '42', '2.5', '3', 'txt', '4', '', '0', 'ENDTAB', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'BLOCKS', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    texts.forEach(function (t, i) {
      L.push('0', 'LINE', '8', layers[i % 4], '10', '0.0', '20', String(-10 * i - 3), '30', '0.0', '11', '120.0', '21', String(-10 * i - 3), '31', '0.0');
      L.push('0', 'TEXT', '8', layers[i % 4], '10', '0.0', '20', String(-10 * i), '30', '0.0', '40', '5.0', '1', t);
    });
    L.push('0', 'ENDSEC', '0', 'EOF');
    return te.encode(L.join('\r\n') + '\r\n');      // R12・ANSI_932 と書いてあるのに、中身は UTF-8（よくある食い違い）
  }

  function mount(root) {
    if (root.__dxfm) return; root.__dxfm = true;
    ensureCss();
    var consult = root.getAttribute('data-consult') || '/trace/mojibake/#contact';
    var uid = 'dxfm' + Math.random().toString(36).slice(2, 8);
    root.classList.add('dxfm'); if (root.hasAttribute('data-compact')) root.classList.add('compact');
    var input = h('input', { type: 'file', accept: '.dxf,.DXF', id: uid + '-f', 'aria-label': 'DXF ファイルを選ぶ' });
    var drop = h('label', { class: 'dxfm-drop', for: uid + '-f' }, [
      h('span', { class: 'dxfm-big', text: 'DXF を選ぶ、またはここにドラッグ' }),
      h('span', { class: 'dxfm-small', text: 'Jw_cad・AutoCAD などで文字が読めない DXF（ASCII 形式）' }), input]);
    var sampleBtn = h('button', { type: 'button', class: 'dxfm-btn ghost', text: '化けた見本で試す' });
    var res = h('div', { class: 'dxfm-res', hidden: true, 'aria-live': 'polite' });
    var kids = [];
    if (root.getAttribute('data-title')) kids.push(h('h3', { class: 'dxfm-t', text: root.getAttribute('data-title') }));
    kids.push(h('p', { class: 'dxfm-priv' }, [h('b', { text: '送りません' }), h('span', { text: 'ファイルは、このブラウザの中だけで読んで直します。どこのサーバーにも送りません。' })]));
    kids.push(drop, h('div', { class: 'dxfm-row' }, [sampleBtn]), res);
    root.textContent = ''; kids.forEach(function (k) { root.appendChild(k); });

    var cur = null;          // { an, name }
    function status(kind, title, msg) {
      return h('div', { class: 'dxfm-status ' + kind }, [h('span', { class: 'dxfm-mark', 'aria-hidden': 'true', text: kind === 'ok' ? '✓' : kind === 'ng' ? '!' : 'i' }),
        h('div', null, [h('b', { text: title }), msg ? h('p', { text: msg }) : null])]);
    }
    function consultLine() {
      return h('p', { class: 'dxfm-consult' }, ['直らないとき、文字のほかに線や画層もくずれているときは、', h('a', { href: consult, text: '図面のご相談を' }), '。DXF をそのままお送りください（お見積りは無料です）。']);
    }
    function render(M, an, name) {
      res.textContent = ''; res.hidden = false; cur = null;
      if (!an.ok) { res.appendChild(status('ng', '直せませんでした', an.reason)); res.appendChild(consultLine()); return; }
      cur = { an: an, name: name };
      var nI = an.nItems, nU = an.nUnfixed;
      if (nI && !nU) res.appendChild(status('ok', '直しました（' + nI + ' か所）', '下の一覧で、どの文字をどう直したかを確かめてから、保存してください。'));
      else if (nI && nU) res.appendChild(status('warn', nI + ' か所を直しました。' + nU + ' か所は直せませんでした', '直せなかった所は、元のまま残しています（まちがった字は入れません）。'));
      else if (nU) res.appendChild(status('ng', '直せませんでした（' + nU + ' か所）', '理由は下の一覧のとおりです。ほかの所は元のままです。'));
      else res.appendChild(status('ok', '文字化けは見つかりませんでした', an.jp ? 'この DXF の文字は正しく読めます。Jw_cad で化けるときは、下の「Jw_cad 向け」で保存し直すと直ります。' : '日本語の文字はありませんでした。'));
      var i = an.info, used = Object.keys(i.used).map(function (k) { return M.encName(k.replace(/（.*$/, '')) + ' ' + i.used[k] + ' 行'; }).join('、');
      res.appendChild(h('dl', { class: 'dxfm-info' }, [
        h('dt', { text: 'ファイル' }), h('dd', { text: name }),
        h('dt', { text: '版' }), h('dd', { text: i.verName + '（' + i.ver + '）' + (i.isNew ? '：中身は UTF-8 の決まり' : '：中身は $DWGCODEPAGE の文字コードの決まり') }),
        h('dt', { text: '$DWGCODEPAGE' }), h('dd', { text: (i.cpname || '（書いていない。cp1252 とみなされる）') + (i.isNew ? '（この版では使われない）' : '') }),
        h('dt', { text: '中身の文字コード' }), h('dd', { text: used || '英数字だけ（日本語なし）' })]));
      if (an.items.length) {
        res.appendChild(h('h4', { text: '直した文字（前 → 後）' }));
        var tb = h('tbody'); var max = 300;
        an.items.slice(0, max).forEach(function (it) {
          tb.appendChild(h('tr', null, [
            h('td', { class: 'b', 'data-h': '前' }, [show(it.before)]),
            h('td', { class: 'a', 'data-h': '後' }, [show(it.marked || it.after), it.n > 1 ? h('span', { class: 'dxfm-n', text: '×' + it.n }) : null]),
            h('td', { 'data-h': '原因' }, [kindText(it.kinds), it.marked ? h('span', { class: 'why', text: '［ ］の字は、消えたバイトを前後の字と図面の言葉から当てた字です。原図と見くらべてください。' }) : null, h('span', { class: 'why', text: it.where })])]));
        });
        if (an.items.length > max) tb.appendChild(h('tr', null, [h('td', { colspan: '3', text: 'ほか ' + (an.items.length - max) + ' 件' })]));
        res.appendChild(h('div', { class: 'dxfm-tw' }, [h('table', { class: 'dxfm-t' }, [h('colgroup', null, [h('col', { class: 'c1' }), h('col', { class: 'c2' }), h('col', { class: 'c3' })]),
          h('thead', null, [h('tr', null, [h('th', { scope: 'col', text: '前（CAD での見え方）' }), h('th', { scope: 'col', text: '後' }), h('th', { scope: 'col', text: '原因・場所' })])]), tb])]));
      }
      if (an.unfixed.length) {
        res.appendChild(h('h4', { text: '直せませんでした' }));
        var ul = h('ul', { class: 'dxfm-list' });
        an.unfixed.slice(0, 100).forEach(function (u) {
          ul.appendChild(h('li', null, ['「' + show(u.before) + '」' + (u.n > 1 ? ' ×' + u.n : ''), h('span', { class: 'why', text: '理由：' + u.reason + (u.partial ? '（読めた所：' + show(u.partial) + '）' : '') + (u.where ? '　場所：' + u.where : '') })]));
        });
        res.appendChild(ul);
      }
      // 書き出し
      var r1 = h('input', { type: 'radio', name: uid + '-t', value: 'jw', checked: true }), r2 = h('input', { type: 'radio', name: uid + '-t', value: 'acad' });
      var save = h('button', { type: 'button', class: 'dxfm-btn', text: '直した DXF を保存' });
      var outMsg = h('div', { 'aria-live': 'polite' });
      res.appendChild(h('div', { class: 'dxfm-out' }, [
        h('fieldset', null, [h('legend', { text: '書き出し先' }),
          h('label', { class: 'dxfm-opt' }, [r1, h('div', null, [h('b', { text: 'Jw_cad 向け' }), h('span', { text: 'R12・Shift_JIS。Jw_cad で文字が化けない形です。' })])]),
          h('label', { class: 'dxfm-opt' }, [r2, h('div', null, [h('b', { text: 'AutoCAD 向け' }), h('span', { text: 'R2007 以降は UTF-8。R2000〜R2004 は AutoCAD と同じ書き方。版はそのまま。' })])])]),
        h('div', { class: 'dxfm-row' }, [save]), outMsg]));
      save.addEventListener('click', function () {
        var target = r2.checked ? 'acad' : 'jw';
        var ex = M.exportDxf(cur.an, target); outMsg.textContent = '';
        if (!ex.ok) { outMsg.appendChild(h('div', { style: 'margin-top:12px' }, [status('ng', '直せませんでした', ex.reason)])); outMsg.appendChild(consultLine()); return; }
        var base = cur.name.replace(/\.dxf$/i, '');
        var fname = base + (target === 'jw' ? '_Jw_cad向け' : '_AutoCAD向け') + '.dxf';
        var url = URL.createObjectURL(new Blob([ex.bytes], { type: 'application/dxf' }));
        var a = h('a', { href: url, download: fname }); document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
        var v = ex.verify;
        outMsg.appendChild(h('div', { style: 'margin-top:12px' }, [status('ok', '保存しました：' + fname, '書き出した物を読み直して確かめました（' + (M.VER_NAME[v.ver] || v.ver) + '・$DWGCODEPAGE=' + v.cp + '・' + M.encName(v.enc) + '・日本語などの文字 ' + v.texts + ' 個が思ったとおり）。')]));
        var ul2 = h('ul', { class: 'dxfm-notes' }); ex.notes.forEach(function (n) { ul2.appendChild(h('li', { text: n })); }); outMsg.appendChild(ul2);
      });
      res.appendChild(consultLine());
    }
    function run(bytes, name) {
      res.hidden = false; res.textContent = ''; res.appendChild(status('', '読んでいます…', name));
      engine().then(function (M) {
        var an; try { an = M.analyze(bytes); } catch (e) { an = { ok: false, reason: 'この DXF は読めませんでした（' + (e && e.message || e) + '）。' }; }
        render(M, an, name);
      }, function (e) { res.textContent = ''; res.appendChild(status('ng', '直せませんでした', e.message)); });
    }
    function readFile(f) {
      if (!f) return;
      if (f.size > 200 * 1024 * 1024) { res.hidden = false; res.textContent = ''; res.appendChild(status('ng', '直せませんでした', 'ファイルが大きすぎます（200MB まで）。')); return; }
      var fr = new FileReader();
      fr.onload = function () { run(new Uint8Array(fr.result), f.name); };
      fr.onerror = function () { res.hidden = false; res.textContent = ''; res.appendChild(status('ng', '直せませんでした', 'ファイルを読めませんでした。')); };
      fr.readAsArrayBuffer(f);
    }
    input.addEventListener('change', function () { readFile(input.files && input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { readFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
    sampleBtn.addEventListener('click', function () { engine().then(function (M) { run(makeSample(M), '見本_文字化け.dxf'); }); });
  }
  function init() { Array.prototype.forEach.call(document.querySelectorAll('[data-dxf-mojibake]'), mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.DxfMojiWidget = { mount: mount };
})();
