import fs from "node:fs";

const source = fs.readFileSync("darknet-manager.js", "utf8");

const forbiddenPatterns = [
    {
        pattern: /while\s*\(\s*f\s*\*\s*f\s*<=\s*n\s*\)/,
        message:
            "Unbounded trial-division loop detected in largest-prime-factor solver. This can freeze Bitburner's UI thread.",
    },
    {
        pattern: /f\s*\+=\s*2n/,
        message:
            "Odd-integer BigInt scanning detected in largest-prime-factor solver.",
    },
];

for (const { pattern, message } of forbiddenPatterns) {
    if (pattern.test(source)) {
        console.error(`CPU hazard: ${message}`);
        process.exit(1);
    }
}

const agentMatch = source.match(
    /const AGENT_SOURCE = String\.raw`([\s\S]*?)`;\r?\n\r?\n {4}function log\(/,
);
if (!agentMatch) {
    console.error("Could not extract AGENT_SOURCE from darknet-manager.js");
    process.exit(1);
}

const agentSource = agentMatch[1];
const functionStart = agentSource.indexOf("function largestPrimeFactor(");
if (functionStart < 0) {
    console.error("largestPrimeFactor() was not found in the generated agent.");
    process.exit(1);
}

const braceStart = agentSource.indexOf("{", functionStart);
let depth = 0;
let functionEnd = -1;
for (let i = braceStart; i < agentSource.length; i++) {
    if (agentSource[i] === "{") depth++;
    else if (agentSource[i] === "}") {
        depth--;
        if (depth === 0) {
            functionEnd = i + 1;
            break;
        }
    }
}

if (functionEnd < 0) {
    console.error("Could not parse largestPrimeFactor() from the generated agent.");
    process.exit(1);
}

const functionSource = agentSource.slice(functionStart, functionEnd);
const smallPrimes = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61,
    67, 71, 73, 79, 83, 89, 97,
];
const largePrimes = [
    1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999,
    2063, 2207, 2371, 2503, 2539, 2693, 2741, 2753, 2801, 2819, 2837, 2909,
    2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877,
    4943, 4951, 4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881,
    6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719, 6841, 7103, 7549,
    7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761,
    8839, 8963, 9103, 9199, 9343, 9467, 9551, 9601, 9739, 9749, 9859,
];

const buildSolver = new Function(
    "SMALL_PRIMES",
    "LARGE_PRIMES",
    `${functionSource}; return largestPrimeFactor;`,
);
const solve = buildSolver(smallPrimes, largePrimes);

const cases = [
    { target: 1069n * 2n, expected: 1069n },
    { target: 9859n * 97n ** 6n, expected: 9859n },
    { target: 9467n * 2n * 3n * 5n * 7n * 11n * 13n, expected: 9467n },
    { target: 5419n * 89n * 89n * 43n, expected: 5419n },
];

const start = performance.now();
for (const test of cases) {
    const actual = solve(test.target.toString());
    if (actual !== test.expected.toString()) {
        console.error(
            `Prime solver failed for ${test.target}: expected ${test.expected}, got ${actual}`,
        );
        process.exit(1);
    }
}
const elapsed = performance.now() - start;

if (elapsed > 100) {
    console.error(
        `Prime solver regression: deterministic test cases took ${elapsed.toFixed(2)} ms.`,
    );
    process.exit(1);
}

console.log(`CPU hazard check OK; prime solver tests completed in ${elapsed.toFixed(2)} ms.`);
