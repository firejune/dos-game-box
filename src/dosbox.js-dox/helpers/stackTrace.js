'use strict';

function demangle(func) {
  var hasLibcxxabi = !!Module["___cxa_demangle"];
  if (hasLibcxxabi) {
    try {
      var buf = Module._malloc(func.length);
      Module.writeStringToMemory(func.substr(1), buf);
      var status = Module._malloc(4);
      var ret = Module["___cxa_demangle"](buf, 0, 0, status);
      if (Module.getValue(status, "i32") === 0 && ret) {
        return Module.Pointer_stringify(ret)
      }
    } catch (e) {} finally {
      if (buf) Module._free(buf);
      if (status) Module._free(status);
      if (ret) Module._free(ret)
    }
  }
  var i = 3;
  var basicTypes = {
    "v": "void",
    "b": "bool",
    "c": "char",
    "s": "short",
    "i": "int",
    "l": "long",
    "f": "float",
    "d": "double",
    "w": "wchar_t",
    "a": "signed char",
    "h": "unsigned char",
    "t": "unsigned short",
    "j": "unsigned int",
    "m": "unsigned long",
    "x": "long long",
    "y": "unsigned long long",
    "z": "..."
  };
  var subs = [];
  var first = true;

  function dump(x) {
    if (x) Module.print(x);
    Module.print(func);
    var pre = "";
    for (var a = 0; a < i; a++) pre += " ";
    Module.print(pre + "^")
  }

  function parseNested() {
    i++;
    if (func[i] === "K") i++;
    var parts = [];
    while (func[i] !== "E") {
      if (func[i] === "S") {
        i++;
        var next = func.indexOf("_", i);
        var num = func.substring(i, next) || 0;
        parts.push(subs[num] || "?");
        i = next + 1;
        continue
      }
      if (func[i] === "C") {
        parts.push(parts[parts.length - 1]);
        i += 2;
        continue
      }
      var size = parseInt(func.substr(i));
      var pre = size.toString().length;
      if (!size || !pre) {
        i--;
        break
      }
      var curr = func.substr(i + pre, size);
      parts.push(curr);
      subs.push(curr);
      i += pre + size
    }
    i++;
    return parts
  }

  function parse(rawList, limit, allowVoid) {
    limit = limit || Infinity;
    var ret = "",
      list = [];

    function flushList() {
      return "(" + list.join(", ") + ")"
    }
    var name;
    if (func[i] === "N") {
      name = parseNested().join("::");
      limit--;
      if (limit === 0) return rawList ? [name] : name
    } else {
      if (func[i] === "K" || first && func[i] === "L") i++;
      var size = parseInt(func.substr(i));
      if (size) {
        var pre = size.toString().length;
        name = func.substr(i + pre, size);
        i += pre + size
      }
    }
    first = false;
    if (func[i] === "I") {
      i++;
      var iList = parse(true);
      var iRet = parse(true, 1, true);
      ret += iRet[0] + " " + name + "<" + iList.join(", ") + ">"
    } else {
      ret = name
    }
    paramLoop: while (i < func.length && limit-- > 0) {
      var c = func[i++];
      if (c in basicTypes) {
        list.push(basicTypes[c])
      } else {
        switch (c) {
          case "P":
            list.push(parse(true, 1, true)[0] + "*");
            break;
          case "R":
            list.push(parse(true, 1, true)[0] + "&");
            break;
          case "L":
            {
              i++;
              var end = func.indexOf("E", i);
              var size = end - i;list.push(func.substr(i, size));i += size + 2;
              break
            };
          case "A":
            {
              var size = parseInt(func.substr(i));i += size.toString().length;
              if (func[i] !== "_") throw "?";i++;list.push(parse(true, 1, true)[0] + " [" + size + "]");
              break
            };
          case "E":
            break paramLoop;
          default:
            ret += "?" + c;
            break paramLoop
        }
      }
    }
    if (!allowVoid && list.length === 1 && list[0] === "void") list = [];
    if (rawList) {
      if (ret) {
        list.push(ret + "?")
      }
      return list
    } else {
      return ret + flushList()
    }
  }
  var parsed = func;
  try {
    if (func == "Object._main" || func == "_main") {
      return "main()"
    }
    if (typeof func === "number") func = Module.Pointer_stringify(func);
    if (func[0] !== "_") return func;
    if (func[1] !== "_") return func;
    if (func[2] !== "Z") return func;
    switch (func[3]) {
      case "n":
        return "operator new()";
      case "d":
        return "operator delete()"
    }
    parsed = parse()
  } catch (e) {
    parsed += "?"
  }
  if (parsed.indexOf("?") >= 0 && !hasLibcxxabi) {
    Module.Runtime.warnOnce("warning: a problem occurred in builtin C++ name demangling; build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling")
  }
  return parsed
}

function demangleAll(text) {
  return text.replace(/__Z[\w\d_]+/g, (function(x) {
    var y = demangle(x);
    return x === y ? x : x + " [" + y + "]"
  }))
}

function jsStackTrace() {
  var err = new Error;
  if (!err.stack) {
    try {
      throw new Error(0)
    } catch (e) {
      err = e
    }
    if (!err.stack) {
      return "(no stack trace available)"
    }
  }
  return err.stack.toString()
}

module.exports = function stackTrace() {
  return demangleAll(jsStackTrace())
};
