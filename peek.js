/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var CF, PT;
function isNum(x) { return ((typeof x) === 'number'); }
function isFunc(x) { return ((typeof x) === 'function'); }
function isRgx(x) { return (x instanceof RegExp); }
function arrLast(arr) { return arr[arr.length - 1]; }


CF = function StringPeeksTextBuffer(text, opts) {
  this.byteOrderMark = '';
  switch (text[0]) {
  case CF.utf8ent.byteOrderMark:
    this.byteOrderMark = text[0];
    text = text.slice(1);
    break;
  }
  this.eaten = [];
  this.eaten.curLn = '';
  this.eaten.lnCnt = 0;
  this.buf = String(text || '');
  this.name = '';
  this.maxPeek = 1024;
  this.peekPos = 0;
  Object.assign(this, opts);
};
PT = CF.prototype;

CF.utf8ent = {
  byteOrderMark: '\uFEFF',
  latinSmallFWithHook: '\u0192', // "ƒ"
};
CF.rgxAllSurrogatePairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;


function slashSlots(m) {
  var slot = this[m[1]];
  if (slot !== undefined) { return slot; }
  return JSON.parse('"' + m + '"');
}


PT.toString = function () {
  var remain = this.buf.length;
  return '['.concat(this.constructor.name, (remain === 0 ? ', empty'
    : (' +' + remain + ': ' + this.buf.slice(0, 32))), ']');
};


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


PT.peekMark = function (mark, ifNotFound, preprocess) {
  var win = this.peekWin();
  if (mark === '') {
    this.peekPos = win.length;
    return win;
  }
  mark = (isRgx(mark) ? win.search(mark) : win.indexOf(mark));
  if (mark < 0) {
    this.peekPos = 0;
    win = ifNotFound;
  } else {
    this.peekPos = mark;
    win = win.slice(0, mark);
  }
  win = this.filterIfFunc(win, preprocess);
  return win;
};


PT.peekLine = function (ifNF, pre) { return this.peekMark('\n', ifNF, pre); };


PT.peekTagRgx = /^[\n\s]*<([\x00-;=\?-\uFFFF]+)>/;
PT.peekTag = function (tagContentRgx, preprocess) {
  var tag = (this.peekWin().match(this.peekTagRgx) || false), match = false;
  this.peekPos = 0;
  if (tag) {
    match = tag[1];
    this.peekPos = tag[0].length;
    if (isRgx(tagContentRgx)) {
      match = tagContentRgx.exec(tag[1]);
      if (match) {
        (function (inner, attr) {
          attr = inner.match(/^(\S+)[\s\n]+/);
          match.tagName = (attr ? attr[1] : inner);
          match.attr = (attr ? inner.subtr(attr[0].length, inner.length) : '');
          match.after = inner.slice(match[0].length);
        }(tag[1]));
      } else {
        match = false;
        this.peekPos = 0;
      }
    }
  }
  if (preprocess === Error) {
    if (!match) {
      tag = 'any tag';
      if (isRgx(tagContentRgx)) { tag = 'a tag like ' + String(tagContentRgx); }
      throw new Error('Expected ' + tag);
    }
    preprocess = null;
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
    ).replace(/[\s\n]+/g, ' ').substr(0, 32);
  doit += '; leftover string[' + this.buf.length + '] ' +
    JSON.stringify(this.buf.substr(0, 128));
  throw new Error('Function failed to drain buffer: ' + doit);
};


PT.calcPosLnChar = function () {
  var eaten = this.eaten, ln = eaten.lnCnt, ch = this.eaten.curLn;
  ch = (ch ? this.strlen_chars(ch) : 0);
  eaten = [ln, ch];
  eaten.ln = ln;
  eaten.ch = ch;
  eaten.fmt = this.posFmt.bind(this, eaten);
  return eaten;
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
  return fmt.replace(/\\[LC]/g, slashSlots.bind({
    L: pos.ln + this.posFmtNumStart,
    C: pos.ch + this.posFmtNumStart,
  }));
};
















module.exports = CF;
