/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX = {}, CF, PT;
function ifFun(x, d) { return ((typeof x) === 'function' ? x : d); }
function isNum(x) { return ((typeof x) === 'number'); }
function isRgx(x) { return (x instanceof RegExp); }
function isStr(x) { return ((typeof x) === 'string'); }
function ifObj(x, d) { return ((x && typeof x) === 'object' ? x : d); }
function arrLast(arr) { return arr[arr.length - 1]; }
function chkEq(y) { return function (x) { return (x === y); }; }


CF = function StringPeeksTextBuffer(text, opt) {
  var spBuf = this, clone = (text instanceof CF), bom;
  opt = (opt || false);
  if (clone) {
    Object.assign(spBuf, text);
  } else {
    spBuf.name = '';
    text = String(text || '');
    spBuf.byteOrderMark = '';
    if (!opt.bomIsData) {
      bom = (text.match(EX.utf8ent.byteOrderMark_any_rgx) || false)[0];
      if (bom) {
        spBuf.byteOrderMark = bom;
        text = text.slice(bom.length);
      }
    }
    spBuf.buf = text;
    spBuf.peekPos = 0;
  }
  spBuf.eaten = (clone ? text.eaten.slice(0) : []);
  spBuf.eaten.curLn = (clone ? text.eaten.curLn : '');
  spBuf.eaten.lnCnt = (clone ? text.eaten.lnCnt : 0);
  spBuf.eaten.offset = (clone ? text.eaten.offset : 0);
  Object.assign(spBuf, opt);
};
PT = CF.prototype;

EX.utf8ent = {
  byteOrderMark: '\uFEFF',
  byteOrderMark_latin1: '\xEF\xBB\xBF',
  byteOrderMark_any_rgx: /^(?:\uFEFF|\xEF\xBB\xBF)/,
  latinSmallFWithHook: '\u0192', // "ƒ"
};

EX.rgxAllSurrogatePairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
EX.quot = function (x) { return (isStr(x) ? '"' + x + '"' : String(x)); };

EX.fromText = function (t, opt) { return new CF(t, opt); };

EX.fromBuffer = function (b, opt) {
  opt = (opt || false);
  if (typeof opt === 'string') { opt = { encoding: opt }; }
  return new CF(b.toString(opt.encoding || 'binary'), opt);
};


function slashSlots(tpl, data) {
  return String(tpl).replace(/(\\+)([A-Za-z])([0-9a-fA-F]{0,4})/g,
    slashSlots.rpl.bind(data));
}
slashSlots.rpl = function (m, sl, ch, hex) {
  ch = this[ch];
  if ((sl.length % 2) === 0) { ch = undefined; }
  if (ch === undefined) { return JSON.parse('"' + m + '"'); }
  return sl.substr(0, (sl.length - 1) / 2) + ch + hex;
};


PT.toString = function () {
  var remain = this.buf.length;
  return '['.concat(this.constructor.name, (remain === 0 ? ', empty'
    : (' +' + remain + ': ' + this.buf.slice(0, 32))), ']');
};


PT.clone = function () { return new CF(this); };
PT.isEmpty = function () { return (this.buf.length <= 0); };
PT.notEmpty = function () { return (this.buf.length > 0); };


PT.filterIfFunc = function (func, data) {
  if (!ifFun(func)) { return data; }
  return func.apply(this, Array.prototype.slice.call(arguments, 1
    ).concat(this));  // final "this" is to support bound functions
};


PT.matchMark = function (mark) {
  var found, buf = this.buf;
  switch (typeof mark) {
  case 'number':
    found = ((mark >= 0) && (mark <= buf.length));
    if (found) { found = Object.assign([''], { index: mark }); }
    return found;
  case 'string':
    if (!mark) { return false; }
    found = buf.indexOf(mark);
    if (found < 0) { return false; }
    return Object.assign([mark], { index: found });
  }
  if (isRgx(mark)) { return (buf.match(mark) || false); }
  throw new Error('unsupported mark type: ' + String(mark && typeof mark));
};


