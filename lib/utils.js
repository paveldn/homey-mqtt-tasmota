'use strict';

const getDebug = () => {
    return process.env.DEBUG == 1;
}
// Debug only function
const getFunctionCallers = (max_depth) => {
    let result = [];
    if (!getDebug())
        return result;
    if (max_depth === undefined)
        max_depth = 1;
    let e = new Error();
    let frames = e.stack.split("\n");
    let frameIndex = 2;
    while ((max_depth > 0) && (frameIndex < frames.length))
    {
        let lineNumber = frames[frameIndex].split(":")[1];
        let functionName = frames[frameIndex].split(" ")[5];
        result.push({ line: lineNumber, functionName: functionName});
        max_depth--;
        frameIndex++;
    }
    return result;
}

module.exports.getFunctionCallers = getFunctionCallers;