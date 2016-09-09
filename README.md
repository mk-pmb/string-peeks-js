
string-peeks
============
* Peek into start of a string,
* ignore its leading UTF-8 BOM,
* throw an Error if there's no more string,
* remeber how much you've peeked already,
* discard that part.

Also knows some tricks about angle brackets.


Usage
-----
:TODO:


```javascript
var StringPeeks = require('string-peeks'),
  buf = new StringPeeks('Hello {{name}}!');
```


License
-------
ISC
