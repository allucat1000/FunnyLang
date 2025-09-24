const canv = document.getElementById("canv")
const ctx = canv.getContext("2d");

navigator.storage.persist();

openDB();

let funcDepth = 0;
let closed = null;
let startPerf;

let mem = {};

function tokenize(rawCode) {
  const statements = [];
  let cur = "";
  let braceDepth = 0;

  for (let i = 0; i < rawCode.length; i++) {
    const ch = rawCode[i];

    if (ch === "{") {
      braceDepth++;
      cur += ch;
    } else if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      cur += ch;
    } else if ((ch === ";" || ch === "\n" || ch === "\r") && braceDepth === 0) {
      if (cur.trim()) statements.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) statements.push(cur.trim());

  return statements.map((line, idx) => {
    if (!line) {
      closed = 1;
      console.error(`Empty command at line ${idx + 1}`);
      return null;
    }

    const firstWord = line.split(/\s+/)[0];
    const isBlockCommand = ["if", "loop", "while", "func"].includes(firstWord);

    if (isBlockCommand && line.includes("{") && line.includes("}")) {
      const beforeBrace = line.substring(0, line.indexOf("{")).trim().split(/\s+/);
      const inside = line.substring(line.indexOf("{") + 1, line.lastIndexOf("}")).trim();
      const cmd = beforeBrace.shift();

      return {
        cmd,
        params: [...beforeBrace, "{", inside, "}"],
        lineNumber: idx + 1
      };
    }

    const params = [...line.matchAll(/(?:[^\s"]+|"[^"]*")+/g)].map(m => m[0]);
    const cmd = params.shift();

    if (!cmd) {
      closed = 1;
      console.error(`Missing command at line ${idx + 1}`);
      return null;
    }

    return { cmd, params, lineNumber: idx + 1 };
  });
}


function parseExpression(params, lineNumber) {
    if (params.length < 3) {
        closed = 1;
        console.error(`Expression expected. Line: ${lineNumber}`);
        return null;
    }
    if (params[1] !== "=" && params[1] !== "==") {
        closed = 1;
        console.error(`Assignment operator expected. Line: ${lineNumber}`);
        return null;
    }
    const target = params[0];
    const exprTokens = params.slice(2);
    if (exprTokens.length === 0) { closed = 1; console.error(`Expression required. Line: ${lineNumber}`); return null; }
    return { target, exprTokens };
}

async function execute(rawCode, evalEnv = false) {
    funcDepth = 0;
    const commands = tokenize(rawCode);
    for (const { cmd, params, lineNumber } of commands) {
        if (closed !== null) break;
        await runLine(cmd, params, lineNumber);
    }
    if (!evalEnv) console.log(`[ Exited application with code ${Math.round(parseFloat(closed)) || 0} ]`);
}

function resolveValue(token) {
    if (token && token.type === "varRef") return mem[token.varName];
    return token;
}

async function runLine(cmd, params, lineNumber, inFunc = false) {
    switch (cmd) {
        case "#": {
            break;
        }
        case "rend": {
            function tokenizeExpr(str) {
                return [...str.matchAll(/(?:[^\s"]+|"[^"]*")+/g)].map(m => m[0]);
            }
            let posParams = params.join(" ").split(",");
            if (posParams[0].trim().replace(/^["']|["']$/g, '') == "sqr") {
                if (posParams.length < 6) {
                    console.error(`6 inputs expected. Line: ${lineNumber}`);
                    closed = 1;
                    return null;
                }
                ctx.fillStyle = posParams[1].trim().replace(/^["']|["']$/g, '');

                const x = await evaluateExpression(tokenizeExpr(posParams[2].trim()), lineNumber);
                const y = await evaluateExpression(tokenizeExpr(posParams[3].trim()), lineNumber);
                const w = await evaluateExpression(tokenizeExpr(posParams[4].trim()), lineNumber);
                const h = await evaluateExpression(tokenizeExpr(posParams[5].trim()), lineNumber);

                ctx.fillRect(x, y, w, h);
            }
            break;
        }
        // Spooky!
        case "eval": {
            if (params.length < 1) {
                closed = 1;
                console.error(`1 or more inputs expected. Line: ${lineNumber}`);
                return null;
            }
            let codeStr = await evaluateExpression(params, lineNumber);
        
            await execute(codeStr, true);
            break;
        }
        case "break": {
            if (inFunc) {
                return "Break"
            }
        }
        case "exit": {
            closed = params[0] || 0;
            break;
        }
        case "var": {
            const { target, exprTokens } = parseExpression(params, lineNumber);
            mem[target] = await evaluateExpression(exprTokens, lineNumber);
            break;
        }
        case "log": {
            if (params.length === 0) { closed = 1; console.error(`At least one argument required for log. Line: ${lineNumber}`); return null; }
            console.log(await evaluateExpression(params, lineNumber) ?? null);
            break;
        }
        case "func": {
            if (params.length < 3) {
                closed = 1;
                console.error(`Function name and body required. Line: ${lineNumber}`);
                return null;
            }

            const funcNameParams = params[0];
            const match = funcNameParams.match(/^(\w+)\((.*)\)$/);
            if (!match) {
                closed = 1;
                console.error(`Invalid function declaration. Line: ${lineNumber}`);
                return null;
            }

            const funcName = match[1];
            const paramNames = match[2].split(",").map(s => s.trim()).filter(Boolean);

            const bodyStart = params.indexOf("{");
            const bodyEnd = params.lastIndexOf("}");
            if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
                closed = 1;
                console.error(`Function body must be wrapped in { }. Line: ${lineNumber}`);
                return null;
            }

            const rawFuncCode = params[bodyStart + 1];

            mem[`func:${funcName}`] = {
                params: paramNames,
                code: tokenize(rawFuncCode).filter(Boolean)
            };
            break;
        }


        case "if": {
            if (params.length < 3) {
                closed = 1;
                console.error(`If statement and body required. Line: ${lineNumber}`);
                return null;
            }

            const bodyStart = params.indexOf("{");
            if (bodyStart === -1) {
                closed = 1;
                console.error(`Missing '{' in if statement. Line: ${lineNumber}`);
                return null;
            }

            const conditionTokens = params.slice(0, bodyStart);
            const conditionResult = await evaluateExpression(conditionTokens, lineNumber);

            if (!conditionResult) break;

            const bodyEnd = params.lastIndexOf("}");
            if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
                closed = 1;
                console.error(`Function body must be wrapped in { }. Line: ${lineNumber}`);
                return null;
            }

            const rawFuncCode = params[bodyStart + 1];
            const code = tokenize(rawFuncCode).filter(Boolean);
            funcDepth++;
            if (funcDepth > 5000) {
                closed = 1;
                console.error(`Maximum recursion depth (5000) reached at line ${lineNumber}`);
                return;
            }

            for (const { cmd, params, lineNumber: fnLine } of code) {
                if (closed !== null) break;
                const data = await runLine(cmd, params, fnLine, true);
                if (data == "Break") break;
            }

            funcDepth--;
            break;
        }

        case "loop": {
            if (params.length < 3) {
                closed = 1;
                console.error(`Loop amount and body required. Line: ${lineNumber}`);
                return null;
            }

            const bodyStart = params.indexOf("{");
            if (bodyStart === -1) {
                closed = 1;
                console.error(`Missing '{' in loop statement. Line: ${lineNumber}`);
                return null;
            }

            const conditionTokens = params.slice(0, bodyStart);
            const numberResult = await evaluateExpression(conditionTokens, lineNumber);

            if (parseFloat(numberResult) <= 0) break;

            const bodyEnd = params.lastIndexOf("}");
            if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
                closed = 1;
                console.error(`Function body must be wrapped in { }. Line: ${lineNumber}`);
                return null;
            }

            const rawFuncCode = params[bodyStart + 1];
            const code = tokenize(rawFuncCode).filter(Boolean);
            funcDepth++;
            if (funcDepth > 5000) {
                closed = 1;
                console.error(`Maximum recursion depth (5000) reached. Line: ${lineNumber}`);
                return;
            }
            for (let i = 0; i < parseFloat(numberResult); i++) {
                for (const { cmd, params, lineNumber: fnLine } of code) {
                    if (closed !== null) break;
                    const data = await runLine(cmd, params, fnLine, true);
                    if (data == "Break") break;
                }
            }

            funcDepth--;
            break;
        }

        case "fnl:idbSet": {
            if (params.length < 2) { closed = 1; console.error(`2 inputs expected. Line: ${lineNumber}`); return null; }
            const path = await evaluateExpression([params[0]], lineNumber);
            const data = await evaluateExpression([params[1]], lineNumber);
            await idbSaveData(path, data);
            break;
        }

        case "while": {
            if (params.length < 3) {
                closed = 1;
                console.error(`Loop amount and body required. Line: ${lineNumber}`);
                return null;
            }

            const bodyStart = params.indexOf("{");
            if (bodyStart === -1) {
                closed = 1;
                console.error(`Missing '{' in loop statement. Line: ${lineNumber}`);
                return null;
            }

            const conditionTokens = params.slice(0, bodyStart);
            let conditionResult = await evaluateExpression(conditionTokens, lineNumber);

            if (!conditionResult) break;

            const bodyEnd = params.lastIndexOf("}");
            if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
                closed = 1;
                console.error(`Function body must be wrapped in { }. Line: ${lineNumber}`);
                return null;
            }

            const rawFuncCode = params[bodyStart + 1];
            const code = tokenize(rawFuncCode).filter(Boolean);
            funcDepth++;
            if (funcDepth > 5000) {
                closed = 1;
                console.error(`Maximum recursion depth (5000) reached at line ${lineNumber}`);
                return;
            }
            while (await evaluateExpression(conditionTokens, lineNumber)) {
                for (const { cmd, params, lineNumber: fnLine } of code) {
                    if (closed !== null) break;
                    const data = await runLine(cmd, params, fnLine);
                    if (data == "Break") break;
                }
            }

            funcDepth--;
            break;
        }

        default: {
            const funcKey = cmd.startsWith("func:") ? cmd.slice(5) : cmd;
            const func = mem[`func:${funcKey}`];

            if (func) {
                funcDepth++;
                if (funcDepth > 5000) {
                    closed = 1;
                    console.error(`Maximum recursion depth (5000) reached at line ${lineNumber}`);
                    return;
                }

                const localMem = { ...mem };
                for (let i = 0; i < func.params.length; i++) {
                    const argValue = params[i] !== undefined ? await evaluateExpression([params[i]], lineNumber) : null;
                    localMem[func.params[i]] = argValue;
                }

                const oldMem = mem;
                mem = localMem;
                for (const { cmd, params, lineNumber: fnLine } of func.code) {
                    if (closed !== null) break;
                    const data = await runLine(cmd, params, fnLine);
                    if (data == "Break") break;
                }
                mem = oldMem;

                funcDepth--;
            } else {
                console.error(`Unknown command '${cmd}'. Line: ${lineNumber}`);
                closed = 1;
                return;
            }
        }

    }
}

async function shuntingYard(tokens, lineNumber) {
    const output = [];
    const ops = [];
    const precedence = {
        "==": 0, "!=": 0, "<": 0, ">": 0, "<=": 0, ">=": 0,
        "+": 1, "-": 1,
        "*": 2, "/": 2,
        "push": 3,
        "pop": 3,
        "slice": 3,
        "splice": 3
    };
    const rightAssoc = {};

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (!isNaN(token)) {
            output.push({ type: "literal", value: Number(token) });
        } else if (token.startsWith('"') && token.endsWith('"')) {
            output.push({ type: "literal", value: token.slice(1, -1) });
        } else if (token === "fnl:performance") {
            output.push({ type: "literal", value: performance.now() - startPerf });
        } else if (token === "fnl:width" || token === "fnl.height") {
            if (token.endsWith("t")) output.push({ type: "literal", value: canv.height }); else output.push({ type: "literal", value: canv.width });
        } else if (token == "fnl:idbGet") {
            const path = await evaluateExpression([tokens[++i]], lineNumber);
            output.push({ type: "literal", value: await idbLoadData(path) });
        } else if (token === "fnl:fetch") {
            let url = await evaluateExpression([tokens[++i]], lineNumber);
            if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
            try {
                const resp = await fetch(url)
                const data = {
                    status: resp.status,
                    ok: resp.ok,
                    headers: resp.headers,
                    body: await resp.text()
                }
                output.push({ type: "literal", value: data });
            } catch {
                console.error(`Failed to fetch '${url}'. Line: ${lineNumber}`);
                closed = 1;
                return [];
            }
        } else if (token === "random") {
            const min = await evaluateExpression([tokens[++i]], lineNumber);
            const max = await evaluateExpression([tokens[++i]], lineNumber);
            output.push({ type: "literal", value: (Math.random() * (max - min + 1)) + min });
        } else if (token === "round") {
            const num = await evaluateExpression([tokens[++i]], lineNumber);
            output.push({ type: "literal", value: Math.round(num) });
        } else if (token.startsWith("var:")) {
            const pointer = token.slice(4);
            output.push({ type: "varRef", varName: pointer });
        } else if (token in precedence) {
            while (
                ops.length &&
                (ops[ops.length - 1] in precedence) &&
                ((rightAssoc[token] && precedence[token] < precedence[ops[ops.length - 1]]) ||
                 (!rightAssoc[token] && precedence[token] <= precedence[ops[ops.length - 1]]))
            ) {
                output.push(ops.pop());
            }
            ops.push(token);
        } else if (token === "(") {
            ops.push(token);
        } else if (token === ")") {
            while (ops.length && ops[ops.length - 1] !== "(") {
                output.push(ops.pop());
            }
            if (!ops.length) {
                closed = 1;
                console.error("Mismatched parentheses");
                return [];
            }
            ops.pop();
        } else if ((token.startsWith("{") && token.endsWith("}")) || 
           (token.startsWith("[") && token.endsWith("]"))) {
            try {
                output.push({ type: "literal", value: JSON.parse(token) });
            } catch (e) {
                closed = 1;
                console.error(`Invalid JSON literal '${token}'. Line: ${lineNumber}`);
                return [];
            }
        } else if (token === "true") {
            output.push({ type: "literal", value: true });
        } else if (token === "false") {
            output.push({ type: "literal", value: false });
        } else if (token === "null") {
            output.push({ type: "literal", value: null });
        } else {
            closed = 1;
            console.error(`Unknown token '${token}'. Line: ${lineNumber}`);
            return [];
        }
    }

    while (ops.length) {
        const op = ops.pop();
        if (op === "(" || op === ")") {
            closed = 1;
            console.error("Mismatched parentheses");
            return [];
        }
        output.push(op);
    }

    return output;
}

function evaluateRPN(rpn, lineNumber) {
    const stack = [];
    for (const token of rpn) {
        if (token && typeof token === "object" && token.type === "literal") {
            stack.push(token.value);
        } else if (token && typeof token === "object" && token.type === "varRef") {
            stack.push(token);
        } else if (typeof token === "string" && ["+", "-", "*", "/", "==", "!=", "<", ">", "<=", ">="].includes(token)) {
            if (stack.length < 2) {
                closed = 1;
                console.error(`Not enough operands for '${token}'. Line: ${lineNumber}`);
                return null;
            }
            const rawB = stack.pop();
            const rawA = stack.pop();
            const a = resolveValue(rawA);
            const b = resolveValue(rawB);
            switch (token) {
                case "+": stack.push(typeof a === "number" && typeof b === "number" ? a + b : String(a) + String(b)); break;
                case "-": stack.push(Number(a) - Number(b)); break;
                case "*": stack.push(Number(a) * Number(b)); break;
                case "/": stack.push(Number(a) / Number(b)); break;
                case "==": stack.push(a == b); break;
                case "!=": stack.push(a != b); break;
                case "<":  stack.push(a < b); break;
                case ">":  stack.push(a > b); break;
                case "<=": stack.push(a <= b); break;
                case ">=": stack.push(a >= b); break;
            }
        } else if (typeof token === "string" && ["push", "pop", "slice", "splice"].includes(token)) {
            switch (token) {
                case "push": {
                    if (stack.length < 2) { 
                        closed = 1; 
                        console.error(`push requires [arrayVar, value]. Line: ${lineNumber}`); 
                        return null; 
                    }
                    let val = stack.pop();
                    const arrRef = stack.pop();

                    val = resolveValue(val);

                    if (!arrRef || arrRef.type !== "varRef") { 
                        closed = 1; 
                        console.error(`push target must be a var reference. Line: ${lineNumber}`); 
                        return null; 
                    }

                    if (!Array.isArray(mem[arrRef.varName])) {
                        closed = 1;
                        console.error(`Variable '${arrRef.varName}' is not an array. Line: ${lineNumber}`);
                        return null;
                    }

                    mem[arrRef.varName].push(val);
                    stack.push(mem[arrRef.varName]);
                    break;
                }
                case "pop": {
                    if (stack.length < 1) { 
                        closed = 1; 
                        console.error(`pop requires [arrayVar]. Line: ${lineNumber}`); 
                        return null; 
                    }
                    const arrRef = stack.pop();
                    if (!arrRef || arrRef.type !== "varRef") { 
                        closed = 1; 
                        console.error(`pop target must be a var reference. Line: ${lineNumber}`); 
                        return null; 
                    }
                    if (!Array.isArray(mem[arrRef.varName])) { 
                        closed = 1; 
                        console.error(`Variable '${arrRef.varName}' is not an array. Line: ${lineNumber}`); 
                        return null; 
                    }
                    stack.push(mem[arrRef.varName].pop());
                    break;
                }
                case "slice": {
                    if (stack.length < 3) { closed = 1; console.error(`slice requires [array, start, end]. Line: ${lineNumber}`); return null; }
                    const end = stack.pop();
                    const start = stack.pop();
                    const arrRef = stack.pop();
                    if (!Array.isArray(mem[arrRef.varName])) {
                        closed = 1;
                        console.error(`Variable '${arrRef.varName}' is not an array. Line: ${lineNumber}`);
                        return null;
                    }
                    stack.push(mem[arrRef.varName].slice(start, end));
                    break;
                }
                case "splice": {
                    if (stack.length < 3) { closed = 1; console.error(`splice requires [array, start, deleteCount]. Line: ${lineNumber}`); return null; }
                    const deleteCount = stack.pop();
                    const start = stack.pop();
                    const arrRef = stack.pop();
                    if (!Array.isArray(mem[arrRef.varName])) {
                        closed = 1;
                        console.error(`Variable '${arrRef.varName}' is not an array. Line: ${lineNumber}`);
                        return null;
                    }
                    mem[arrRef.varName].splice(start, deleteCount);
                    stack.push(mem[arrRef.varName]);
                    break;
                }

            }
        } else {
            closed = 1;
            console.error(`Unknown RPN token '${token}'. Line: ${lineNumber}`);
            return null;
        }
    }

    if (stack.length !== 1) {
        closed = 1;
        console.error("Invalid expression (stack not reduced to single result).");
        return null;
    }

    return stack[0];
}



async function evaluateExpression(exprTokens, lineNumber) {
    const rpn = await shuntingYard(exprTokens, lineNumber);
    if (!rpn.length) return null;

    let result = evaluateRPN(rpn, lineNumber);
    if (closed !== null) return null;

    while (result && result.type === "varRef") {
        result = mem[result.varName];
    }

    return result;
}

const input = document.getElementById("code");
input.addEventListener("keydown", (e) => {
    if (e.altKey && e.key == "Enter") {
        ctx.clearRect(0, 0, canv.width, canv.height);
        startPerf = performance.now()
        console.clear()
        mem = {};
        closed = null;
        execute(input.value);
    }
})

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("fnlSandbox", 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("vars")) {
                db.createObjectStore("vars");
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function idbSaveData(varName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("vars", "readwrite");
        const store = tx.objectStore("vars");
        store.put(value, varName);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbLoadData(varName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("vars", "readonly");
        const store = tx.objectStore("vars");
        const req = store.get(varName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}