PT.peekChars = function (nChars) {
  // less fancy version of .peekMark(nChars)
  var buf = this.buf, tx = (nChars < buf.length ? buf.slice(0, nChars) : buf);
  if (tx.length !== nChars) { return false; }
  this.peekPos += nChars;
  return tx;
};


PT.eatChars = function () {
  return (this.peekChars.apply(this, arguments) && this.eat());
};


PT.peekMark = function (mark, ifNotFound, preprocess) {
  var includeMark = true, found, endpos, tx;
  if (ifObj(mark)) {
    if ((typeof mark.inc) === 'boolean') { includeMark = mark.inc; }
    mark = (mark.mark || mark.rgx || mark);
  }
  found = this.matchMark(mark);
  if (found) {
    endpos = found.index + (includeMark ? found[0].length : 0);
    this.peekPos = endpos;
    tx = this.buf.slice(0, endpos);
  } else {
    this.peekPos = 0;
    tx = ifNotFound;
  }
  tx = this.filterIfFunc(preprocess, tx, found);
  return tx;
};


PT.peekRemainder = function () {
  this.peekPos = this.buf.length;
  return this.buf;
};

PT.peekLine = function (ifNF, pre) { return this.peekMark('\n', ifNF, pre); };
PT.eatLine = function () { return (this.peekLine() && this.eat()); };


PT.eatLinesBeforeMark = function (mark) {
  var eaten = '';
  if (isStr(mark)) { mark = { exec: chkEq(mark + '\n') }; }
  while (true) {
    if (this.isEmpty()) { this.fail('Cannot find end mark ' + EX.quot(mark)); }
    if (mark.exec(this.peekLine())) { return eaten; }
    eaten += this.eat();
  }
};


PT.peekTagRgx = /^\s*<([\x00-;=\?-\uFFFF]+)>/;
PT.peekTag = function (tagContentRgx, preprocess) {
  var tag = (this.peekTagRgx.exec(this.buf) || false), match = false;
  this.peekPos = 0;
  if (tag) {
    match = tag[1];
    this.peekPos = tag[0].length;
    if (isRgx(tagContentRgx)) {
      match = tagContentRgx.exec(tag[1]);
      if (match) {
        (function (inner) {
          var attr = inner.match(/^(\S+)(?:\s+|\/?$)/);
          match.tagName = (attr ? attr[1] : inner);
          match.after = inner.slice(match[0].length);
          match.attr = (attr ? inner.slice(attr[0].length) : '');
          // ^-- redundant iff the tagContentRgx matched the same text as attr
        }(tag[1]));
      } else {
        match = false;
        this.peekPos = 0;
      }
    }
  }
  switch (preprocess) {
  case '||err':
    if (!match) {
      tag = 'any tag';
      if (isRgx(tagContentRgx)) { tag = 'a tag like ' + String(tagContentRgx); }
      this.fail('Expected ' + tag);
    }
    preprocess = null;
    break;
  }
  match = this.filterIfFunc(preprocess, match);
  return match;
};


PT.eat = function () {
  if (this.peekPos < 1) { return ''; }
  this.eaten.offset += this.peekPos;
  var afterLineFeed = false, eaten = this.eaten, lnCnt = 0,
    chunk = this.buf.slice(0, this.peekPos);
  this.buf = this.buf.slice(this.peekPos);
  this.peekPos = 0;
  eaten.push(chunk);
  chunk.replace(/\n+/g, function (lns, idx) {
    lns = lns.length;
    lnCnt += lns;
    afterLineFeed = idx + lns;
  });
  if (lnCnt) {
    eaten.lnCnt = +(eaten.lnCnt || 0) + lnCnt;
    eaten.curLn = chunk.slice(afterLineFeed);
  } else {
    eaten.curLn += chunk;
  }
  return chunk;
};


PT.ruminateCurrentLine = function () { return this.eaten.curLn; };


