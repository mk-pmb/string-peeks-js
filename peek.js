/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var CF, PT;
function isFunc(x) { return ((typeof x) === 'function'); }
function isNum(x) { return ((typeof x) === 'number'); }
function isRgx(x) { return (x instanceof RegExp); }
function isStr(x) { return ((typeof x) === 'string'); }
function arrLast(arr) { return arr[arr.length - 1]; }
function eq(x, y) { return (x === y); }


CF = function StringPeeksTextBuffer(text, opts) {
  var clone = (text instanceof CF);
  if (clone) {
    Object.assign(this, text);
  } else {
    this.byteOrderMark = '';
    this.buf = String(text || '');
    switch (this.buf[0]) {
    case CF.utf8ent.byteOrderMark:
      this.byteOrderMark = this.buf[0];
      this.buf = this.buf.slice(1);
      break;
    }
    this.name = '';
    this.maxPeek = 1024;
    this.peekPos = 0;
  }
  this.eaten = (clone ? text.eaten.slice(0) : []);
  this.eaten.curLn = (clone ? text.eaten.curLn : '');
  this.eaten.lnCnt = (clone ? text.eaten.lnCnt : 0);
  Object.assign(this, opts);
};
PT = CF.prototype;

CF.utf8ent = {
  byteOrderMark: '\uFEFF',
  latinSmallFWithHook: '\u0192', // "ƒ"
};
CF.rgxAllSurrogatePairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
CF.quot = function (x) { return (isStr(x) ? '"' + x + '"' : String(x)); };


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

PT.strlen_bytes = function strlen_bytes(x) { return Buffer.byteLength(x); };
PT.strlen_ucs2  = function strlen_ucs2(x) { return String(x).length; };
PT.strlen_chars = function strlen_chars(x) {
  return String(x).replace(CF.rgxAllSurrogatePairs).length;
};


PT.peekWin = function () {
  if (this.isEmpty()) { throw new Error('unexpected end of input'); }
  return (this.maxPeek ? this.buf.slice(0, this.maxPeek) : this.buf);
};


PT.filerIfFunc = function (data, func) {
  return (isFunc(func) ? func.call(this, data) : data);
};


PT.matchMark = function (mark) {
  var found;
  switch (typeof mark) {
  case 'number':
    found = ((mark >= 0) && (mark <= this.buf.length));
    if (found) { found = Object.assign([''], { index: mark }); }
    return found;
  case 'string':
    found = this.buf.indexOf(mark);
    if (found < 0) { return false; }
    return Object.assign([mark], { index: found });
  }
  if (isRgx(mark)) { return (this.buf.match(mark) || false); }
  throw new Error('unsupported mark type: ' + String(mark && typeof mark));
};


PT.peekMark = function (mark, ifNotFound, preprocess) {
  var win = this.peekWin();
  if (mark === '') {
    this.peekPos = win.length;
    return win;
  }
  mark = this.matchMark(mark);
  if (mark) {
    mark = mark.index + mark[0].length;
    this.peekPos = mark;
    win = win.slice(0, mark);
  } else {
    this.peekPos = 0;
    win = ifNotFound;
  }
  win = this.filterIfFunc(win, preprocess);
  return win;
};


PT.peekRemainder = function () { return this.buf; };
PT.peekLine = function (ifNF, pre) { return this.peekMark('\n', ifNF, pre); };
PT.eatLine = function () { return (this.peekLine() && this.eat()); };

PT.eatLinesBeforeMark = function (mark) {
  var eaten = '', ln;
  if (isStr(mark)) { mark = { exec: eq.bind(null, mark + '\n') }; }
  while (true) {
    ln = this.peekLine();
    if (!ln) { throw new Error('Cannot find end mark ' + CF.quot(mark)); }
    if (mark.exec(ln)) { return eaten; }
    eaten += this.eat();
  }
};


PT.peekTagRgx = /^\s*<([\x00-;=\?-\uFFFF]+)>/;
PT.peekTag = function (tagContentRgx, preprocess) {
  var tag = (this.peekWin().match(this.peekTagRgx) || false), match = false;
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
      throw new Error('Expected ' + tag + ' @ ' + this.calcPosLnChar().fmt());
    }
    preprocess = null;
    break;
  }
  match = this.filterIfFunc(match, preprocess);
  return match;
};


PT.filterIfFunc = function (text, maybeFunc) {
  return (isFunc(maybeFunc) ? maybeFunc(text) : text);
};


PT.eat = function () {
  if (this.peekPos < 1) { return ''; }
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


PT.eatUntilMarkOrEnd = function (mark, digest) {
  var found = this.matchMark(mark), eaten;
  this.peekPos = (found ? found.index : this.buf.length);
  eaten = this.eat();
  if (eaten) {
    if (Array.isArray(digest)) { digest[digest.length] = eaten; }
  }
  if ((typeof digest) === 'function') {
    eaten = digest(eaten, found, this);
    if (eaten !== undefined) { found = eaten; }
  }
  return found;
};


PT.willDrain = function (doit) {
  var result = doit(this);
  if (this.isEmpty()) { return result; }
  doit = String(doit).replace(/^function\s+/, CF.utf8ent.latinSmallFWithHook
    ).replace(/\s+/g, ' ').substr(0, 32);
  doit += '; leftover string[' + this.buf.length + '] ' +
    JSON.stringify(this.buf.substr(0, 128));
  throw new Error('Function failed to drain buffer: ' + doit);
};


CF.StringPeeksLineColumnPosition = (function (bpc, bpt) {
  bpc = function StringPeeksBufferPosition(ln, ch) {
    this.ln = ln;
    this.ch = ch;
  };
  bpt = bpc.prototype;
  bpt.fmt = function () { return PT.posFmt(this); };
  return bpc;
}());


PT.calcPosLnChar = function () {
  var eaten = this.eaten, ln = eaten.lnCnt, ch = this.eaten.curLn;
  ch = (ch ? this.strlen_chars(ch) : 0);
  return new CF.StringPeeksLineColumnPosition(ln, ch);
};


PT.posFmtLn = 'line \\L';
PT.posFmtLnCh = 'line \\L char \\C';
PT.posFmtNumStart = 1;
PT.posFmt = function (pos) {
  var fmt;
  if (isNum(pos.ln)) {
    fmt = 'Ln';
    if (isNum(pos.ch)) { fmt += 'Ch'; }
  }
  fmt = (fmt && this['posFmt' + fmt]);
  if (!fmt) { return JSON.stringify(pos); }
  return slashSlots(fmt, {
    L: pos.ln + this.posFmtNumStart,
    C: pos.ch + this.posFmtNumStart,
  });
};
















module.exports = CF;
