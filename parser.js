const consoleEl = document.getElementById("console")
let funcDepth = 0;
let closed = null;

console.log = (...args) => {
    consoleEl.value += "\n[LOG] " + args.map(a => JSON.stringify(a)).join(" ");
}
console.error = (...args) => {
    consoleEl.value += "\n[ERROR] " + args.map(a => JSON.stringify(a)).join(" ");
}

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

    if (line.includes("{") && line.includes("}")) {
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

async function execute(rawCode) {
    const perf = performance.now();
    funcDepth = 0;
    const commands = tokenize(rawCode);
    for (const { cmd, params, lineNumber } of commands) {
        if (closed !== null) break;
        await runLine(cmd, params, lineNumber);
    }
    consoleEl.value += `\n\n[ Exited application with code ${Math.round(parseFloat(closed)) || 0} ]`;
    consoleEl.value += `\n\n[ Execution time: ${performance.now() - perf}ms ]`
}

async function runLine(cmd, params, lineNumber) {
    switch (cmd) {
        case "#": {
            break;
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

            const funcName = params[0];
            if (!funcName.endsWith(")")) {
                closed = 1;
                console.error(`() required for function name. Line: ${lineNumber}`);
                return null;
            }

            const bodyStart = params.indexOf("{");
            const bodyEnd = params.lastIndexOf("}");
            if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
                closed = 1;
                console.error(`Function body must be wrapped in { }. Line: ${lineNumber}`);
                return null;
            }

            const rawFuncCode = params[bodyStart + 1];

            mem[`func:${funcName}`] = tokenize(rawFuncCode).filter(Boolean);
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
                await runLine(cmd, params, fnLine);
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
                console.error(`Maximum recursion depth (5000) reached at line ${lineNumber}`);
                return;
            }
            for (let i = 0; i < parseFloat(numberResult); i++) {
                for (const { cmd, params, lineNumber: fnLine } of code) {
                    if (closed !== null) break;
                    await runLine(cmd, params, fnLine);
                }
            }

            funcDepth--;
            break;
        }

        default: {
            const funcKey = cmd;
            if (mem[funcKey] && cmd.startsWith("func:")) {
                funcDepth++;
                if (funcDepth > 5000) {
                    closed = 1;
                    console.error(`Maximum recursion depth (5000) reached at line ${lineNumber}`);
                    return;
                }

                for (const { cmd, params, lineNumber: fnLine } of mem[funcKey]) {
                    if (closed !== null) break;
                    runLine(cmd, params, fnLine);
                }

                funcDepth--;
            } else {
                console.error(`Unknown command '${cmd}'. Line: ${lineNumber}`);
                closed = 1;
                return;
            }

        }
    }
}

function shuntingYard(tokens, lineNumber) {
    const output = [];
    const ops = [];
    const precedence = {
        "==": 0, "!=": 0, "<": 0, ">": 0, "<=": 0, ">=": 0,
        "+": 1, "-": 1,
        "*": 2, "/": 2
    };
    const rightAssoc = {};

    for (const token of tokens) {
        if (!isNaN(token)) {
            output.push({ type: "literal", value: Number(token) });
        } else if (token.startsWith('"') && token.endsWith('"')) {
            output.push({ type: "literal", value: token.slice(1, -1) });
        } else if (token.startsWith("var:")) {
            const pointer = token.slice(4);
            if (!(pointer in mem)) {
                closed = 1;
                console.error(`Variable '${pointer}' not defined. Line: ${lineNumber}`);
                return [];
            }
            output.push({ type: "literal", value: mem[pointer] });
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
            if (ops.length === 0) {
                closed = 1;
                console.error("Mismatched parentheses");
                return [];
            }
            ops.pop();
        } else if (token == "true") {
            output.push({ type: "literal", value: true });
        } else if (token == "false") {
            output.push({ type: "literal", value: false });
        } else if (token == "null") {
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
        if (token && token.type === "literal") {
            stack.push(token.value);
        } else if (["+", "-", "*", "/", "==", "!=", "<", ">", "<=", ">="].includes(token)) {
            if (stack.length < 2) {
                closed = 1;
                console.error(`Not enough operands for '${token}'. Line: ${lineNumber}`);
                return null;
            }
            const b = stack.pop();
            const a = stack.pop();
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
    if (exprTokens[0] === "fetch" && exprTokens[1]) {
        const urlToken = exprTokens[1];
        let url = urlToken;
        if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
        try {
            return await fetch(url).then(r => r.text());
        } catch (e) {
            console.error(`Failed to fetch '${url}'. Line: ${lineNumber}`);
        }
    } else {
        const rpn = shuntingYard(exprTokens, lineNumber);
        if (!rpn.length) return null;
        return evaluateRPN(rpn, lineNumber);
    }
}

const input = document.getElementById("code");
input.addEventListener("keydown", (e) => {
    if (e.altKey && e.key == "Enter") {
        closed = null;
        consoleEl.value = "Console:"
        execute(input.value);
    }
})