PT.eatUntilMarkOrEnd = function (mark, opt) {
  if (opt && Array.isArray(opt) && (opt.collect === undefined)) {
    throw new Error('API changed: ' +
      'An Array as opt is ambiguous without a .collect property.');
  }
  if (mark === null) { mark = (opt.rgx || opt.mark); }
  opt = (opt || false);
  if (ifFun(opt)) { opt = { digest: opt }; }
  var found = this.matchMark(mark), eaten, digest = opt.digest;
  if (found) {
    this.peekPos = found.index + (opt.eatMark === false ? 0 : found[0].length);
  } else {
    this.peekPos = this.buf.length;
  }
  eaten = this.eat();
  if (eaten && opt.collect) { opt.collect.push(eaten); }
  if (digest) {
    eaten = digest.call(this, eaten,
      // => To retrieve `eaten`, digest with `String` or the identity function.
      found,
      this);  // Final "this" is to support bound functions
    if (eaten !== undefined) { return eaten; }
  }
  return found;
};


PT.fail = function (why) {
  throw new Error(why +  ' @ ' + this.calcPosLnChar().fmt());
};


PT.willDrain = function (doit) {
  var self = this, result = doit(self);
  function verifyEmpty() {
    if (self.isEmpty()) { return result; }
    doit = String(doit).replace(/^function\s+/, EX.utf8ent.latinSmallFWithHook
      ).replace(/\s+/g, ' ').substr(0, 32);
    self.fail('Function failed to drain buffer: ' + doit +
      '; leftover string[' + self.buf.length + '] ' +
      JSON.stringify(self.buf.substr(0, 128)));
  }
  if (ifFun(result.then)) { return result.then(verifyEmpty); }
  return verifyEmpty();
};


CF.StringPeeksLineColumnPosition = (function (bpc) {
  bpc = function StringPeeksBufferPosition(spBuf) {
    var eaten = spBuf.eaten;
    this.ln = eaten.lnCnt;
    this.ch = eaten.curLn.length;
    this.offset = eaten.offset;
    this.toString = this.fmt = function () { return spBuf.posFmt(this); };
  };
  return bpc;
}());


PT.calcPosLnChar = function () {
  return new CF.StringPeeksLineColumnPosition(this);
};


PT.posFmtLn = 'line \\L';
PT.posFmtLnOf = 'line \\L (offset \\@)';
PT.posFmtLnCh = 'line \\L char \\C';
PT.posFmtLnOf = 'line \\L char \\C (offset \\@)';
PT.posFmtNumStart = 1;
PT.posFmt = function (pos) {
  var fmt;
  if (isNum(pos.ln)) {
    fmt = 'Ln';
    if (isNum(pos.ch)) { fmt += 'Ch'; }
    if (isNum(pos.offset)) { fmt += 'Of'; }
  }
  fmt = (fmt && this['posFmt' + fmt]);
  if (!fmt) { return JSON.stringify(pos); }
  return slashSlots(fmt, {
    L: pos.ln + this.posFmtNumStart,
    C: pos.ch + this.posFmtNumStart,
    '@': pos.offset,
  });
};


PT.rangeStartPos = function (r) {
  var eaten = this.eaten;
  if (!r) { r = {}; }
  r.startOffset = eaten.offset;
  r.startLine = eaten.lnCnt;
  return r;
};


PT.rangeEndPos = function (r) {
  var eaten = this.eaten;
  if (!r) { r = {}; }
  r.endOffset = eaten.offset;
  r.endLine = eaten.lnCnt;
  r.lenChars = r.endOffset - (+r.startOffset || 0);
  r.lenLines = r.endLine - (+r.startLine || 0);
  return r;
};


PT.anomaly = function (id, details) {
  var accept = (this.acceptAnomalies || false)[id],
    descr = (this.anomalyDescrs || false);
  if (ifFun(accept)) { accept = accept.call(this, id, details); }
  if (accept === true) { return; }
  descr = (descr[id] || descr[''] || '');
  if (descr) { descr = ' (' + descr + ')'; }
  if (details === undefined) {
    details = (this.isEmpty() ? 'at end of input'
      : 'next up: ' + JSON.stringify(this.buf.slice(0, 32)));
  } else {
    details = (JSON.stringify(details, null, 2)
      || String(details)).replace(/\n */g, ' ');
  }
  this.fail('Anomaly ' + id + descr + ': ' + details);
};

















module.exports = EX;
